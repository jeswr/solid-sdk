// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { SessionFence } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { forCid, forClientCredentials } from "./node.js";
import { createAgentProviders } from "./providers.js";
import { createMockLwsAs, createMockOp } from "./testing.js";

const documentUrl = "https://agent.example/id";
const keyId = documentUrl + "#key";
const credentials = { clientId: "test-agent", clientSecret: "test-credential" };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function cidFixture(
  challenge: "resource_metadata" | "legacy" = "resource_metadata",
  methodForm: "reference" | "embedded" = "reference",
) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const method = { id: keyId, type: "JsonWebKey", controller: documentUrl, publicKeyJwk };
  const document = {
    id: documentUrl,
    ...(methodForm === "reference" ? { verificationMethod: [method] } : {}),
    authentication: methodForm === "reference" ? [keyId] : [method],
  };
  const as = createMockLwsAs({
    challenge,
    subject: {
      issuer: documentUrl,
      subject: documentUrl,
      clientId: documentUrl,
      tokenType: "jwt",
      publicKey: publicKeyJwk,
    },
  });
  const transport: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    return request.url === documentUrl
      ? Promise.resolve(Response.json(document))
      : as.fetch(request);
  };
  vi.stubGlobal("fetch", transport);
  const cid = { documentUrl, keyId, privateKey: keys.privateKey };
  const options: PodAuthOptions = {
    clientId: "https://app.example/client",
    redirectUri: "https://app.example/callback",
    boundary: { roots: [as.root], automatic: false },
    lws: { subject: { cid } },
    ui: { getWebId: vi.fn(), getCode: vi.fn() },
  };
  return { keys, document, as, cid, options, transport };
}

test.each([
  "resource_metadata",
  "legacy",
] as const)("CID %s challenge signs an AS-bound JWT and reads with Bearer, without UI", async (challenge) => {
  const f = await cidFixture(challenge);
  const auth = createPodAuth(f.options);
  const events: string[] = [];
  const stop = auth.on("login", (e) => {
    events.push(e.type);
    expect(e.identity?.webId).toBeNull();
  });
  auth.on("login", () => {
    throw new Error("observer");
  });
  expect(await auth.restore()).toBeNull();
  expect(await auth.remembered()).toEqual([]);
  await expect(auth.retireIfOwnedBy({ webId: null, issuer: documentUrl })).resolves.toEqual({
    retired: false,
    reason: "no-grant",
  });
  expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
  expect(await auth.identity()).toEqual({
    webId: null,
    issuer: documentUrl,
    subject: documentUrl,
    clientId: documentUrl,
    protocol: "lws",
    storages: [f.as.root],
  });
  expect(f.options.ui.getWebId).not.toHaveBeenCalled();
  expect(f.options.ui.getCode).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(f.transport);
  expect(f.keys.privateKey.extractable).toBe(false);
  expect((await auth.fetch(f.as.root + "other")).status).toBe(200);
  expect(f.as.stats.exchanges).toBe(1);
  const exchange = f.as.requests.find((r) => r.url === f.as.tokenEndpoint)!;
  const form = new URLSearchParams(await exchange.text());
  expect(form.get("resource")).toBe(f.as.storage);
  const [header, claims] = form
    .get("subject_token")!
    .split(".")
    .slice(0, 2)
    .map((x) => JSON.parse(Buffer.from(x, "base64url").toString()));
  expect(header).toMatchObject({ kid: keyId, alg: "ES256" });
  expect(claims).toMatchObject({
    sub: documentUrl,
    iss: documentUrl,
    client_id: documentUrl,
    aud: [f.as.issuer],
  });
  expect(claims.exp - claims.iat).toBe(300);
  expect(await auth.restore()).toEqual(await auth.identity());
  await expect(auth.login({ webId: documentUrl })).rejects.toThrow("selected account");
  await expect(auth.login({ issuer: "https://other.example" })).rejects.toThrow("selected account");
  const a = auth.login({ issuer: documentUrl });
  expect(auth.login()).toBe(a);
  await a;
  const identity = (await auth.identity())!;
  identity.storages = [];
  identity.subject = "mutated";
  expect((await auth.identity())?.subject).toBe(documentUrl);
  stop();
  stop();
  let logouts = 0;
  auth.on("logout", () => {
    logouts++;
  });
  const logout = auth.logout();
  expect(auth.logout()).toBe(logout);
  await expect(auth.login()).rejects.toThrow("Logout");
  await logout;
  expect(logouts).toBe(1);
  expect(await auth.identity()).toBeNull();
  expect(await auth.restore()).toBeNull();
  expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
  expect(f.as.stats.exchanges).toBe(2);
  expect(events).toEqual(["login"]);
});

