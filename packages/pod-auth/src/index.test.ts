// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AmbiguousIssuerError,
  createPodAuth,
  IssuerNotAuthorizedError,
  type PodAuthOptions,
} from "./index.js";
import * as node from "./node.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fixture(
  config: Parameters<typeof createMockOp>[0] = {},
  extra: Partial<PodAuthOptions> = {},
) {
  const op = createMockOp(config);
  vi.stubGlobal("fetch", op.fetch);
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root], automatic: false },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
    ...extra,
  };
  return { op, options, auth: createPodAuth(options) };
}

test("explicit WebID login, validated claims, PKCE + DPoP authenticated read, pristine global fetch", async () => {
  const { op, options, auth } = fixture({ requireInteraction: true }, { clock: () => 42 });
  const events: unknown[] = [];
  const stop = auth.on("login", (e) => events.push(e));
  auth.on("login", () => {
    throw Error("observer");
  });
  expect(await auth.identity()).toBeNull();
  const identity = await auth.login({ webId: op.webId });
  expect(identity).toEqual({
    grantId: expect.any(String),
    webId: op.webId,
    issuer: op.issuer,
    subject: op.subject,
    clientId: op.clientId,
    protocol: "solid-oidc",
    storages: [op.root],
  });
  expect(events).toEqual([{ type: "login", identity, timestamp: 42 }]);
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  expect(op.stats.authorizations).toBe(1);
  expect(op.stats.tokens).toBe(1);
  expect(globalThis.fetch).toBe(op.fetch);
  const { fetch: authFetch } = auth;
  expect(await (await authFetch(op.root + "private?x=1")).text()).toBe("protected Solid");
  expect(op.stats.tokens).toBe(1);
  const tokenRequest = op.requests.find((r) => r.url === op.issuer + "token")!;
  expect(tokenRequest.headers.has("dpop")).toBe(true);
  const params = new URLSearchParams(await tokenRequest.text());
  expect(params.has("code_verifier")).toBe(true);
  expect(op.requests.some((r) => r.url === op.root)).toBe(false);
  identity.storages = [];
  identity.subject = "changed";
  expect((await auth.identity())?.subject).toBe(op.subject);
  expect((await auth.login()).storages).toEqual([op.root]);
  stop();
  stop();
  expect(node.forClientCredentials).toBeTypeOf("function");
});

test("implicit login emits challenge before login, caches by root and supports unsubscribe", async () => {
  const { op, auth, options } = fixture();
  const events: string[] = [];
  const handler = () => events.push("removed");
  const stop = auth.on("challenge", handler);
  auth.on("challenge", () => events.push("challenge"));
  auth.on("login", () => events.push("login"));
  stop();
  expect((await auth.fetch(op.root + "one")).status).toBe(200);
  expect((await auth.fetch(op.root + "two", { method: "PUT", body: "hello" })).status).toBe(200);
  expect(events).toEqual(["challenge", "login", "challenge"]);
  expect(options.ui.getWebId).toHaveBeenCalledTimes(1);
  expect(op.stats.tokens).toBe(1);
});

test("outside static boundary, sibling, lookalike, port and downgraded URLs never prompt or upgrade", async () => {
  const { op, auth, options } = fixture();
  for (const url of [
    "https://foreign.example/private",
    "https://pod.example/alice-evil/a",
    "https://pod.example.attacker.test/alice/a",
    "https://pod.example:9443/alice/a",
    "http://pod.example/alice/a",
  ]) {
    expect((await auth.fetch(url)).status).toBe(401);
  }
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  expect(options.ui.getCode).not.toHaveBeenCalled();
  expect(op.requests.every((r) => !r.headers.has("authorization") && !r.headers.has("dpop"))).toBe(
    true,
  );
  expect(await auth.identity()).toBeNull();
});

