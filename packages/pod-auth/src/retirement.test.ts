// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp({
    refreshTokens: true,
    revocation: true,
    ...config,
  });
  const redirectUri = `${op.redirectUri}/${crypto.randomUUID()}`;
  const transport =
    (provider: typeof op): typeof fetch =>
    async (input, init) => {
      const request = new Request(input, init);
      const response = await provider.fetch(request);
      if (request.url === provider.clientId)
        return Response.json({ ...(await response.json()), redirect_uris: [redirectUri] });
      return response;
    };
  vi.stubGlobal("fetch", transport(op));
  const values = new Map<string, {}>();
  const sessions = {
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: {}) => {
      values.set(key, structuredClone(value));
    }),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri,
    storage: { sessions, caches: createMemoryStore() },
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  };
  return { op, values, sessions, options, transport, load: () => createPodAuth(options) };
}

function storedKey(f: ReturnType<typeof fixture>, name: string) {
  return [...f.values.keys()].find((key) => JSON.parse(key)[1] === name)!;
}

test.each([
  false,
  true,
])("conditional retirement cleans and revokes only the owned grant; reload=%s", async (reload) => {
  const f = fixture();
  const first = f.load();
  const expected = await first.login();
  expect(expected.grantId).toEqual(expect.any(String));
  const auth = reload ? f.load() : first;
  const logout = vi.fn();
  auth.on("logout", logout);
  await f.sessions.setItem("unrelated", { keep: true });
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
  expect(f.op.stats.revocations).toBe(1);
  expect(f.op.stats.refreshes).toBe(0);
  expect(await auth.remembered()).toEqual([]);
  expect(await first.identity()).toBeNull();
  expect(logout).toHaveBeenCalledOnce();
  expect(
    [...f.values.values()].some((value) => typeof value === "object" && "refreshToken" in value),
  ).toBe(false);
  expect(await f.sessions.getItem("unrelated")).toEqual({ keep: true });
});

test.each([
  false,
  true,
])("stale retirement preserves a newer sign-in and its credentials; sameAccount=%s", async (sameAccount) => {
  const f = fixture();
  const first = f.load();
  const expected = await first.login();
  const replacement = sameAccount
    ? f.op
    : createMockOp({
        refreshTokens: true,
        revocation: true,
        webId: "https://id.example/bob#me",
      });
  vi.stubGlobal("fetch", f.transport(replacement));
  const second = createPodAuth({
    ...f.options,
    ui: { getWebId: async () => replacement.webId!, getCode: replacement.getCode },
  });
  const newer = await second.login({ issuer: replacement.issuer });
  expect(newer.grantId).not.toBe(expected.grantId);
  const saved = structuredClone([...f.values]);
  const logout = vi.fn();
  first.on("logout", logout);
  await expect(first.retireIfOwnedBy(expected)).resolves.toEqual({
    retired: false,
    reason: sameAccount ? "grant-changed" : "owner-changed",
  });
  expect([...f.values]).toEqual(saved);
  expect(await second.identity()).toEqual(newer);
  expect((await second.fetch(replacement.root + "private")).status).toBe(200);
  expect(logout).not.toHaveBeenCalled();
  expect(f.op.stats.revocations).toBe(0);
  expect(replacement.stats.revocations).toBe(0);
  const reloaded = f.load();
  await expect(reloaded.restore()).resolves.toMatchObject({
    webId: newer.webId,
    grantId: newer.grantId,
  });
});