test("Node CID factory resolves an existing identity and cached-token rejection invalidates the provider", async () => {
  const f = await cidFixture();
  const auth = await forCid({ ...f.cid, boundary: [f.as.root], clock: () => 7 });
  const cancelled = new AbortController();
  cancelled.abort(new Error("cancelled"));
  await expect(auth.login(undefined, { signal: cancelled.signal })).rejects.toThrow("cancelled");
  const event = vi.fn();
  auth.on("challenge", event);
  await auth.fetch(f.as.root + "private");
  f.as.rejectAccessTokens();
  expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
  expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
  expect(f.as.stats.exchanges).toBe(2);
  expect(event).toHaveBeenCalledWith(
    expect.objectContaining({ timestamp: 7, url: f.as.root + "private" }),
  );
});

test.each([
  "node",
  "core",
] as const)("%s CID document resolution omits ambient credentials", async (mode) => {
  const f = await cidFixture();
  const requests: Request[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl) requests.push(request);
    return f.transport(request);
  });
  const auth =
    mode === "node" ? await forCid({ ...f.cid, boundary: [f.as.root] }) : createPodAuth(f.options);
  await auth.login();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.credentials).toBe("omit");
  expect(requests[0]!.redirect).toBe("error");
  expect(requests[0]!.headers.has("authorization")).toBe(false);
  expect(await auth.identity()).toMatchObject({ subject: documentUrl });
});

test.each([
  ["node", "resource_metadata"],
  ["node", "legacy"],
  ["core", "resource_metadata"],
  ["core", "legacy"],
] as const)("%s CID accepts an embedded authentication method with %s", async (mode, challenge) => {
  const f = await cidFixture(challenge, "embedded");
  expect((await f.as.fetch(f.as.root + "private")).status).toBe(401);
  const auth =
    mode === "node" ? await forCid({ ...f.cid, boundary: [f.as.root] }) : createPodAuth(f.options);
  expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
  expect(await auth.identity()).toMatchObject({ subject: documentUrl, protocol: "lws" });
  expect(f.as.stats.exchanges).toBe(1);
  expect(f.options.ui.getWebId).not.toHaveBeenCalled();
  expect(f.options.ui.getCode).not.toHaveBeenCalled();
});

test.each([
  "controller",
  "type",
  "private",
  "mismatch",
  "duplicate",
  "duplicate-top-level",
  "foreign-id",
  "null",
])("embedded CID authentication fails closed: %s", async (kind) => {
  const f = await cidFixture("resource_metadata", "embedded");
  const doc: any = structuredClone(f.document);
  const method = doc.authentication[0];
  if (kind === "controller") method.controller = "https://other.example/id";
  if (kind === "type") method.type = "unknown";
  if (kind === "private") method.publicKeyJwk.d = "forbidden";
  if (kind === "mismatch") {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    method.publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  }
  if (kind === "duplicate") doc.authentication.push(structuredClone(method));
  if (kind === "duplicate-top-level") doc.verificationMethod = [structuredClone(method)];
  if (kind === "foreign-id") method.id = "https://other.example/id#key";
  if (kind === "null") doc.authentication = [null, keyId];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    new Request(input, init).url === documentUrl
      ? Promise.resolve(Response.json(doc))
      : f.as.fetch(input, init),
  );
  await expect(forCid({ ...f.cid, boundary: [f.as.root] })).rejects.toThrow();
  const auth = createPodAuth(f.options);
  await expect(auth.fetch(f.as.root + "private")).rejects.toThrow();
  expect(await auth.identity()).toBeNull();
  expect(f.as.stats.exchanges).toBe(0);
});