test("issuer hint skips WebID picker and validates token WebID issuer binding", async () => {
  const { op, auth, options } = fixture();
  await auth.login({ issuer: op.issuer });
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  expect(op.requests.some((r) => r.url.startsWith("https://id.example"))).toBe(true);
});

test.each([
  ["automatic", "https://id.example/alice#me"],
  ["automatic", null],
  ["static", "https://id.example/alice#me"],
  ["static", null],
] as const)("issuer-only login supports later storage contexts with %s boundaries and WebID %s", async (boundaryKind, webId) => {
  const root = "https://pod.example/alice/";
  const { op, auth, options } = fixture(
    { webId },
    {
      boundary:
        boundaryKind === "automatic"
          ? undefined
          : { roots: [root, root + "nested/"], automatic: false },
    },
  );
  expect((await auth.login({ issuer: op.issuer })).webId).toBe(webId);
  if (boundaryKind === "automatic" && webId === null) {
    expect((await auth.fetch(root + "private")).status).toBe(401);
    expect(op.stats.tokens).toBe(1);
    expect(op.stats.accepted).toBe(0);
    return;
  }
  for (const path of ["private", "nested/private", "private", "nested/private"]) {
    expect(await (await auth.fetch(root + path)).text()).toBe("protected Solid");
    expect((await auth.identity())?.issuer).toBe(op.issuer);
  }
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  // The login grant covers the first verified root; only a distinct static root needs another.
  expect(op.stats.tokens).toBe(boundaryKind === "automatic" ? 1 : 2);
  expect(op.stats.accepted).toBe(4);
});

test.each([
  "https://op.example",
  "https://op.example/",
])("origin-only issuer hint %s accepts slashless validated claims and an existing session", async (issuer) => {
  const { op, auth, options } = fixture({ issuer: "https://op.example" });
  const identity = await auth.login({ issuer });
  expect(identity.issuer).toBe(op.issuer);
  expect(await auth.login({ issuer: "https://op.example" })).toEqual(identity);
  expect(await auth.login({ issuer: "https://op.example/" })).toEqual(identity);
  expect(options.ui.getCode).toHaveBeenCalledTimes(1);
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  expect(op.stats.tokens).toBe(1);
});

test("issuer hints preserve the distinction between tenant paths with and without a slash", async () => {
  const op = createMockOp({ issuer: "https://op.example/tenant" });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    // Serve the path issuer's discovery document at the OIDC discovery URL.
    return request.url.includes(".well-known/openid-configuration")
      ? op.fetch(new URL(".well-known/openid-configuration", op.issuer))
      : op.fetch(request);
  });
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
  });
  await auth.login({ issuer: op.issuer });
  await expect(auth.login({ issuer: op.issuer + "/" })).rejects.toThrow("Account changes");
});

test.each([
  false,
  true,
  undefined,
])("offline_access is negotiated from provider support (%s)", async (supported) => {
  const op = createMockOp();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === op.issuer + ".well-known/openid-configuration") {
      const metadata = await (await op.fetch(request)).json();
      delete metadata.scopes_supported;
      return Response.json({
        ...metadata,
        ...(supported === undefined
          ? {}
          : { scopes_supported: ["openid", "webid", ...(supported ? ["offline_access"] : [])] }),
      });
    }
    const url = new URL(request.url);
    if (
      supported === false &&
      url.pathname === "/authorize" &&
      url.searchParams.get("scope")?.split(" ").includes("offline_access")
    ) {
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("iss", op.issuer);
      callback.searchParams.set("error", "invalid_scope");
      return new Response(null, { status: 302, headers: { location: callback.href } });
    }
    return op.fetch(request);
  });
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: {
      getWebId: async () => op.webId!,
      // Route the injected UI transport through the same strict scope check.
      getCode: async (url, signal) => {
        const response = await globalThis.fetch(url, { signal, redirect: "manual" });
        return response.headers.get("location")!;
      },
    },
  });
  await auth.login();
  const authorization = op.requests.find((r) => new URL(r.url).pathname === "/authorize")!;
  const scopes = new URL(authorization.url).searchParams.get("scope")!.split(" ");
  expect(scopes).toEqual(
    supported === false ? ["openid", "webid"] : ["openid", "webid", "offline_access"],
  );
  expect((await auth.identity())?.webId).toBe(op.webId);
});

