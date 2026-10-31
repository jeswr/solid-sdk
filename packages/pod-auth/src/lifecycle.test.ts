// AUTHORED-BY Codex GPT-6.1-Sol

import type { RefreshSessionRecord } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp({ refreshTokens: true, revocation: true, ...config });
  vi.stubGlobal("fetch", op.fetch);
  const values = new Map<string, {}>();
  const reads: string[] = [];
  const sessions = {
    getItem: vi.fn(async (key: string) => {
      reads.push(key);
      return values.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: {}) => {
      values.set(key, structuredClone(value));
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions, caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  };
  const load = () => createPodAuth(options);
  const record = () =>
    [...values.entries()].find(([, v]) => typeof v === "object" && "refreshToken" in v) as [
      string,
      RefreshSessionRecord,
    ];
  return { op, options, load, sessions, values, reads, record };
}

test("restore rotates the same non-extractable ES256 key, persists before emitting, and supplies working fetch", async () => {
  const f = fixture();
  const first = f.load();
  await first.login();
  const [key, before] = f.record();
  expect(JSON.parse(JSON.parse(key)[1])).toEqual([f.op.issuer, f.op.webId, f.op.clientId]);
  expect(before.dpopKey.privateKey.extractable).toBe(false);
  expect(before.dpopKey.privateKey.algorithm).toMatchObject({ name: "ECDSA", namedCurve: "P-256" });
  await expect(crypto.subtle.exportKey("jwk", before.dpopKey.privateKey)).rejects.toThrow();
  const publicKey = await crypto.subtle.exportKey("jwk", before.dpopKey.publicKey);
  expect(JSON.stringify(before)).not.toContain("access_token");
  expect(before).not.toHaveProperty("id_token");
  f.reads.length = 0;
  expect(await first.remembered()).toEqual([{ webId: f.op.webId, issuer: f.op.issuer }]);
  expect(f.reads).toHaveLength(1);
  expect(JSON.parse(f.reads[0]!)[1]).toBe("active");
  const restored = f.load();
  const events: string[] = [];
  restored.on("login", () => events.push("login"));
  restored.on("restore", () => {
    expect(f.record()[1].refreshToken).not.toBe(before.refreshToken);
    events.push("restore");
  });
  const a = restored.restore();
  expect(restored.restore()).toBe(a);
  await expect(restored.login()).rejects.toThrow("in progress");
  expect((await a)?.webId).toBe(f.op.webId);
  expect(events).toEqual(["restore"]);
  expect(f.op.stats.refreshes).toBe(1);
  expect(f.op.stats.authorizations).toBe(1);
  expect(await crypto.subtle.exportKey("jwk", f.record()[1].dpopKey.publicKey)).toEqual(publicKey);
  expect((await restored.fetch(f.op.root + "private")).status).toBe(200);
  expect(await restored.restore()).toEqual(await restored.identity());
  await expect(f.load().restore()).resolves.toMatchObject({ webId: f.op.webId });
  expect(f.op.stats.refreshes).toBe(2);
  expect(f.op.stats.reuse).toBe(0);
});

test("two fresh instances serialize rotating refresh grants", async () => {
  const f = fixture();
  await f.load().login();
  const a = f.load(),
    b = f.load();
  const results = await Promise.all([a.restore(), b.restore()]);
  expect(results.map((i) => i?.webId)).toEqual([f.op.webId, f.op.webId]);
  expect(f.op.stats.refreshes).toBe(2);
  expect(f.op.stats.reuse).toBe(0);
});

test("issuer-only sessions refresh after access-token expiry without persisting credentials", async () => {
  const f = fixture({ webId: null });
  const auth = f.load();
  await expect(auth.login({ issuer: f.op.issuer })).resolves.toMatchObject({ webId: null });
  const now = Date.now();
  const clock = vi.spyOn(Date, "now");
  for (let refresh = 1; refresh <= 2; refresh++) {
    clock.mockReturnValue(now + refresh * 301_000);
    expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
    expect(f.op.stats.refreshes).toBe(refresh);
    expect(f.op.stats.authorizations).toBe(1);
    expect(f.record()).toBeUndefined();
    expect(await auth.remembered()).toEqual([]);
  }
  expect(f.op.stats.reuse).toBe(0);
  expect(await f.load().restore()).toBeNull();
  expect(f.options.ui.getCode).toHaveBeenCalledOnce();
  await auth.logout();
  expect(f.op.stats.revocations).toBe(1);
  expect(await auth.identity()).toBeNull();
  await auth.login({ issuer: f.op.issuer });
  expect(f.op.stats.authorizations).toBe(2);
  expect(f.op.stats.refreshes).toBe(2);
});

test("a normalized client URL supports login, persistence and refresh after reload", async () => {
  const f = fixture();
  f.options.clientId = "https://app.example";
  const normalized = new URL(f.options.clientId).href;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url === normalized
      ? Response.json({
          client_id: normalized,
          redirect_uris: [f.op.redirectUri],
          token_endpoint_auth_method: "none",
          id_token_signed_response_alg: "ES256",
        })
      : await f.op.fetch(request);
  });
  await f.load().login();
  const [key, before] = f.record();
  expect(JSON.parse(JSON.parse(key)[1])).toEqual([f.op.issuer, f.op.webId, normalized]);
  expect(before.client.client_id).toBe(normalized);
  const reloaded = f.load();
  await expect(reloaded.restore()).resolves.toMatchObject({
    webId: f.op.webId,
    clientId: normalized,
  });
  expect(f.op.stats.refreshes).toBe(1);
  expect(f.op.stats.authorizations).toBe(1);
  expect(f.record()[1].refreshToken).not.toBe(before.refreshToken);
  expect((await reloaded.fetch(f.op.root + "private")).status).toBe(200);
});