test.each([
  "missing",
  "mismatch",
  "authentication",
  "controller",
  "type",
  "private",
  "duplicate",
  "bad-jwk",
  "null",
  "null-method",
  "no-methods",
])("CID subject resolution fails closed: %s", async (kind) => {
  const f = await cidFixture();
  const doc: any = structuredClone(f.document);
  if (kind === "missing") doc.verificationMethod = [];
  if (kind === "mismatch") {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    doc.verificationMethod[0].publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  }
  if (kind === "authentication") doc.authentication = null;
  if (kind === "controller") doc.verificationMethod[0].controller = "https://other.example/id";
  if (kind === "type") doc.verificationMethod[0].type = "unknown";
  if (kind === "private") doc.verificationMethod[0].publicKeyJwk.d = "forbidden";
  if (kind === "duplicate") doc.verificationMethod.push(doc.verificationMethod[0]);
  if (kind === "bad-jwk") doc.verificationMethod[0].publicKeyJwk = "invalid";
  if (kind === "null-method") doc.verificationMethod = [null];
  if (kind === "no-methods") delete doc.verificationMethod;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    new Request(input, init).url === documentUrl
      ? Promise.resolve(Response.json(kind === "null" ? null : doc))
      : f.as.fetch(input, init),
  );
  const auth = createPodAuth(f.options);
  await expect(auth.fetch(f.as.root + "private")).rejects.toThrow();
  expect(await auth.identity()).toBeNull();
  expect(f.as.stats.exchanges).toBe(0);
});

test.each([
  "status",
  "redirect",
  "wrong-id",
  "not-authenticated",
  "missing-jwk",
  "import",
])("CID document failure %s never signs and can be retried", async (kind) => {
  const f = await cidFixture();
  const doc: any = structuredClone(f.document);
  if (kind === "wrong-id") doc.id = "https://other.example/id";
  if (kind === "not-authenticated") doc.authentication = [];
  if (kind === "missing-jwk") delete doc.verificationMethod[0].publicKeyJwk;
  if (kind === "import") doc.verificationMethod[0].publicKeyJwk = {};
  let fail = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url !== documentUrl) return f.as.fetch(request);
    expect(request.redirect).toBe("error");
    expect(request.headers.has("authorization")).toBe(false);
    if (!fail) return Response.json(f.document);
    const response = Response.json(doc, { status: kind === "status" ? 404 : 200 });
    if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  const auth = createPodAuth(f.options);
  await expect(auth.login()).rejects.toThrow();
  fail = false;
  expect((await auth.login()).subject).toBe(documentUrl);
});

test("invalid discovery and excluded resource never resolve CID or release credentials", async () => {
  const f = await cidFixture();
  const resolve = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl) resolve();
    if (request.url.includes("oauth-protected-resource"))
      return Response.json({
        resource: "https://evil.example/",
        authorization_servers: [f.as.issuer],
      });
    return f.transport(request);
  });
  const auth = createPodAuth(f.options);
  expect((await auth.fetch("https://foreign.example/private")).status).toBe(401);
  await expect(auth.fetch(f.as.root + "private")).rejects.toThrow();
  expect(resolve).not.toHaveBeenCalled();
  expect(f.as.stats.exchanges).toBe(0);
});

test("canceling a CID fetch leaves shared resolution available to an independent login", async () => {
  const f = await cidFixture();
  const started = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<void>();
  const resolve = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl) {
      resolve();
      started.resolve(request);
      await release.promise;
      request.signal.throwIfAborted();
    }
    return f.transport(request);
  });
  const auth = createPodAuth(f.options);
  const controller = new AbortController();
  const pending = auth.fetch(f.as.root + "private", { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const resolution = await started.promise;
  const login = auth.login();
  controller.abort();
  try {
    expect(resolution.signal.aborted).toBe(false);
    // Cancellation settles the caller even while the shared transport is still blocked.
    await rejected;
    expect(await auth.identity()).toBeNull();
    release.resolve();
    await expect(login).resolves.toMatchObject({ subject: documentUrl });
    expect((await auth.fetch(f.as.root + "private")).status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(f.as.stats.exchanges).toBe(1);
  } finally {
    release.resolve();
    await Promise.allSettled([rejected, login]);
  }
});

test("an abandoned CID resolution failure is handled and a later login retries", async () => {
  const f = await cidFixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let attempts = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl && ++attempts === 1) {
      started.resolve();
      await release.promise;
      throw new Error("CID temporarily unavailable");
    }
    return f.transport(request);
  });
  const auth = createPodAuth(f.options);
  const controller = new AbortController();
  const pending = auth.fetch(f.as.root + "private", { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await started.promise;
  controller.abort();
  try {
    await rejected;
    release.resolve();
    // Drain the delayed failure and its cache cleanup before starting a retry.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(auth.login()).resolves.toMatchObject({ subject: documentUrl });
    expect(attempts).toBe(2);
  } finally {
    release.resolve();
    await Promise.allSettled([rejected]);
  }
});

