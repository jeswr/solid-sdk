// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  DPoPTokenProvider,
  OidcIdTokenSource,
  OidcSession,
  SolidUmaTokenProvider,
} from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createBoundary } from "./boundary.js";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { scopedStore } from "./kv.js";
import { createProviders } from "./providers.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  };
  return { op, options };
}

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function proof(url: string, method = "POST", token?: string) {
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = key.publicKey.export({ format: "jwk" });
  const data =
    encoded({ typ: "dpop+jwt", alg: "ES256", jwk }) +
    "." +
    encoded({
      htm: method,
      htu: url,
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      ...(token === undefined
        ? {}
        : { ath: createHash("sha256").update(token).digest("base64url") }),
    });
  return (
    data +
    "." +
    sign("sha256", Buffer.from(data), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString(
      "base64url",
    )
  );
}

test("mock OP refuses PKCE failures, invalid proofs, binding mismatches, replay and invalid subject tokens", async () => {
  const { op, options } = setup();
  const auth = createPodAuth(options);
  await auth.login();
  await auth.fetch(op.root + "private");
  const authenticated = op.requests.find(
    (r) => r.url === op.root + "private" && r.headers.has("authorization"),
  )!;
  expect((await op.fetch(authenticated)).status).toBe(401);
  expect(
    (
      await op.fetch(op.root + "private", {
        headers: {
          authorization: "DPoP unknown",
          dpop: proof(op.root + "private", "GET", "unknown"),
        },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await op.fetch(op.issuer + "token", {
        method: "POST",
        headers: { dpop: proof(op.issuer + "token", "GET") },
        body: "code=unknown",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await op.fetch(op.issuer + "token", {
        method: "POST",
        headers: { dpop: proof(op.issuer + "token") },
        body: "code=unknown",
      })
    ).status,
  ).toBe(400);
  const url = new URL("authorize", op.issuer);
  url.search = new URLSearchParams({
    redirect_uri: op.redirectUri,
    state: "test-state",
    client_id: op.clientId,
    code_challenge: "challenge",
    nonce: "nonce",
  }).toString();
  const callback = new URL(await op.getCode(url, new AbortController().signal));
  const body = new URLSearchParams({
    code: callback.searchParams.get("code")!,
    client_id: op.clientId,
    redirect_uri: op.redirectUri,
    code_verifier: "wrong",
  });
  expect(
    (
      await op.fetch(op.issuer + "token", {
        method: "POST",
        headers: { dpop: proof(op.issuer + "token") },
        body,
      })
    ).status,
  ).toBe(400);
  const fake =
    encoded({ alg: "ES256" }) +
    "." +
    encoded({ iss: op.issuer }) +
    "." +
    Buffer.alloc(64).toString("base64url");
  await expect(
    op.fetch("https://pod.example/exchange", {
      method: "POST",
      body: new URLSearchParams({ subject_token: fake }),
    }),
  ).rejects.toThrow("Invalid subject token");
  expect((await (await op.fetch(op.issuer + "jwks")).json()).keys).toHaveLength(1);
});

test("callback state, issuer and authorization-code tampering never establish a session", async () => {
  for (const field of ["state", "iss", "code"]) {
    const { op, options } = setup();
    options.ui.getCode = async (...args) => {
      const callback = new URL(await op.getCode(...args));
      callback.searchParams.set(field, "tampered");
      return callback.href;
    };
    const auth = createPodAuth(options);
    await expect(auth.login()).rejects.toThrow();
    expect(await auth.identity()).toBeNull();
  }
});

test("missing identity fails closed before sending the upgraded request", async () => {
  const { op, options } = setup();
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockResolvedValue(undefined);
  const auth = createPodAuth(options);
  await expect(auth.login()).rejects.toThrow("Login did not establish");
  await expect(auth.fetch(op.root + "private")).rejects.toThrow("did not establish");
  expect(
    op.requests.filter((r) => r.url === op.root + "private" && r.headers.has("authorization")),
  ).toHaveLength(0);
});

test("LWS refuses missing credential identity before exchange", async () => {
  const { op, options } = setup();
  vi.spyOn(OidcIdTokenSource.prototype, "identity").mockResolvedValue(undefined);
  const auth = createPodAuth(options);
  await expect(auth.fetch(op.root + "lws")).rejects.toThrow("did not establish an identity");
  expect(op.stats.exchanges).toBe(0);
  expect(op.stats.accepted).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test.each([
  "cancellation",
  "invalid WebID",
])("LWS retries account selection after picker %s", async (failure) => {
  const { op, options } = setup();
  const getWebId = vi.fn(options.ui.getWebId);
  if (failure === "cancellation") getWebId.mockRejectedValueOnce(new Error("picker cancelled"));
  else getWebId.mockResolvedValueOnce("invalid WebID");
  options.ui.getWebId = getWebId;
  const auth = createPodAuth(options);

  await expect(auth.fetch(op.root + "lws")).rejects.toThrow(
    failure === "cancellation" ? "picker cancelled" : "absolute URL",
  );
  expect(getWebId).toHaveBeenCalledTimes(1);
  expect(op.stats.tokens).toBe(0);
  expect(op.stats.exchanges).toBe(0);
  expect(op.stats.accepted).toBe(0);
  expect(await auth.identity()).toBeNull();

  expect(await (await auth.fetch(op.root + "lws")).text()).toBe("protected LWS");
  expect(await (await auth.fetch(op.root + "lws")).text()).toBe("protected LWS");
  expect(getWebId).toHaveBeenCalledTimes(2);
  expect((await auth.identity())?.webId).toBe(op.webId);
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.exchanges).toBe(1);
  expect(op.stats.accepted).toBe(2);
});

test.each([
  "https://pod.example/.well-known/lws-configuration",
  "https://op.example/.well-known/openid-configuration",
])("LWS retries with a fresh signal after cancellation during discovery at %s", async (cancelAt) => {
  const { op, options } = setup();
  const controller = new AbortController();
  let cancelled = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === cancelAt && !cancelled) {
      cancelled = true;
      controller.abort();
    }
    request.signal.throwIfAborted();
    return op.fetch(request);
  });
  const auth = createPodAuth(options);
  await expect(auth.fetch(op.root + "lws", { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(cancelled).toBe(true);
  expect(op.stats.tokens).toBe(0);
  expect(op.stats.exchanges).toBe(0);
  expect(op.stats.accepted).toBe(0);
  expect(await auth.identity()).toBeNull();

  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.identity())?.issuer).toBe(op.issuer);
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.exchanges).toBe(1);
});

test("LWS issuer discovery reuses the selected URL after a Solid write body is consumed", async () => {
  const { op, options } = setup();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const copy = request.clone();
    if (request.method === "PUT") await request.text();
    return op.fetch(copy);
  });
  const auth = createPodAuth(options);
  expect((await auth.fetch(op.root + "private", { method: "PUT", body: "content" })).status).toBe(
    200,
  );
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.exchanges).toBe(1);
});

