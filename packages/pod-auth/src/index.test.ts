// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, test, vi } from "vitest";
import { AmbiguousIssuerError, createPodAuth, type PodAuthOptions } from "./index.js";
import * as node from "./node.js";
import * as react from "./react.js";
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
    webId: op.webId,
    issuer: op.issuer,
    subject: op.subject,
    clientId: op.clientId,
    protocol: "solid-oidc",
    storages: [op.root],
  });
  expect(events).toEqual([{ type: "login", identity, timestamp: 42 }]);
  expect(options.ui.getWebId).not.toHaveBeenCalled();
  expect(op.stats.authorizations).toBe(2);
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
  expect(Object.keys(node)).toEqual([]);
  expect(Object.keys(react)).toEqual([]);
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
  await expect(untrusted.auth.login({ issuer: untrusted.op.issuer })).rejects.toThrow("issuer");
  expect(await untrusted.auth.identity()).toBeNull();
});

test("automatic boundary verifies a storage before prompting and eligible restricts even static roots", async () => {
  const f = fixture({}, { boundary: {} });
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
});

test("LWS can be the first authentication request", async () => {
  const { auth, op } = fixture();
  expect((await auth.fetch(op.root + "lws")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("lws");
});

test("identity may have no WebID and reports no token material", async () => {
  const { auth, op } = fixture({ webId: null });
  const identity = await auth.login({ issuer: op.issuer });
  expect(identity.webId).toBeNull();
  expect(Object.keys(identity).sort()).toEqual([
    "clientId",
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
  await expect(broken.auth.login()).rejects.toThrow("unavailable");
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