test("WebID and issuer hint must agree before authorization", async () => {
  const { op, auth } = fixture();
  await expect(auth.login({ webId: op.webId, issuer: "https://evil.example/" })).rejects.toThrow(
    "not listed",
  );
  expect(op.stats.authorizations).toBe(0);
});

test("ambiguous issuers require an injected chooser which may select only a listed issuer", async () => {
  const issuers = ["https://op.example/", "https://other.example/"];
  const f = fixture({ issuers });
  await expect(f.auth.login()).rejects.toBeInstanceOf(AmbiguousIssuerError);
  expect(f.op.stats.tokens).toBe(0);
  const selected = fixture({ issuers });
  const choose = vi.fn(async () => issuers[0]!);
  selected.options.ui.chooseIssuer = choose;
  await selected.auth.login();
  expect(choose).toHaveBeenCalledWith(issuers);
  const rejected = fixture({ issuers });
  rejected.options.ui.chooseIssuer = async () => "https://unlisted.example/";
  await expect(rejected.auth.login()).rejects.toThrow("not listed");
});

test("missing issuers, invalid WebIDs and UI cancellation fail closed", async () => {
  const missing = fixture({ issuers: [] });
  await expect(missing.auth.login()).rejects.toThrow("lacks OIDC issuer");
  const invalid = fixture();
  invalid.options.ui.getWebId = async () => "http://remote.example/id";
  await expect(invalid.auth.login()).rejects.toThrow("requires HTTPS");
  invalid.options.ui.getWebId = async () => {
    throw new Error("cancelled");
  };
  await expect(invalid.auth.login()).rejects.toThrow("cancelled");
  invalid.options.ui.getWebId = async () => invalid.op.webId!;
  invalid.options.ui.getCode = async () => {
    throw new Error("code cancelled");
  };
  await expect(invalid.auth.login()).rejects.toThrow("code cancelled");
  expect(await invalid.auth.identity()).toBeNull();
});

test("invalid login hint rejects asynchronously before UI or network", async () => {
  const { auth, op } = fixture();
  await expect(auth.login({ webId: "not a URL" })).rejects.toThrow("absolute URL");
  await expect(auth.login({ issuer: "http://op.example/" })).rejects.toThrow("requires HTTPS");
  expect(op.requests).toHaveLength(0);
});

test("same-hint concurrent login is single flight; other hints and account switches reject", async () => {
  const { auth, op, options } = fixture();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  options.ui.getCode = async (...args) => {
    ready.resolve();
    await release.promise;
    return op.getCode(...args);
  };
  const a = auth.login({ issuer: op.issuer });
  const b = auth.login({ issuer: op.issuer });
  expect(a).toBe(b);
  await ready.promise;
  await expect(auth.login({ webId: op.webId })).rejects.toThrow("in progress");
  release.resolve();
  await a;
  expect(op.stats.tokens).toBe(1);
  expect(await auth.login({ issuer: op.issuer })).toEqual(await auth.identity());
  await expect(auth.login({ issuer: "https://other.example/" })).rejects.toThrow("Account changes");
  await expect(auth.login({ webId: "https://id.example/bob" })).rejects.toThrow("Account changes");
});

test("selected account must match authenticated claims and issuer profile trust", async () => {
  const f = fixture();
  await expect(f.auth.login({ webId: "https://id.example/bob" })).rejects.toThrow(
    "selected account",
  );
  expect(await f.auth.identity()).toBeNull();
  const untrusted = fixture({ issuers: ["https://evil.example/"] });
  await expect(untrusted.auth.login({ issuer: untrusted.op.issuer })).rejects.toBeInstanceOf(
    IssuerNotAuthorizedError,
  );
  expect(await untrusted.auth.identity()).toBeNull();
});