function twoAccounts(onExchange?: (request: Request) => Promise<Response>) {
  const alice = createMockOp();
  const bob = createMockOp({
    issuer: "https://bob-op.example/",
    subject: "https://id.example/bob",
    webId: "https://id.example/bob#me",
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://pod.example/exchange" && onExchange) return onExchange(request);
    return request.url.startsWith(alice.issuer) ||
      request.url.startsWith("https://id.example/alice") ||
      request.url.startsWith(alice.root + "nested/")
      ? alice.fetch(request)
      : bob.fetch(request);
  });
  const options: PodAuthOptions = {
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    boundary: { roots: [alice.root, alice.root + "nested/"], automatic: false },
    ui: {
      getWebId: vi.fn().mockResolvedValueOnce(bob.webId).mockResolvedValue(alice.webId),
      getCode: (url, signal) =>
        url.href.startsWith(bob.issuer) ? bob.getCode(url, signal) : alice.getCode(url, signal),
    },
  };
  return { alice, bob, options };
}

function installUma() {
  const transport = globalThis.fetch;
  const exchanges: Request[] = [];
  let accepted = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://pod.example/.well-known/uma2-configuration")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: "https://pod.example/uma-token",
        uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
      });
    if (request.url === "https://pod.example/uma-token") {
      exchanges.push(request);
      const form = new URLSearchParams(await request.clone().text());
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:uma-ticket");
      expect(form.has("claim_token")).toBe(true);
      expect(request.headers.has("dpop")).toBe(true);
      return Response.json({ access_token: "uma-access", token_type: "Bearer", expires_in: 300 });
    }
    if (request.url.endsWith("/uma")) {
      if (request.headers.get("authorization") === "Bearer uma-access") {
        accepted++;
        return new Response("protected UMA");
      }
      return new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": 'UMA as_uri="https://pod.example/", ticket="test"',
        },
      });
    }
    return transport(request);
  });
  return { exchanges, accepted: () => accepted };
}