test("logout cancels CID waiters and a stale resolution failure preserves the new session cache", async () => {
  const f = await cidFixture();
  const started = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<void>();
  let attempts = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl && ++attempts === 1) {
      started.resolve(request);
      // Deliberately ignore cancellation, as a late transport/body failure still needs fencing.
      await release.promise;
      throw new Error("stale resolution failed");
    }
    return f.transport(request);
  });
  const providers = createAgentProviders(
    f.options,
    { kind: "cid", cid: f.cid },
    { challenge: vi.fn(), session: vi.fn() },
  );
  const pending = providers.login();
  const rejected = expect(pending).rejects.toThrow();
  const resolution = await started.promise;
  try {
    await providers.manager.logout();
    expect(resolution.signal.aborted).toBe(true);
    await rejected;
    await providers.login();
    release.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await providers.login();
    expect(attempts).toBe(2);
  } finally {
    release.resolve();
    await Promise.allSettled([rejected]);
  }
});

test("logout fences delayed CID resolution and exchange", async () => {
  for (const hop of [documentUrl, "https://lws.example/exchange"]) {
    const f = await cidFixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url === hop) {
        started.resolve();
        await release.promise;
      }
      return f.transport(request);
    });
    const auth = createPodAuth(f.options);
    const pending = auth.fetch(f.as.root + "private");
    const rejected = expect(pending).rejects.toThrow();
    await started.promise;
    await auth.logout();
    release.resolve();
    await rejected;
    expect(await auth.identity()).toBeNull();
    expect(f.as.stats.accepted).toBe(0);
  }
});

test.each([
  "extractable",
  "public",
  "wrong-curve",
  "wrong-algorithm",
  "missing",
  "object",
  "wrong-usage",
  "fragment",
  "foreign-key",
  "no-fragment",
  "no-cid",
])("CID options reject unsafe configuration: %s", async (kind) => {
  const f = await cidFixture();
  const cid: any = { ...f.cid };
  if (kind === "extractable")
    cid.privateKey = (
      await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ])
    ).privateKey;
  if (kind === "public") cid.privateKey = f.keys.publicKey;
  if (kind === "wrong-curve")
    cid.privateKey = (
      await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
        "sign",
        "verify",
      ])
    ).privateKey;
  if (kind === "wrong-algorithm")
    cid.privateKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
  if (kind === "missing") delete cid.privateKey;
  if (kind === "object") cid.privateKey = {};
  if (kind === "wrong-usage") {
    cid.privateKey = f.keys.privateKey;
    vi.spyOn(cid.privateKey, "usages", "get").mockReturnValue([]);
  }
  if (kind === "fragment") cid.documentUrl += "#fragment";
  if (kind === "foreign-key") cid.keyId = "https://evil.example/key#key";
  if (kind === "no-fragment") cid.keyId = documentUrl;
  expect(() =>
    createPodAuth({
      ...f.options,
      lws: { subject: { cid: kind === "no-cid" ? undefined : cid } },
    } as any),
  ).toThrow();
});