test.each([
  true,
  false,
])("invalid_grant clears the old credential and makes one silent attempt; interaction=%s", async (requireInteraction) => {
  const f = fixture({ requireInteraction });
  await f.load().login();
  const old = f.record()[1].refreshToken;
  f.op.failRefresh("invalid_grant");
  const auth = f.load();
  const expired = vi.fn();
  auth.on("expired", expired);
  const result = await auth.restore();
  expect(f.op.stats.refreshes).toBe(1);
  expect(f.op.stats.authorizations).toBe(2);
  const authorizations = f.op.requests.filter((r) => r.url.startsWith(f.op.issuer + "authorize"));
  expect(new URL(authorizations[0]!.url).searchParams.get("prompt")).toBe("consent");
  expect(new URL(authorizations[1]!.url).searchParams.get("prompt")).toBe("none");
  if (requireInteraction) {
    expect(result).toBeNull();
    expect(await auth.identity()).toBeNull();
    expect(await auth.remembered()).toEqual([]);
    expect(expired).toHaveBeenCalledOnce();
    await expect(auth.restore()).resolves.toBeNull();
  } else {
    expect(result?.webId).toBe(f.op.webId);
    expect(f.record()[1].refreshToken).not.toBe(old);
    expect(expired).not.toHaveBeenCalled();
  }
});

test.each([
  "temporarily_unavailable",
  "invalid_client",
  "network",
])("transient %s restore failure preserves credential and pointer without authorization UI", async (failure) => {
  const f = fixture();
  await f.load().login();
  const before = f.record()[1].refreshToken;
  if (failure === "network")
    vi.stubGlobal("fetch", async () => {
      throw new Error("network");
    });
  else f.op.failRefresh(failure);
  const auth = f.load();
  expect(await auth.restore()).toBeNull();
  expect(f.record()[1].refreshToken).toBe(before);
  expect(await auth.remembered()).toHaveLength(1);
  expect(f.op.stats.authorizations).toBe(1);
  f.op.failRefresh();
  vi.stubGlobal("fetch", f.op.fetch);
  expect((await f.load().restore())?.webId).toBe(f.op.webId);
});

test("no pointer or no credential never opens authorization UI", async () => {
  const f = fixture();
  const auth = f.load();
  expect(await auth.remembered()).toEqual([]);
  expect(await auth.restore()).toBeNull();
  expect(f.op.requests).toHaveLength(0);
  await auth.login();
  const [key] = f.record();
  f.values.delete(key);
  const reload = f.load();
  expect(await reload.restore()).toBeNull();
  expect(await reload.remembered()).toEqual([]);
  expect(f.op.stats.authorizations).toBe(1);
});