test("UMA validates the UI-selected account before disclosing its ID token", async () => {
  const { op, options } = setup();
  const uma = installUma();
  options.ui.getWebId = async () => "https://id.example/bob";
  const auth = createPodAuth(options);
  await expect(auth.fetch(op.root + "uma")).rejects.toThrow("selected account");
  expect(op.stats.tokens).toBe(1);
  expect(uma.exchanges).toHaveLength(0);
  expect(uma.accepted()).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test("UMA validates its own shared-session context when another account logs in first", async () => {
  const { alice, bob, options } = twoAccounts();
  const uma = installUma();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const getCode = options.ui.getCode;
  options.ui.getCode = async (url, signal) => {
    if (url.href.startsWith(bob.issuer)) {
      ready.resolve();
      await release.promise;
    }
    return getCode(url, signal);
  };
  const auth = createPodAuth(options);
  const pending = Promise.allSettled([auth.fetch(bob.root + "uma")]);
  await ready.promise;
  try {
    expect((await auth.fetch(alice.root + "nested/private")).status).toBe(200);
    expect((await auth.identity())?.issuer).toBe(alice.issuer);
  } finally {
    release.resolve();
  }
  expect((await pending)[0]).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringContaining("selected account") },
  });
  expect(uma.exchanges).toHaveLength(0);
  expect(uma.accepted()).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test("an explicit login cannot replace UMA's UI selection during issuer discovery", async () => {
  const alice = createMockOp();
  const bob = createMockOp({
    subject: "https://id.example/bob",
    webId: "https://id.example/bob#me",
  });
  let active = alice;
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let paused = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await active.fetch(request);
    if (request.url === alice.issuer + ".well-known/openid-configuration" && !paused) {
      paused = true;
      ready.resolve();
      await release.promise;
    }
    return response;
  });
  const uma = installUma();
  const auth = createPodAuth({
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    boundary: { roots: [alice.root], automatic: false },
    ui: {
      getWebId: async () => active.webId!,
      getCode: (url, signal) => active.getCode(url, signal),
    },
  });
  const pending = Promise.allSettled([auth.fetch(alice.root + "uma")]);
  await ready.promise;
  try {
    active = bob;
    expect((await auth.login({ webId: bob.webId })).webId).toBe(bob.webId);
  } finally {
    release.resolve();
  }
  expect((await pending)[0]).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringContaining("selected account") },
  });
  expect(uma.exchanges).toHaveLength(0);
  expect(uma.accepted()).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test("a new login cannot relabel an in-flight Solid credential with cached claims", async () => {
  const alice = createMockOp();
  const bob = createMockOp({
    subject: "https://id.example/bob",
    webId: "https://id.example/bob#me",
  });
  let active = alice;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    active.fetch(input, init),
  );
  const firstReady = Promise.withResolvers<void>();
  const secondReady = Promise.withResolvers<void>();
  const bobReady = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  const releaseSecond = Promise.withResolvers<void>();
  const releaseBob = Promise.withResolvers<void>();
  const identity = DPoPTokenProvider.prototype.identity;
  vi.spyOn(DPoPTokenProvider.prototype, "identity").mockImplementation(async function (
    this: DPoPTokenProvider,
    request,
  ) {
    if (request.url === alice.root + "first") {
      firstReady.resolve();
      await releaseFirst.promise;
    }
    if (request.url === alice.root) {
      bobReady.resolve();
      await releaseBob.promise;
    }
    return identity.call(this, request);
  });
  const upgrade = DPoPTokenProvider.prototype.upgrade;
  vi.spyOn(DPoPTokenProvider.prototype, "upgrade").mockImplementation(async function (
    this: DPoPTokenProvider,
    request,
    challenge,
  ) {
    if (request.url === alice.root + "private") {
      secondReady.resolve();
      await releaseSecond.promise;
    }
    return upgrade.call(this, request, challenge);
  });
  const auth = createPodAuth({
    clientId: alice.clientId,
    redirectUri: alice.redirectUri,
    boundary: { roots: [alice.root], automatic: false },
    ui: {
      getWebId: async () => active.webId!,
      getCode: (url, signal) => active.getCode(url, signal),
    },
  });
  // Hold Alice's claims before publication, leaving a cached session with no current identity yet.
  const first = Promise.allSettled([auth.fetch(alice.root + "first")]);
  await firstReady.promise;
  const second = Promise.allSettled([auth.fetch(alice.root + "private")]);
  await secondReady.promise;
  active = bob;
  const login = Promise.allSettled([auth.login({ webId: bob.webId })]);
  await bobReady.promise;
  try {
    releaseSecond.resolve();
    expect((await second)[0]).toMatchObject({
      status: "rejected",
      reason: { message: expect.stringContaining("selection changed") },
    });
    expect(bob.stats.accepted).toBe(0);
  } finally {
    releaseFirst.resolve();
    releaseSecond.resolve();
    releaseBob.resolve();
    await Promise.all([first, login]);
  }
});