test("client credentials use real DPoP grant/cache, static boundary, opaque identity and no global patch", async () => {
  const op = createMockOp({ clientCredentials: credentials });
  vi.stubGlobal("fetch", op.fetch);
  const auth = await forClientCredentials({
    issuer: op.issuer,
    ...credentials,
    boundary: [op.root],
  });
  expect(await auth.identity()).toEqual({
    webId: null,
    issuer: op.issuer,
    subject: credentials.clientId,
    clientId: credentials.clientId,
    protocol: "solid-oidc",
    storages: [op.root],
  });
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.authorizations).toBe(0);
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  expect((await auth.fetch(op.root + "other")).status).toBe(200);
  expect(op.stats.tokens).toBe(1);
  expect(globalThis.fetch).toBe(op.fetch);
  for (const url of [
    "https://foreign.example/",
    "https://pod.example/alice-evil/",
    op.root + "lws",
  ])
    expect((await auth.fetch(url)).status).toBe(401);
  await auth.logout();
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  expect(op.stats.tokens).toBe(2);
  const token = op.requests.find((r) => r.url === op.issuer + "token")!;
  expect(token.headers.has("dpop")).toBe(true);
  expect(new URLSearchParams(await token.text()).get("grant_type")).toBe("client_credentials");
  expect(
    op.requests
      .filter((r) => !r.url.startsWith(op.issuer))
      .every((r) => !r.headers.get("authorization")?.startsWith("Basic ")),
  ).toBe(true);
});

test("client credentials reject failed grants, metadata and unexpected challenges", async () => {
  const op = createMockOp({ clientCredentials: credentials });
  vi.stubGlobal("fetch", op.fetch);
  await expect(
    forClientCredentials({
      issuer: op.issuer,
      clientId: credentials.clientId,
      clientSecret: "wrong-test-credential",
      boundary: [op.root],
    }),
  ).rejects.toThrow();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === op.root + "uma")
      return new Response(null, {
        status: 401,
        headers: { "www-authenticate": 'UMA as_uri="https://evil.example/", ticket="ticket"' },
      });
    if (request.url === op.root + "none")
      return new Response(null, {
        status: 401,
        headers: { "www-authenticate": 'Unknown realm="x"' },
      });
    if (request.url === op.root + "legacy")
      return new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer as_uri="https://evil.example/", realm="https://pod.example/storage"',
        },
      });
    if (request.url === op.root + "bearer" && !request.headers.has("authorization"))
      return new Response(null, {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="storage"' },
      });
    return op.fetch(request);
  });
  const auth = await forClientCredentials({
    issuer: op.issuer,
    ...credentials,
    boundary: [op.root],
  });
  expect((await auth.fetch(op.root + "uma")).status).toBe(401);
  expect((await auth.fetch(op.root + "none")).status).toBe(401);
  expect((await auth.fetch(op.root + "legacy")).status).toBe(401);
  expect((await auth.fetch(op.root + "bearer")).status).toBe(200);
});

test.each([
  { boundary: [] },
  { boundary: null },
  { clock: 2 },
  { issuer: "http://remote.example/" },
  { issuer: "https://op.example/#x" },
  { issuer: "https://op.example/?x=1" },
  { clientId: "" },
  { clientId: 1 },
  { clientSecret: "" },
  { clientSecret: 1 },
  { boundary: ["http://remote.example/"] },
])("Node options reject invalid configuration %#", async (patch) => {
  await expect(
    forClientCredentials({
      issuer: "https://op.example/",
      ...credentials,
      boundary: ["https://pod.example/"],
      ...patch,
    } as any),
  ).rejects.toThrow();
});

test("Node loopback opt-in is development-only and enforced on discovered hops", async () => {
  const op = createMockOp({ clientCredentials: credentials });
  vi.stubGlobal("fetch", op.fetch);
  vi.stubEnv("NODE_ENV", "production");
  await expect(
    forClientCredentials({
      issuer: op.issuer,
      ...credentials,
      boundary: [op.root],
      allowInsecureLoopback: true,
    }),
  ).rejects.toThrow("local development");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.includes("openid-configuration"))
      return Response.json({
        issuer: "http://localhost:8080/",
        token_endpoint: "http://remote.example/token",
      });
    return op.fetch(request);
  });
  await expect(
    forClientCredentials({
      issuer: "http://localhost:8080/",
      ...credentials,
      boundary: [op.root],
      allowInsecureLoopback: true,
    }),
  ).rejects.toThrow("loopback");
});