test.each([
  false,
  true,
])("logout revokes/purges without a refresh, including a fresh instance; reload=%s", async (reload) => {
  const f = fixture();
  const first = f.load();
  await first.login();
  await f.sessions.setItem("unrelated", { keep: true });
  const auth = reload ? f.load() : first;
  const events: unknown[] = [];
  auth.on("logout", (e) => events.push(e.identity));
  const a = auth.logout();
  expect(auth.logout()).toBe(a);
  await expect(auth.login()).rejects.toThrow("in progress");
  await expect(auth.restore()).rejects.toThrow("in progress");
  await a;
  expect(f.op.stats.refreshes).toBe(0);
  expect(f.op.stats.revocations).toBe(1);
  expect(f.record()).toBeUndefined();
  expect(await auth.remembered()).toEqual([]);
  expect(await auth.identity()).toBeNull();
  expect(events).toEqual([null]);
  expect(await f.sessions.getItem("unrelated")).toEqual({ keep: true });
  expect(await first.identity()).toBeNull();
  await auth.logout();
  expect(f.op.stats.revocations).toBe(1);
  await auth.login();
  expect((await auth.identity())?.webId).toBe(f.op.webId);
});

test("logout purges and emits even when RFC7009 revocation fails", async () => {
  const f = fixture();
  const auth = f.load();
  await auth.login();
  f.op.failRevocation(true);
  const logout = vi.fn();
  auth.on("logout", logout);
  await expect(auth.logout()).rejects.toThrow("Logout cleanup failed");
  expect(await auth.remembered()).toEqual([]);
  expect(await auth.identity()).toBeNull();
  expect(f.record()).toBeUndefined();
  expect(logout).toHaveBeenCalledOnce();
});

test("logout cancels pending UI and prevents a late login from publishing state", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  f.options.ui.getCode = async (...args) => {
    ready.resolve();
    await release.promise;
    return f.op.getCode(...args);
  };
  const auth = f.load();
  const pending = Promise.allSettled([auth.login()]);
  await ready.promise;
  await expect(auth.restore()).rejects.toThrow("in progress");
  await auth.logout();
  release.resolve();
  expect((await pending)[0]?.status).toBe("rejected");
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(f.record()).toBeUndefined();
});

test.each([
  false,
  true,
])("logout fences login preflight before provider startup; existing=%s", async (existing) => {
  const f = fixture();
  const auth = f.load();
  if (existing) await auth.login();
  const { SessionFence } = await import("@jeswr/reactive-authentication");
  const generation = SessionFence.prototype.generation;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  vi.spyOn(SessionFence.prototype, "generation").mockImplementationOnce(async function (
    this: SessionFence,
  ) {
    const value = await generation.call(this);
    ready.resolve();
    await release.promise;
    return value;
  });
  const loginEvent = vi.fn();
  auth.on("login", loginEvent);
  const login = Promise.allSettled([auth.login()]);
  await ready.promise;
  await auth.logout();
  release.resolve();
  expect((await login)[0]).toMatchObject({ status: "rejected" });
  expect(f.op.stats.authorizations).toBe(existing ? 1 : 0);
  expect(loginEvent).not.toHaveBeenCalled();
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(f.record()).toBeUndefined();
  await auth.login();
  expect((await auth.identity())?.webId).toBe(f.op.webId);
});

test("logout during refresh fences late results and leaves no restored identity or pointer", async () => {
  const f = fixture();
  await f.load().login();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await f.op.fetch(request);
    if (request.url.endsWith("/token")) {
      ready.resolve();
      await release.promise;
    }
    return response;
  });
  const auth = f.load();
  const restoring = auth.restore();
  await ready.promise;
  await auth.logout();
  release.resolve();
  expect(await restoring).toBeNull();
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(f.record()).toBeUndefined();
});