test("refresh rotation retains grant ownership", async () => {
  const f = fixture();
  const first = f.load();
  const expected = await first.login();
  const reloaded = f.load();
  const restored = await reloaded.restore();
  expect(restored?.grantId).toBe(expected.grantId);
  await expect(first.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
  expect(await reloaded.identity()).toBeNull();
  expect(f.op.stats.refreshes).toBe(1);
  expect(f.op.stats.revocations).toBe(1);
});

test("refreshing an older grant cannot reclaim ownership from a newer sign-in", async () => {
  const f = fixture();
  const first = f.load();
  const expected = await first.login();
  const second = f.load();
  const newer = await second.login({ issuer: f.op.issuer });
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
  expect((await first.fetch(f.op.root + "private")).status).toBe(200);
  expect(f.op.stats.refreshes).toBe(1);
  await expect(first.retireIfOwnedBy(expected)).resolves.toEqual({
    retired: false,
    reason: "grant-changed",
  });
  await expect(second.retireIfOwnedBy(newer)).resolves.toEqual({ retired: true });
  expect(f.op.stats.revocations).toBe(2);
});

test("a legacy credential gains owner metadata at its first refresh commit", async () => {
  const f = fixture();
  const expected = await f.load().login();
  f.values.delete(storedKey(f, "owner"));
  const auth = f.load();
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({
    retired: false,
    reason: "no-grant",
  });
  await expect(auth.restore()).resolves.toMatchObject({ grantId: expected.grantId });
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
});

test("a snapshot without a grant identifier fails closed", async () => {
  const f = fixture();
  const auth = f.load();
  const identity = await auth.login();
  const { grantId: _grantId, ...unversioned } = identity;
  await expect(auth.retireIfOwnedBy(unversioned)).resolves.toEqual({
    retired: false,
    reason: "missing-grant",
  });
  expect(await auth.identity()).toEqual(identity);
  await expect(auth.retireIfOwnedBy({ ...identity, grantId: "" })).resolves.toEqual({
    retired: false,
    reason: "missing-grant",
  });
});

test.each([
  null,
  {},
  { grantId: "" },
  { grantId: 42 },
])("missing or malformed ownership metadata fails closed: %j", async (owner) => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  const key = storedKey(f, "owner");
  if (owner === null) f.values.delete(key);
  else f.values.set(key, owner);
  const saved = structuredClone([...f.values]);
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({
    retired: false,
    reason: "no-grant",
  });
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toEqual(expected);
  expect(f.op.stats.revocations).toBe(0);
});

test("an issuer mismatch skips even when the WebID and grant identifier match", async () => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  await expect(
    auth.retireIfOwnedBy({ ...expected, issuer: "https://other.example/" }),
  ).resolves.toEqual({ retired: false, reason: "owner-changed" });
  expect(await auth.identity()).toEqual(expected);
  expect(f.op.stats.revocations).toBe(0);
});

test.each([
  false,
  true,
])("access-only grants and issuer-only grants can be conditionally retired; issuerOnly=%s", async (issuerOnly) => {
  const f = fixture({ refreshTokens: false, ...(issuerOnly ? { webId: null } : {}) });
  const auth = f.load();
  const expected = await auth.login({ issuer: f.op.issuer });
  expect(expected.grantId).toEqual(expect.any(String));
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(f.op.stats.revocations).toBe(0);
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({
    retired: false,
    reason: "no-grant",
  });
});

test("issuer-only refresh grants retire their in-memory credentials", async () => {
  const f = fixture({ webId: null });
  const auth = f.load();
  const expected = await auth.login({ issuer: f.op.issuer });
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
  expect(f.op.stats.revocations).toBe(1);
  expect(await auth.identity()).toBeNull();
});

test("ownership read failures preserve credentials and emit no logout", async () => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  const saved = structuredClone([...f.values]);
  const logout = vi.fn();
  auth.on("logout", logout);
  f.sessions.getItem.mockRejectedValueOnce(new Error("read denied"));
  await expect(auth.retireIfOwnedBy(expected)).rejects.toThrow("Session storage failed");
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toEqual(expected);
  expect(logout).not.toHaveBeenCalled();
  expect(f.op.stats.revocations).toBe(0);
});

test.each([
  "revocation",
  "storage",
])("accepted retirement attempts cleanup and emits logout on %s failure", async (failure) => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  const logout = vi.fn();
  auth.on("logout", logout);
  if (failure === "revocation") f.op.failRevocation(true);
  else f.sessions.removeItem.mockRejectedValueOnce(new Error("remove denied"));
  await expect(auth.retireIfOwnedBy(expected)).rejects.toThrow("Logout cleanup failed");
  expect(await auth.identity()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  expect(logout).toHaveBeenCalledOnce();
  expect([...f.values.keys()].some((key) => JSON.parse(key)[1] === "owner")).toBe(false);
  f.op.failRevocation(false);
  await expect(auth.login()).resolves.toMatchObject({ webId: f.op.webId });
});