test("logout from a login observer supersedes the explicit agent login", async () => {
  const f = await cidFixture();
  const auth = createPodAuth(f.options);
  let logout: Promise<void> | undefined;
  auth.on("login", () => {
    logout = auth.logout();
  });
  await expect(auth.login()).rejects.toThrow("Session changed");
  await logout;
  expect(await auth.identity()).toBeNull();
});

test.each([
  "missing",
  "scheme",
  "id",
  "unconfigured",
])("mock OP rejects invalid Basic client authentication: %s", async (kind) => {
  const op = createMockOp(kind === "unconfigured" ? {} : { clientCredentials: credentials });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/token")) {
      const headers = new Headers(request.headers);
      if (kind === "missing") headers.delete("authorization");
      if (kind === "scheme") headers.set("authorization", "Other ignored");
      return op.fetch(new Request(request, { headers }));
    }
    return op.fetch(request);
  });
  await expect(
    forClientCredentials({
      issuer: op.issuer,
      ...credentials,
      clientId: kind === "id" ? "other-test-agent" : credentials.clientId,
      boundary: [op.root],
    }),
  ).rejects.toThrow();
});

test("agent session cannot publish while logout is awaiting durable supersession", async () => {
  const f = await cidFixture();
  const resolved = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === documentUrl) {
      resolved.resolve();
      await release.promise;
    }
    return f.transport(request);
  });
  const supersede = SessionFence.prototype.supersede;
  const logoutStarted = Promise.withResolvers<void>();
  const logoutRelease = Promise.withResolvers<void>();
  vi.spyOn(SessionFence.prototype, "supersede").mockImplementation(async function (...args) {
    logoutStarted.resolve();
    await logoutRelease.promise;
    return supersede.apply(this, args);
  });
  const auth = createPodAuth(f.options);
  const pending = auth.login();
  const rejected = expect(pending).rejects.toThrow("Logout is in progress");
  await resolved.promise;
  const logout = auth.logout();
  await logoutStarted.promise;
  release.resolve();
  await rejected;
  logoutRelease.resolve();
  await logout;
  expect(await auth.identity()).toBeNull();
});

test("client-credentials composition accepts proactive matching without a challenge", async () => {
  const providers = createAgentProviders(
    { boundary: { roots: ["https://pod.example/"], automatic: false } },
    { kind: "client-credentials", issuer: "https://op.example/", ...credentials },
    { challenge: vi.fn(), session: vi.fn() },
  );
  expect(
    await providers.manager.client.providers[0]!.matches(
      new Request("https://pod.example/private"),
    ),
  ).toBe(true);
});

test.each([
  { algorithms: [] },
  { algorithms: ["EdDSA"] },
  { algorithms: ["ES256", "EdDSA"] },
])("client credentials require ES256 support: %j", async ({ algorithms }) => {
  const op = createMockOp({ clientCredentials: credentials });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await op.fetch(request);
    if (request.url.includes("openid-configuration"))
      return Response.json({
        ...(await response.json()),
        dpop_signing_alg_values_supported: algorithms,
      });
    return response;
  });
  const auth = forClientCredentials({ issuer: op.issuer, ...credentials, boundary: [op.root] });
  if (algorithms.includes("ES256"))
    await expect((await auth).identity()).resolves.toMatchObject({
      clientId: credentials.clientId,
    });
  else {
    await expect(auth).rejects.toThrow("ES256");
    expect(op.stats.tokens).toBe(0);
  }
});

test("Node credentials capture an injected transport without replacing global fetch", async () => {
  const original = globalThis.fetch;
  const op = createMockOp({ clientCredentials: credentials });
  const auth = await forClientCredentials({
    issuer: op.issuer,
    clientId: "test-agent",
    clientSecret: "test-credential",
    boundary: [op.root],
    fetch: op.fetch,
  });
  expect(globalThis.fetch).toBe(original);
  expect((await auth.identity())?.webId).toBeNull();
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  await expect(
    forClientCredentials({
      issuer: op.issuer,
      clientId: "id",
      clientSecret: "secret",
      boundary: [op.root],
      fetch: "invalid" as unknown as typeof fetch,
    }),
  ).rejects.toThrow("fetch must be a function");
});