test("storage failures reject without exposing a session or discarding an unproven credential", async () => {
  const f = fixture();
  await f.load().login();
  const key = f.record()[0];
  const get = f.sessions.getItem;
  f.sessions.getItem = vi.fn(async (k) => {
    if (k === key) throw new Error("read denied");
    return get(k);
  });
  await expect(f.load().restore()).rejects.toThrow("Session storage failed");
  expect(f.values.has(key)).toBe(true);
  f.sessions.getItem = get;
  f.sessions.setItem = vi.fn(async (k, v) => {
    if (k === key) throw new Error("write denied");
    f.values.set(k, v);
  });
  const auth = f.load();
  await expect(auth.restore()).rejects.toThrow("write denied");
  expect(await auth.identity()).toBeNull();
  expect(f.values.has(key)).toBe(false);
});

test.each([
  ["as", "getItem"],
  ["as", "setItem"],
  ["issuer", "getItem"],
  ["issuer", "setItem"],
] as const)("restore rejects %s metadata %s failures and retains the credential and pointer", async (cache, operation) => {
  const f = fixture();
  await f.load().login();
  const before = structuredClone([...f.values.entries()]);
  const caches = createMemoryStore();
  const failure = new Error("Metadata storage unavailable");
  let unavailable = true;
  const fails = (key: string) => unavailable && JSON.parse(key)[0].endsWith(`:${cache}`);
  f.options.storage!.caches = {
    ...caches,
    getItem: async (key) => {
      if (operation === "getItem" && fails(key)) throw failure;
      return await caches.getItem(key);
    },
    setItem: async (key, value) => {
      if (operation === "setItem" && fails(key)) throw failure;
      await caches.setItem(key, value);
    },
  };
  const auth = f.load();
  const restored = vi.fn(),
    expired = vi.fn();
  auth.on("restore", restored);
  auth.on("expired", expired);
  await expect(auth.restore()).rejects.toBe(failure);
  expect(await auth.identity()).toBeNull();
  expect([...f.values.entries()]).toEqual(before);
  expect(await auth.remembered()).toEqual([{ webId: f.op.webId, issuer: f.op.issuer }]);
  expect(f.op.stats.refreshes).toBe(0);
  expect(f.op.stats.authorizations).toBe(1);
  expect(restored).not.toHaveBeenCalled();
  expect(expired).not.toHaveBeenCalled();
  unavailable = false;
  await expect(auth.restore()).resolves.toMatchObject({ webId: f.op.webId });
  expect(f.op.stats.refreshes).toBe(1);
});

test.each(["solid", "lws"])("issuers without ES256 are refused through %s", async (protocol) => {
  const f = fixture();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init),
      response = await f.op.fetch(request);
    return request.url.endsWith("openid-configuration")
      ? Response.json({ ...(await response.json()), dpop_signing_alg_values_supported: ["RS256"] })
      : response;
  });
  const auth = f.load();
  await expect(protocol === "solid" ? auth.login() : auth.fetch(f.op.root + "lws")).rejects.toThrow(
    "ES256",
  );
  expect(f.op.stats.tokens).toBe(0);
});

test("an implicit session restores its verified storage context after automatic boundary mappings are lost", async () => {
  const f = fixture();
  f.options.boundary = {};
  const first = f.load();
  expect((await first.fetch(f.op.root + "private")).status).toBe(200);
  const restored = f.load();
  expect((await restored.restore())?.webId).toBe(f.op.webId);
  expect((await restored.fetch(f.op.root + "different")).status).toBe(200);
  expect(f.op.stats.authorizations).toBe(1);
  expect(f.op.stats.refreshes).toBe(1);
});