test.each([
  "login",
  "private",
  "lws",
])("the UI-selected WebID must match claims before credential use through %s", async (operation) => {
  const { auth, op, options } = fixture();
  options.ui.getWebId = async () => "https://id.example/bob";
  const login = vi.fn();
  auth.on("login", login);
  await expect(
    operation === "login" ? auth.login() : auth.fetch(op.root + operation),
  ).rejects.toThrow("selected account");
  expect(await auth.identity()).toBeNull();
  expect(login).not.toHaveBeenCalled();
  expect(op.stats.accepted).toBe(0);
  expect(op.stats.exchanges).toBe(0);
  expect(
    op.requests.some(
      (request) => request.url.startsWith(op.root) && request.headers.has("authorization"),
    ),
  ).toBe(false);
});

test("automatic boundary loads profile storages after login and eligible restricts even static roots", async () => {
  const f = fixture({}, { boundary: {} });
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(401);
  expect(f.options.ui.getWebId).not.toHaveBeenCalled();
  await f.auth.login();
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(200);
  expect((await f.auth.identity())?.storages).toContain(f.op.root);
  const g = fixture(
    { redirectUri: undefined },
    { boundary: { roots: ["https://pod.example/alice/"], eligible: () => false } },
  );
  expect((await g.auth.fetch(g.op.root + "private")).status).toBe(401);
  expect(g.options.ui.getCode).not.toHaveBeenCalled();
  expect((await f.auth.fetch("https://unverified.example/a")).status).toBe(401);
});

test("LWS RFC9728 exchanges the current Solid ID token without a second login", async () => {
  const { auth, op } = fixture();
  await auth.login();
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("lws");
  expect(op.stats.exchanges).toBe(1);
  expect(op.stats.tokens).toBe(1);
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("solid-oidc");
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("lws");
  expect(op.stats.exchanges).toBe(1);
});

test("LWS can be the first authentication request", async () => {
  const { auth, op } = fixture();
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("lws");
});

test("an LWS-first session is reused across boundary roots", async () => {
  const { auth, op, options } = fixture(
    {},
    {
      boundary: {
        roots: ["https://pod.example/alice/", "https://pod.example/alice/nested/"],
        automatic: false,
      },
    },
  );
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.fetch(op.root + "nested/lws")).status).toBe(200);
  expect(options.ui.getWebId).toHaveBeenCalledTimes(1);
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.exchanges).toBe(1);
});

test("identity may have no WebID and reports no token material", async () => {
  const { auth, op } = fixture({ webId: null });
  const identity = await auth.login({ issuer: op.issuer });
  expect(identity.webId).toBeNull();
  expect(Object.keys(identity).sort()).toEqual([
    "clientId",
    "grantId",
    "issuer",
    "protocol",
    "storages",
    "subject",
    "webId",
  ]);
});

test("custom KV stores are namespaced and errors fail closed", async () => {
  const sessions = createMemoryStore();
  const caches = createMemoryStore();
  await sessions.setItem("unrelated", { keep: true });
  const f = fixture({}, { storage: { sessions, caches } });
  await f.auth.login();
  expect(await sessions.getItem("unrelated")).toEqual({ keep: true });
  expect((await f.auth.fetch(f.op.root + "private")).status).toBe(200);
  const broken = fixture(
    { redirectUri: undefined },
    {
      storage: {
        sessions,
        caches: {
          ...caches,
          getItem: async () => {
            throw new Error("unavailable");
          },
        },
      },
    },
  );
  await expect(broken.auth.login()).rejects.toMatchObject({
    cause: { message: "unavailable" },
  });
});