test("UMA checks every session read and reuses a validated session and RPT", async () => {
  const { op, options } = setup();
  const uma = installUma();
  const auth = createPodAuth(options);
  await auth.login({ webId: op.webId, issuer: op.issuer });
  expect((await auth.fetch(op.root + "uma")).status).toBe(200);
  expect((await auth.fetch(op.root + "uma")).status).toBe(200);
  expect(uma.exchanges).toHaveLength(1);
  expect(uma.accepted()).toBe(2);
  expect(op.stats.tokens).toBe(1);
  expect((await auth.identity())?.webId).toBe(op.webId);
});

test("UMA permits an issuer-only identity with no WebID and forgets the shared session", async () => {
  const op = createMockOp({ webId: null });
  vi.stubGlobal("fetch", op.fetch);
  const uma = installUma();
  const providers = createProviders(
    {
      clientId: op.clientId,
      redirectUri: op.redirectUri,
      boundary: { roots: [op.root], automatic: false },
      ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    },
    { challenge: vi.fn(), session: vi.fn(async () => {}) },
  );
  await providers.login({ issuer: op.issuer }, providers.fence.signal);
  expect((await providers.manager.fetch(op.root + "uma")).status).toBe(200);
  expect(uma.exchanges).toHaveLength(1);
  await providers.manager.logout();
});

test.each([
  "entry",
  "identity",
])("UMA refuses missing session %s before exchange", async (missing) => {
  const { op, options } = setup();
  const uma = installUma();
  const get = OidcSession.prototype.get;
  vi.spyOn(OidcSession.prototype, "get").mockImplementation(async function (
    this: OidcSession,
    ...args
  ) {
    const entry = await get.apply(this, args);
    return missing === "entry" ? undefined : { ...entry!, identity: undefined };
  });
  const auth = createPodAuth(options);
  await expect(auth.fetch(op.root + "uma")).rejects.toThrow("did not establish an identity");
  expect(uma.exchanges).toHaveLength(0);
  expect(uma.accepted()).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test.each([
  'UMA as_uri="https://untrusted.example/", ticket="test"',
  'Bearer as_uri="https://untrusted.example/", realm="https://pod.example/alice/"',
  'Bearer resource_metadata="https://untrusted.example/metadata"',
  "Unknown",
])("untrusted or unsupported challenge %s does not open account or authorization UI", async (challenge) => {
  const { op, options } = setup();
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith(op.root)
      ? new Response(null, {
          status: 401,
          headers: { "www-authenticate": challenge },
        })
      : transport(request);
  });
  options.ui.getWebId = vi.fn(options.ui.getWebId);
  options.ui.getCode = vi.fn(options.ui.getCode);
  const auth = createPodAuth(options);
  if (challenge === "Unknown" || challenge.includes("resource_metadata"))
    expect((await auth.fetch(op.root + "uma")).status).toBe(401);
  else await expect(auth.fetch(op.root + "uma")).rejects.toThrow(/not trusted|origin/);
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  expect(options.ui.getCode).not.toHaveBeenCalled();
  expect(await auth.identity()).toBeNull();
});