test.each([
  false,
  true,
])("restore pins a chosen issuer after metadata loss and preserves credential context; implicit=%s", async (implicit) => {
  const f = fixture({ issuers: ["https://other.example/", "https://op.example/"] });
  const chooseIssuer = vi.fn(async () => f.op.issuer);
  f.options.ui.chooseIssuer = chooseIssuer;
  if (implicit) f.options.boundary = {};
  const first = f.load();
  if (implicit) {
    expect((await first.fetch(`${f.op.root}private`)).status).toBe(200);
  } else await first.login({ webId: f.op.webId });
  expect(chooseIssuer).toHaveBeenCalledOnce();
  const [credentialKey] = f.record();
  const pointer = () =>
    [...f.values.entries()].find(([key]) => JSON.parse(key)[1] === "active")?.[1];
  const before = pointer();
  expect(before).toHaveProperty("selected.webId", f.op.webId);
  expect(before).not.toHaveProperty("selected.issuer");
  f.options.storage!.caches = createMemoryStore();
  // Restoration must work without a chooser and must never invoke an available chooser.
  if (implicit) delete f.options.ui.chooseIssuer;
  else chooseIssuer.mockRejectedValueOnce(new Error("Issuer chooser must not open during restore"));
  const restored = f.load();
  await expect(restored.restore()).resolves.toMatchObject({
    webId: f.op.webId,
    issuer: f.op.issuer,
  });
  expect(f.record()[0]).toBe(credentialKey);
  expect(pointer()).toMatchObject({
    context: (before as { context: string }).context,
    selected: { issuer: f.op.issuer },
  });
  expect(f.op.stats.refreshes).toBe(1);
  expect(f.op.stats.authorizations).toBe(1);
  expect(chooseIssuer).toHaveBeenCalledOnce();
  expect(f.options.ui.getWebId).toHaveBeenCalledTimes(implicit ? 1 : 0);
  expect((await restored.fetch(`${f.op.root}private`)).status).toBe(200);
  await expect(f.load().restore()).resolves.toMatchObject({ webId: f.op.webId });
  expect(f.op.stats.refreshes).toBe(2);
  expect(f.op.stats.reuse).toBe(0);
});

test("a remembered pointer read completing after logout cannot start restoration", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const get = f.sessions.getItem;
  let paused = false;
  f.sessions.getItem = vi.fn(async (key) => {
    const value = await get(key);
    if (JSON.parse(key)[1] === "active" && !paused) {
      paused = true;
      ready.resolve();
      await release.promise;
    }
    return value;
  });
  const auth = f.load(),
    restoring = auth.restore();
  await ready.promise;
  await auth.logout();
  release.resolve();
  expect(await restoring).toBeNull();
  expect(f.op.stats.refreshes).toBe(0);
});

test("logout during the final pointer write prevents identity publication and purges that pointer", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const set = f.sessions.setItem;
  f.sessions.setItem = vi.fn(async (key, value) => {
    await set(key, value);
    if (JSON.parse(key)[1] === "active") {
      ready.resolve();
      await release.promise;
    }
  });
  const auth = f.load(),
    login = Promise.allSettled([auth.login()]);
  await ready.promise;
  const logout = auth.logout();
  release.resolve();
  await logout;
  expect((await login)[0]).toMatchObject({ status: "rejected" });
  expect(await auth.remembered()).toEqual([]);
  expect(await auth.identity()).toBeNull();
});

test.each([
  "webId",
  "issuer",
])("restoration refuses an engine identity with a mismatched %s", async (field) => {
  const f = fixture();
  await f.load().login();
  const { DPoPTokenProvider } = await import("@jeswr/reactive-authentication");
  const claims = f.record()[1].identity!;
  vi.spyOn(DPoPTokenProvider.prototype, "restore").mockResolvedValue({
    ...claims,
    [field]: "https://other.example/",
  });
  const auth = f.load();
  expect(await auth.restore()).toBeNull();
  expect(await auth.identity()).toBeNull();
  // The catalog survives a provider-level failure long enough for a subsequent logout to purge it.
  await auth.logout();
  expect(f.record()).toBeUndefined();
});

test.each([
  "manager",
  "storage",
])("logout still emits and clears identity after a %s cleanup failure", async (kind) => {
  const f = fixture();
  const auth = f.load();
  await auth.login();
  if (kind === "manager") {
    const { ReactiveFetchManager } = await import("@jeswr/reactive-authentication");
    vi.spyOn(ReactiveFetchManager.prototype, "logout").mockRejectedValueOnce(
      new Error("manager failed"),
    );
  } else {
    const remove = f.sessions.removeItem;
    f.sessions.removeItem = vi.fn(async (key) => {
      if (JSON.parse(key)[1] === "active") throw new Error("purge failed");
      await remove(key);
    });
  }
  const event = vi.fn();
  auth.on("logout", event);
  await expect(auth.logout()).rejects.toThrow("Logout cleanup failed");
  expect(await auth.identity()).toBeNull();
  expect(event).toHaveBeenCalledOnce();
});