describe("option validation", () => {
  test.each([
    null,
    { redirectUri: undefined },
    { redirectUri: 4 },
    { clientId: null },
    { clientId: "http://localhost/client" },
    { clientId: "https://user:password@app.example/id" },
    { clientId: "data:text/plain,hi" },
    { clientId: "https://app.example/id#fragment" },
    { clientId: { dynamicRegistration: true } },
    { clientId: { dynamicRegistration: false } },
    { clientId: { dynamicRegistration: true, extra: true } },
    { redirectUri: "https://app.example/callback?code=1" },
    { redirectUri: "https://app.example/callback#fragment" },
    { redirectUri: "relative" },
    { redirectUri: "http://app.example/callback" },
    { ui: {} },
    { ui: { getWebId: async () => "", getCode: async () => "", chooseIssuer: true } },
    { clock: 1 },
    { boundary: { automatic: "false" } },
    { boundary: { eligible: true } },
    { boundary: { roots: 4 } },
    { boundary: { roots: [4] } },
    { boundary: { roots: ["http://remote.example/"] } },
    { boundary: { roots: ["https://pod.example/a%2fb/"] } },
    { allowInsecureLoopback: true },
    { storage: {} },
    { storage: { sessions: {}, caches: {} } },
    { lws: { subject: { cid: { documentUrl: "https://agent.example/", keyId: "#key" } } } },
  ])("rejects malformed options %#", (patch) => {
    const op = createMockOp();
    const options = {
      clientId: op.clientId,
      redirectUri: op.redirectUri,
      ui: { getWebId: async () => op.webId!, getCode: op.getCode },
      ...patch,
    } as PodAuthOptions;
    expect(() =>
      createPodAuth(patch === null ? (null as unknown as PodAuthOptions) : options),
    ).toThrow();
  });
  test("dynamic registration is only for loopback and disabled in production", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const op = createMockOp();
      vi.stubGlobal("fetch", op.fetch);
      const auth = createPodAuth({
        clientId: { dynamicRegistration: true },
        redirectUri: `http://${host}:8080/callback`,
        allowInsecureLoopback: true,
        boundary: { automatic: false },
        ui: { getWebId: async () => op.webId!, getCode: op.getCode },
      });
      await auth.login({ issuer: op.issuer });
      expect(op.stats.registrations).toBe(1);
    }
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createPodAuth({
        ...f.options,
        allowInsecureLoopback: true,
        redirectUri: "http://localhost/callback",
      }),
    ).toThrow("local development");
    expect(() =>
      createPodAuth({
        ...f.options,
        clientId: { dynamicRegistration: true },
        redirectUri: "https://localhost/callback",
      }),
    ).toThrow("loopback development");
  });
  test("callback origin must match a browser application origin", () => {
    const f = fixture();
    vi.stubGlobal("location", { origin: "https://foreign.example" });
    expect(() => createPodAuth(f.options)).toThrow("application origin");
    vi.stubGlobal("location", { origin: "https://app.example" });
    expect(() => createPodAuth(f.options)).not.toThrow();
  });
});

test("automatic boundary: one interactive authorization covers login and the first private reads, before and after restore", async () => {
  const op = createMockOp({ requireInteraction: true, refreshTokens: true });
  vi.stubGlobal("fetch", op.fetch);
  const getCode = vi.fn(op.getCode);
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode },
  };
  for (const hint of [{ webId: op.webId! }, { issuer: op.issuer }]) {
    const auth = createPodAuth(options);
    await auth.logout();
    getCode.mockClear();
    const before = op.stats.authorizations;
    expect((await auth.login(hint)).storages).toEqual([op.root]);
    expect(getCode).toHaveBeenCalledTimes(1);
    // The grant made before storage discovery must cover the discovered storage root.
    expect(await (await auth.fetch(op.root + "private?x=1")).text()).toBe("protected Solid");
    expect(await (await auth.fetch(op.root + "private?x=2")).text()).toBe("protected Solid");
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(op.stats.authorizations - before).toBe(1);

    const reloaded = createPodAuth(options);
    expect((await reloaded.restore())?.webId).toBe(op.webId);
    expect(await (await reloaded.fetch(op.root + "private?x=3")).text()).toBe("protected Solid");
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(op.stats.authorizations - before).toBe(1);
  }
});