test("LWS checks the credential account before exchange when another context logs in first", async () => {
  const { alice, bob, options } = twoAccounts();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const getCode = options.ui.getCode;
  options.ui.getCode = async (url, signal) => {
    if (url.href.startsWith(bob.issuer)) {
      ready.resolve();
      await release.promise;
    }
    return getCode(url, signal);
  };
  const auth = createPodAuth(options);
  const lws = Promise.allSettled([auth.fetch(bob.root + "lws")]);
  await ready.promise;
  try {
    expect((await auth.fetch(alice.root + "nested/private")).status).toBe(200);
    expect((await auth.identity())?.issuer).toBe(alice.issuer);
  } finally {
    release.resolve();
  }
  const [result] = await lws;
  expect(result).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringContaining("selected account") },
  });
  expect(bob.stats.exchanges).toBe(0);
  expect(bob.stats.accepted).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test("a concurrent Solid upgrade cannot relabel an in-flight LWS credential as another account", async () => {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { alice, bob, options } = twoAccounts(async (request) => {
    const response = await bob.fetch(request);
    ready.resolve();
    await release.promise;
    return response;
  });
  const auth = createPodAuth(options);
  const lws = Promise.allSettled([auth.fetch(bob.root + "lws")]);
  await ready.promise;
  let solid: PromiseSettledResult<Response>[];
  try {
    solid = await Promise.allSettled([auth.fetch(alice.root + "nested/private")]);
  } finally {
    release.resolve();
  }
  expect(solid[0]).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringContaining("selected account") },
  });
  expect((await lws)[0]?.status).toBe("rejected");
  expect(alice.stats.accepted).toBe(0);
  expect(bob.stats.accepted).toBe(0);
  expect(await auth.identity()).toBeNull();
});

test("LWS validates cached credential context before presentation and delegates invalidation and forget", async () => {
  const { op, options } = setup();
  let rejected = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === op.root + "lws" && request.headers.has("authorization") && !rejected) {
      rejected = true;
      return op.fetch(op.root + "lws");
    }
    return op.fetch(request);
  });
  const providers = createProviders(options, {
    challenge: vi.fn(),
    session: vi.fn(async () => {}),
  });
  expect((await providers.manager.fetch(op.root + "lws")).status).toBe(200);
  expect(op.stats.exchanges).toBe(2);
  const identity = vi.spyOn(OidcIdTokenSource.prototype, "identity").mockResolvedValue(undefined);
  await expect(providers.manager.fetch(op.root + "lws")).rejects.toThrow(
    "did not establish an identity",
  );
  expect(op.stats.exchanges).toBe(2);
  expect(op.stats.accepted).toBe(1);
  identity.mockRestore();
  await providers.manager.logout();
});

test("identity with no azp reports null clientId and does not expose credentials", async () => {
  const op = createMockOp({ omitAzp: true });
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  });
  expect((await auth.login()).clientId).toBeNull();
  const noWebId = createMockOp({ webId: null });
  expect((await noWebId.fetch("https://id.example/alice")).status).toBe(200);
});

test("manager retries one rejected access token and delegates forget to all three providers", async () => {
  const { op, options } = setup();
  let rejected = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === op.root + "private" && request.headers.has("authorization") && !rejected) {
      rejected = true;
      return new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } });
    }
    return op.fetch(request);
  });
  const hooks = { challenge: vi.fn(), session: vi.fn(async () => {}) };
  const providers = createProviders(options, hooks);
  expect((await providers.manager.fetch(op.root + "private")).status).toBe(200);
  expect(op.stats.tokens).toBe(2);
  await providers.manager.logout();
});

test("UMA and unsupported challenge routing respect provider order", async () => {
  const { op, options } = setup();
  const hooks = { challenge: vi.fn(), session: vi.fn(async () => {}) };
  const providers = createProviders(options, hooks);
  const [solid, uma, lws] = providers.manager.client.providers;
  const { challengeContext } = await import("@jeswr/reactive-authentication");
  const request = new Request(op.root + "private");
  const challenge = challengeContext(
    new Response(null, {
      status: 401,
      headers: { "www-authenticate": 'UMA as_uri="https://pod.example/", ticket="test"' },
    }),
  );
  expect(await solid!.matches(request, challenge)).toBe(false);
  expect(await uma!.matches(request, challenge)).toBe(true);
  vi.spyOn(SolidUmaTokenProvider.prototype, "upgrade").mockImplementation(async (request) =>
    providers.solidProvider.upgrade(request),
  );
  await uma!.upgrade(request, challenge);
  const unknown = challengeContext(
    new Response(null, { status: 401, headers: { "www-authenticate": "Unknown" } }),
  );
  expect(await solid!.matches(request, unknown)).toBe(false);
  expect(await uma!.matches(request, unknown)).toBe(false);
  expect(await lws!.matches(request, unknown)).toBe(false);
  const legacy = challengeContext(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate":
          'Bearer as_uri="https://pod.example/", realm="https://pod.example/alice/"',
      },
    }),
  );
  expect(await solid!.matches(request, legacy)).toBe(false);
  expect(await lws!.matches(request, legacy)).toBe(true);
  expect(await solid!.matches(request)).toBe(true);
});