test("late identity reporting while logout revocation is pending cannot publish login", async () => {
  const f = fixture();
  const identityReady = Promise.withResolvers<void>(),
    identityRelease = Promise.withResolvers<void>();
  const revokeReady = Promise.withResolvers<void>(),
    revokeRelease = Promise.withResolvers<void>();
  const { DPoPTokenProvider } = await import("@jeswr/reactive-authentication");
  const identity = DPoPTokenProvider.prototype.identity;
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockImplementation(async function (
    this: DPoPTokenProvider,
    request,
  ) {
    const claims = await identity.call(this, request);
    identityReady.resolve();
    await identityRelease.promise;
    return claims;
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/revoke")) {
      revokeReady.resolve();
      await revokeRelease.promise;
    }
    return f.op.fetch(request);
  });
  const auth = f.load(),
    login = Promise.allSettled([auth.login()]);
  await identityReady.promise;
  const logout = auth.logout();
  await revokeReady.promise;
  identityRelease.resolve();
  expect((await login)[0]).toMatchObject({
    status: "rejected",
    reason: { message: "Logout is in progress" },
  });
  revokeRelease.resolve();
  await logout;
  expect(await auth.identity()).toBeNull();
});

test("late identity reporting after logout has completed remains cancelled", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const { DPoPTokenProvider } = await import("@jeswr/reactive-authentication");
  const identity = DPoPTokenProvider.prototype.identity;
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockImplementation(async function (
    this: DPoPTokenProvider,
    request,
  ) {
    const claims = await identity.call(this, request);
    ready.resolve();
    await release.promise;
    return claims;
  });
  const auth = f.load(),
    login = Promise.allSettled([auth.login()]);
  await ready.promise;
  await auth.logout();
  release.resolve();
  expect((await login)[0]?.status).toBe("rejected");
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
});

test("the mock OP rejects refresh token reuse, wrong key/client binding, and missing revocation hints", async () => {
  const f = fixture();
  await f.load().login();
  const before = f.record()[1];
  await f.load().restore();
  const current = f.record()[1];
  const otherKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const proof = async (keys: CryptoKeyPair) => {
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const data =
      encode({
        typ: "dpop+jwt",
        alg: "ES256",
        jwk: await crypto.subtle.exportKey("jwk", keys.publicKey),
      }) +
      "." +
      encode({
        htm: "POST",
        htu: f.op.issuer + "token",
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
      });
    return (
      data +
      "." +
      Buffer.from(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          keys.privateKey,
          new TextEncoder().encode(data),
        ),
      ).toString("base64url")
    );
  };
  for (const [refresh, keys, client] of [
    [before.refreshToken, before.dpopKey, f.op.clientId],
    [current.refreshToken, otherKey, f.op.clientId],
    [current.refreshToken, current.dpopKey, "foreign"],
  ] as const) {
    const response = await f.op.fetch(f.op.issuer + "token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: client,
      }),
      headers: { dpop: await proof(keys) },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  }
  expect(f.op.stats.reuse).toBe(1);
  await expect(
    f.op.fetch(f.op.issuer + "revoke", { method: "POST", body: "token=fake" }),
  ).rejects.toThrow("Missing refresh token hint");
});

test("an identity read started before logout cannot return a subsequent login's identity", async () => {
  const f = fixture();
  const auth = f.load();
  await auth.login();
  const { SessionFence } = await import("@jeswr/reactive-authentication");
  const generation = SessionFence.prototype.generation;
  const ready = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  vi.spyOn(SessionFence.prototype, "generation").mockImplementationOnce(async function (
    this: SessionFence,
  ) {
    const value = await generation.call(this);
    ready.resolve();
    await release.promise;
    return value;
  });
  const identity = auth.identity();
  await ready.promise;
  await auth.logout();
  await auth.login();
  release.resolve();
  expect(await identity).toBeNull();
  expect((await auth.identity())?.webId).toBe(f.op.webId);
});

test("restore and login observe a peer logout before reusing a local identity snapshot", async () => {
  const f = fixture();
  const first = f.load(),
    peer = f.load();
  await first.login();
  await peer.logout();
  expect(await first.restore()).toBeNull();
  await first.login();
  expect(f.op.stats.authorizations).toBe(2);
  await peer.logout();
  await first.login();
  expect(f.op.stats.authorizations).toBe(3);
});