test("storage endpoints on a verified storage origin share its grant; other paths and origins get nothing", async () => {
  const op = createMockOp({
    requireInteraction: true,
    protectedUrls: ["https://pod.example/account/domains", "https://pod.example/.notifications/"],
  });
  vi.stubGlobal("fetch", op.fetch);
  const getCode = vi.fn(op.getCode);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { storageEndpoints: ["/account/domains", "/.notifications/"] },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode },
  });
  await auth.login({ webId: op.webId! });
  expect(await (await auth.fetch("https://pod.example/account/domains")).text()).toBe(
    "protected Solid",
  );
  expect(await (await auth.fetch("https://pod.example/.notifications/ws/")).text()).toBe(
    "protected Solid",
  );
  expect(await (await auth.fetch(op.root + "private")).text()).toBe("protected Solid");
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(op.stats.tokens).toBe(1);
  const accepted = op.stats.accepted;
  // Exact paths stay exact, and nothing is granted on another origin or before discovery.
  expect((await auth.fetch("https://pod.example/account/domains-evil")).status).toBe(401);
  expect((await auth.fetch("https://pod.example/account/domains/x")).status).toBe(401);
  expect((await auth.fetch("https://other.example/account/domains")).status).toBe(401);
  expect(op.stats.accepted).toBe(accepted);
  expect(
    op.requests.filter(
      (r) => r.headers.has("authorization") && !r.url.startsWith("https://pod.example/"),
    ),
  ).toEqual([]);
  await auth.logout();
  expect((await auth.fetch("https://pod.example/account/domains")).status).toBe(401);
});

test.each([
  "account/domains",
  "//evil.example/x",
  "/a/../b",
  "/a?x",
  "/a#x",
  "/a\\b",
  "/a b",
  "@evil.example/",
  "/a@b",
])("storageEndpoints rejects %s", (path) => {
  expect(() =>
    createPodAuth({
      clientId: "https://app.example/clientid.jsonld",
      redirectUri: "https://app.example/callback",
      boundary: { storageEndpoints: [path] },
      ui: { getWebId: async () => "", getCode: async () => "" },
    }),
  ).toThrow("storageEndpoints");
});

test("a storage endpoint maps to the first storage on its origin, and eligible() still filters it", async () => {
  const second = "https://pod.example/alice-work/";
  const op = createMockOp({
    storages: ["https://pod.example/alice/", second],
    protectedUrls: ["https://pod.example/account/domains", "https://pod.example/blocked"],
  });
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: {
      storageEndpoints: ["/account/domains", "/blocked"],
      eligible: (url) => url.pathname !== "/blocked",
    },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  });
  expect((await auth.login({ webId: op.webId! })).storages).toEqual([op.root, second]);
  expect((await auth.fetch("https://pod.example/account/domains")).status).toBe(200);
  expect((await auth.fetch("https://pod.example/blocked")).status).toBe(401);
  expect(op.stats.tokens).toBe(1);
});

test("a verified storage that matches an endpoint path stays a storage, and option mutation adds nothing", async () => {
  const api = "https://pod.example/api/";
  const op = createMockOp({
    storages: ["https://pod.example/alice/", api],
    protectedUrls: ["https://pod.example/later"],
  });
  vi.stubGlobal("fetch", op.fetch);
  const storageEndpoints = ["/api/", "/fixed/"];
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: ["https://pod.example/fixed/"], storageEndpoints },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  });
  storageEndpoints.push("/later");
  expect((await auth.login({ webId: op.webId! })).storages).toEqual([
    "https://pod.example/fixed/",
    op.root,
    api,
  ]);
  expect((await auth.fetch("https://pod.example/later")).status).toBe(401);
});

