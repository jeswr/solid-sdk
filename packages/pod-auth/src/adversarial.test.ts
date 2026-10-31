// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  DPoPTokenProvider,
  OidcIdTokenSource,
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