test("boundary uses the most specific root, exact resources ignore query, unknown contexts stay exact", async () => {
  const { options } = setup();
  const boundary = createBoundary(
    {
      ...options,
      boundary: {
        automatic: false,
        roots: [
          "https://pod.example/alice/",
          "https://pod.example/alice/nested/",
          "https://pod.example/exact",
        ],
      },
    },
    {},
  );
  expect(await boundary.contextKey(new Request("https://pod.example/alice/nested/a"))).toBe(
    "https://pod.example/alice/nested/",
  );
  expect(await boundary.contextKey(new Request("https://pod.example/exact?view=1#fragment"))).toBe(
    "https://pod.example/exact",
  );
  expect(await boundary.contextKey(new Request("https://foreign.example/a#fragment"))).toBe(
    "https://foreign.example/a",
  );
  const local = createBoundary(
    {
      ...options,
      allowInsecureLoopback: true,
      boundary: { roots: ["http://localhost/alice/"], eligible: () => true },
    },
    {},
  );
  expect(local.allows("http://localhost/alice/a")).toBe(true);
  expect(local.isCandidate?.("http://remote.example/alice")).toBe(false);
});

test("scoped stores remove only their own data", async () => {
  const store = createMemoryStore();
  const scoped = scopedStore<{ value: number }>(store, "test");
  await store.setItem("outside", { keep: true });
  await scoped.setItem("one", { value: 1 });
  expect(await scoped.getItem("one")).toEqual({ value: 1 });
  await scoped.removeItem("one");
  expect(await scoped.getItem("one")).toBeNull();
  expect(await store.getItem("outside")).toEqual({ keep: true });
});

test("a cancelled login does not pin a subsequent different issuer hint", async () => {
  const first = createMockOp();
  const second = createMockOp({ issuer: "https://other.example/", webId: null });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith(second.issuer) ? second.fetch(request) : first.fetch(request);
  });
  const ui = {
    getWebId: async () => first.webId!,
    getCode: async (_url: URL, _signal: AbortSignal): Promise<string> => {
      throw new Error("cancel");
    },
  };
  const auth = createPodAuth({ clientId: first.clientId, redirectUri: first.redirectUri, ui });
  await expect(auth.login({ issuer: first.issuer })).rejects.toThrow("cancel");
  ui.getCode = second.getCode;
  expect((await auth.login({ issuer: second.issuer })).issuer).toBe(second.issuer);
});

test("HTTP development protocols work only on loopback, including the authorization UI endpoint", async () => {
  const local = createMockOp({ issuer: "http://127.0.0.1:4040/" });
  vi.stubGlobal("fetch", local.fetch);
  const options: PodAuthOptions = {
    clientId: { dynamicRegistration: true },
    redirectUri: "http://localhost/callback",
    allowInsecureLoopback: true,
    ui: { getWebId: async () => local.webId!, getCode: local.getCode },
  };
  expect((await createPodAuth(options).login({ issuer: local.issuer })).issuer).toBe(local.issuer);
  const remote = createMockOp();
  const getCode = vi.fn(remote.getCode);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await remote.fetch(request);
    if (request.url === remote.issuer + ".well-known/openid-configuration") {
      const metadata = await response.json();
      return Response.json({
        ...metadata,
        authorization_endpoint: "http://remote.example/authorize",
      });
    }
    return response;
  });
  const auth = createPodAuth({ ...options, ui: { ...options.ui, getCode } });
  await expect(auth.login({ issuer: remote.issuer })).rejects.toThrow("requires HTTPS");
  expect(getCode).not.toHaveBeenCalled();
});

test("an established session never upgrades an excluded URL or repeats its login UI", async () => {
  const { op, options } = setup();
  const getCode = vi.fn(op.getCode);
  const auth = createPodAuth({ ...options, ui: { ...options.ui, getCode } });
  await auth.login();
  const start = op.requests.length;
  for (const url of ["https://foreign.example/private", "https://pod.example/alice-evil/private"])
    expect((await auth.fetch(url)).status).toBe(401);
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(
    op.requests
      .slice(start)
      .every((request) => !request.headers.has("authorization") && !request.headers.has("dpop")),
  ).toBe(true);
});