test("maxReplayBodyBytes bounds the buffered request body and is validated", async () => {
  const { op, options } = fixture();
  const auth = createPodAuth({ ...options, maxReplayBodyBytes: 2 });
  await auth.login({ webId: op.webId });
  await expect(auth.fetch(op.root + "upload", { method: "PUT", body: "abc" })).rejects.toThrow(
    "exceeds 2 bytes",
  );
  expect((await auth.fetch(op.root + "upload", { method: "PUT", body: "ab" })).status).toBe(200);
  for (const value of [-1, 1.5, Number.NaN, "1" as unknown as number])
    expect(() => createPodAuth({ ...options, maxReplayBodyBytes: value })).toThrow(
      "maxReplayBodyBytes",
    );
});

test("storageEndpoints must be an array", () => {
  expect(() =>
    createPodAuth({
      clientId: "https://app.example/clientid.jsonld",
      redirectUri: "https://app.example/callback",
      boundary: { storageEndpoints: "/account" as unknown as string[] },
      ui: { getWebId: async () => "", getCode: async () => "" },
    }),
  ).toThrow("storageEndpoints");
});

test("storage endpoints are read once: a getter cannot swap in another origin after validation", () => {
  let reads = 0;
  const boundary = {
    get storageEndpoints() {
      reads++;
      return reads === 1 ? ["/account/domains"] : ["@evil.example/"];
    },
  };
  expect(() =>
    createPodAuth({
      clientId: "https://app.example/clientid.jsonld",
      redirectUri: "https://app.example/callback",
      boundary,
      ui: { getWebId: async () => "", getCode: async () => "" },
    }),
  ).toThrow("storageEndpoints");
});

test("an endpoint inside another verified storage uses that storage's grant", async () => {
  const op = createMockOp({
    storages: ["https://pod.example/alice/", "https://pod.example/", "https://pod.example/svc/"],
    protectedUrls: ["https://pod.example/.notifications/", "https://pod.example/svc/hook"],
  });
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { storageEndpoints: ["/.notifications/", "/svc/hook"] },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  });
  expect((await auth.login({ webId: op.webId! })).storages).toEqual([
    op.root,
    "https://pod.example/",
    "https://pod.example/svc/",
  ]);
  expect(op.stats.tokens).toBe(1);
  expect((await auth.fetch("https://pod.example/.notifications/ws")).status).toBe(200);
  // The root storage's context, not alice's login grant.
  expect(op.stats.tokens).toBe(2);
  // The innermost containing storage wins.
  expect((await auth.fetch("https://pod.example/svc/hook")).status).toBe(200);
  expect(op.stats.tokens).toBe(3);
});

test("an endpoint inside a fixed root uses that root's grant", async () => {
  const op = createMockOp({ protectedUrls: ["https://pod.example/.notifications/"] });
  vi.stubGlobal("fetch", op.fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: ["https://pod.example/"], storageEndpoints: ["/.notifications/"] },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
  });
  await auth.login({ webId: op.webId! });
  expect(op.stats.tokens).toBe(1);
  expect((await auth.fetch("https://pod.example/.notifications/ws")).status).toBe(200);
  expect(op.stats.tokens).toBe(1);
});

test("core CID mode honours maxReplayBodyBytes", async () => {
  const op = createMockOp();
  vi.stubGlobal("fetch", op.fetch);
  const key = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root] },
    maxReplayBodyBytes: 2,
    ui: { getWebId: async () => op.webId!, getCode: op.getCode },
    lws: {
      subject: {
        cid: {
          documentUrl: "https://agent.example/id",
          keyId: "https://agent.example/id#key",
          privateKey: key.privateKey,
        },
      },
    },
  });
  await expect(auth.fetch(op.root + "upload", { method: "PUT", body: "abc" })).rejects.toThrow(
    "exceeds 2 bytes",
  );
});