test("concurrent retirements clean up once and snapshot caller-owned metadata", async () => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  const original = { ...expected };
  const logout = vi.fn();
  auth.on("logout", logout);
  const first = auth.retireIfOwnedBy(expected);
  expected.grantId = "mutated after call";
  const second = auth.retireIfOwnedBy(original);
  expect(await Promise.all([first, second])).toEqual([
    { retired: true },
    { retired: false, reason: "no-grant" },
  ]);
  expect(logout).toHaveBeenCalledOnce();
  expect(f.op.stats.revocations).toBe(1);
});

test("a new grant committing before retirement wins the namespace lock", async () => {
  const f = fixture();
  const first = f.load();
  const expected = await first.login();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const set = f.sessions.setItem.getMockImplementation()!;
  f.sessions.setItem.mockImplementation(async (key, value) => {
    if (JSON.parse(key)[1] === "owner") {
      ready.resolve();
      await release.promise;
    }
    await set(key, value);
  });
  const second = f.load();
  const signingIn = second.login({ issuer: f.op.issuer });
  await ready.promise;
  const retiring = first.retireIfOwnedBy(expected);
  release.resolve();
  const newer = await signingIn;
  await expect(retiring).resolves.toEqual({ retired: false, reason: "grant-changed" });
  expect(await second.identity()).toEqual(newer);
  expect((await second.fetch(f.op.root + "private")).status).toBe(200);
  expect(f.op.stats.revocations).toBe(0);
});

test.each([
  "ownership",
  "revocation",
])("the Web Lock excludes new credential commits during %s and cleanup", async (pause) => {
  const f = fixture();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  if (pause === "revocation")
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/revoke")) {
        ready.resolve();
        await release.promise;
      }
      return f.transport(f.op)(request);
    });
  const auth = f.load();
  const expected = await auth.login();
  if (pause === "ownership") {
    const get = f.sessions.getItem.getMockImplementation()!;
    f.sessions.getItem.mockImplementation(async (key) => {
      if (JSON.parse(key)[1] === "owner") {
        ready.resolve();
        await release.promise;
      }
      return get(key);
    });
  }
  const retiring = auth.retireIfOwnedBy(expected);
  await ready.promise;
  const namespace = JSON.stringify(["pod-auth", f.options.clientId, f.options.redirectUri]);
  const lock = namespace + ":mutation";
  const { held } = await navigator.locks.query();
  expect(held).toContainEqual(expect.objectContaining({ name: lock, mode: "exclusive" }));
  const second = f.load();
  const signingIn = Promise.allSettled([second.login({ issuer: f.op.issuer })]);
  try {
    await vi.waitFor(async () => {
      const { pending } = await navigator.locks.query();
      expect(pending).toContainEqual(expect.objectContaining({ name: lock, mode: "exclusive" }));
    });
    if (pause === "revocation") {
      await expect(auth.login()).rejects.toThrow("in progress");
      await expect(auth.restore()).rejects.toThrow("in progress");
    }
  } finally {
    release.resolve();
  }
  await expect(retiring).resolves.toEqual({ retired: true });
  expect((await signingIn)[0]).toMatchObject({
    status: "rejected",
    reason: { name: "SessionSupersededError" },
  });
  expect(await second.identity()).toBeNull();
  expect(await second.remembered()).toEqual([]);
  await expect(second.login({ issuer: f.op.issuer })).resolves.toMatchObject({ webId: f.op.webId });
  expect((await second.fetch(f.op.root + "private")).status).toBe(200);
});

test("Node's keyed fallback serializes retirement without Web Locks", async () => {
  vi.stubGlobal("navigator", {});
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  await expect(auth.retireIfOwnedBy(expected)).resolves.toEqual({ retired: true });
  expect(await auth.identity()).toBeNull();
});

test("browsers without Web Locks fail closed before any ownership read or cleanup", async () => {
  const f = fixture();
  const auth = f.load();
  const expected = await auth.login();
  const saved = structuredClone([...f.values]);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("process", undefined);
  await expect(auth.retireIfOwnedBy(expected)).rejects.toThrow("Web Locks API is required");
  expect([...f.values]).toEqual(saved);
  expect(await auth.identity()).toEqual(expected);
  expect(f.op.stats.revocations).toBe(0);
});
