// AUTHORED-BY Codex GPT-6
import { DPoPTokenProvider } from "@jeswr/reactive-authentication";
import { afterEach, assert, expect, test, vi } from "vitest";
import * as boundaries from "./boundary.js";
import { createPodAuth, type PodAuthOptions } from "./index.js";
import { sessionStorage } from "./sessions.js";
import { createMemoryStore, createMockOp } from "./testing.js";

const redirectUri = "org.jeswr.suite:/oauth/callback";
const clientId = "https://app.example/.well-known/solid-client-id-mobile.jsonld";
const bootstrapUri = "https://app.example/.well-known/pod-auth/native-bootstrap";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function required<T>(value: T | null | undefined): T {
  assert(value !== undefined && value !== null);
  return value;
}

function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp(config);
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    if (request.url === clientId) {
      const document = await (await op.fetch(op.clientId)).json();
      return Response.json({
        ...document,
        client_id: clientId,
        application_type: "native",
        redirect_uris: [redirectUri],
      });
    }
    return op.fetch(request);
  });
  const options: PodAuthOptions = {
    clientId,
    redirectUri,
    nativeRedirect: true,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    ui: { getWebId: vi.fn(async () => required(op.webId)), getCode: vi.fn(op.getCode) },
  };
  return { op, options, requests };
}

test.each([
  redirectUri,
  "org.example.suite-v2+mobile:/oauth/callback",
  "a.b2:/",
])("native opt-in accepts a reverse-domain scheme: %s", (uri) => {
  const { options } = fixture();
  vi.stubEnv("NODE_ENV", "production");
  expect(() => createPodAuth({ ...options, redirectUri: uri })).not.toThrow();
});

test.each([
  "",
  "relative",
  "/oauth/callback",
  "org.jeswr.suite",
  "org.jeswr.suite://[invalid/",
  "suite:/oauth/callback",
  "Org.jeswr.suite:/oauth/callback",
  "org.jeswr.Suite:/oauth/callback",
  "1org.jeswr.suite:/oauth/callback",
  "org.jeswr.suite.:/oauth/callback",
  "org.jeswr.suite-:/oauth/callback",
  "org.jeswr_suite:/oauth/callback",
  "https://app.example/oauth/callback",
  "http://localhost/oauth/callback",
  "http:/oauth/callback",
  "https:/oauth/callback",
  "file:/oauth/callback",
  "data:/oauth/callback",
  "javascript:/oauth/callback",
  "blob:/oauth/callback",
  "about:/oauth/callback",
  "ws:/oauth/callback",
  "wss:/oauth/callback",
  "ftp:/oauth/callback",
  "ftps:/oauth/callback",
  "mailto:/oauth/callback",
  "tel:/oauth/callback",
  "sms:/oauth/callback",
  "urn:/oauth/callback",
  "org.jeswr.suite://localhost/oauth/callback",
  "org.jeswr.suite:///oauth/callback",
  "org.jeswr.suite:////oauth/callback",
  "org.jeswr.suite://user@localhost/oauth/callback",
  "org.jeswr.suite://user:password@localhost/oauth/callback",
  "org.jeswr.suite:oauth/callback",
  "org.jeswr.suite:",
  `${redirectUri}?code=1`,
  `${redirectUri}?`,
  `${redirectUri}#fragment`,
  `${redirectUri}#`,
  " org.jeswr.suite:/oauth/callback",
  `${redirectUri} `,
  "org.jeswr.suite:/oauth/../callback",
  "org.jeswr.suite:/oauth/call\tback",
])("native opt-in rejects an unsafe callback: %j", (uri) => {
  const { options } = fixture();
  expect(() => createPodAuth({ ...options, redirectUri: uri })).toThrow(TypeError);
});

test.each([false, null, "true", 1])("native opt-in must be literal true: %j", (value) => {
  const { options } = fixture();
  expect(() =>
    createPodAuth({ ...options, nativeRedirect: value } as unknown as PodAuthOptions),
  ).toThrow("nativeRedirect must be true");
});

test.each([
  { dynamicRegistration: true },
  { dynamicRegistration: false },
  null,
  undefined,
  1,
  "client-id",
  "http://localhost/client.jsonld",
  "http://app.example/client.jsonld",
  "org.jeswr.suite:/client",
  "https://user:password@app.example/client.jsonld",
  `${clientId}#fragment`,
])("native mode requires an HTTPS Client ID Document URL: %j", (value) => {
  const { options } = fixture();
  expect(() => createPodAuth({ ...options, clientId: value } as unknown as PodAuthOptions)).toThrow(
    TypeError,
  );
});

test.each(["test", "production"])("native mode forbids insecure loopback in %s", (env) => {
  vi.stubEnv("NODE_ENV", env);
  const { options } = fixture();
  expect(() => createPodAuth({ ...options, allowInsecureLoopback: true })).toThrow(
    "allowInsecureLoopback",
  );
  expect(() => createPodAuth({ ...options, allowInsecureLoopback: false })).not.toThrow();
});

test.each([
  "null", // capacitor://localhost is an opaque origin in the URL implementation.
  "capacitor://localhost",
  "https://localhost",
  "https://foreign.example",
])("only native callbacks bypass the application origin check: %s", (origin) => {
  const { options, op } = fixture();
  vi.stubGlobal("location", { origin });
  expect(() => createPodAuth(options)).not.toThrow();
  expect(() => createPodAuth({ ...options, nativeRedirect: undefined })).toThrow("HTTPS");
  expect(() =>
    createPodAuth({ ...options, nativeRedirect: undefined, redirectUri: op.redirectUri }),
  ).toThrow("application origin");
  expect(() => createPodAuth({ ...options, redirectUri: op.redirectUri })).toThrow(
    "private-use scheme",
  );
});

test("without the opt-in scheme callbacks remain forbidden even without location", () => {
  const { options } = fixture();
  expect(() => createPodAuth({ ...options, nativeRedirect: undefined })).toThrow("HTTPS");
  expect(() => createPodAuth({ ...options, boundary: { roots: [redirectUri] } })).toThrow(
    "boundary root requires HTTPS",
  );
});

test.each([
  ["automatic", "webid"],
  ["automatic", "issuer"],
  ["static", "webid"],
  ["static", "issuer"],
] as const)("native %s login by %s keeps OAuth redirects exact and resource contexts HTTPS through restore", async (mode, hint) => {
  const { op, options, requests } = fixture({ requireInteraction: true, refreshTokens: true });
  vi.stubGlobal("location", { origin: "https://localhost" });
  // Fail before constructing any non-HTTPS Request, even on runtimes that accept private schemes.
  const OriginalRequest = globalThis.Request;
  const constructed: string[] = [];
  vi.stubGlobal(
    "Request",
    class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        expect(new URL(url).protocol).toBe("https:");
        constructed.push(url);
        super(input, init);
      }
    },
  );
  if (mode === "static") options.boundary = { roots: [op.root], automatic: false };
  const boundaryFactory = vi.spyOn(boundaries, "createBoundary");
  const upgrade = vi.spyOn(DPoPTokenProvider.prototype, "upgrade");
  const auth = createPodAuth(options);
  const boundary = required(boundaryFactory.mock.results[0]).value as ReturnType<
    typeof boundaries.createBoundary
  >;
  const contexts = vi.spyOn(boundary, "contextKey");
  const getCode = vi.mocked(options.ui.getCode);
  const identity = await auth.login(
    hint === "webid" ? { webId: required(op.webId) } : { issuer: op.issuer },
  );
  expect(identity).toMatchObject({ webId: op.webId, clientId, storages: [op.root] });
  expect(boundary.roots()).toEqual([op.root]);
  expect(boundary.allows(bootstrapUri)).toBe(false);
  expect(required(upgrade.mock.calls[0])[0].url).toBe(mode === "static" ? op.root : bootstrapUri);
  expect(required(contexts.mock.calls[0])[0].url).toBe(mode === "static" ? op.root : bootstrapUri);
  expect(contexts.mock.calls.every(([request]) => new URL(request.url).protocol === "https:")).toBe(
    true,
  );
  expect(requests.some((request) => request.url === bootstrapUri)).toBe(false);

  const authorization = required(getCode.mock.calls[0])[0];
  expect(authorization.searchParams.get("redirect_uri")).toBe(redirectUri);
  expect(authorization.searchParams.get("client_id")).toBe(clientId);
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const callback = new URL(await required(getCode.mock.results[0]).value);
  expect(callback.href.split("?")[0]).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe(authorization.searchParams.get("state"));
  expect(callback.searchParams.get("iss")).toBe(op.issuer);
  expect(callback.searchParams.get("code")).toBeTruthy();
  const tokenRequest = required(requests.find((request) => request.url === `${op.issuer}token`));
  const form = new URLSearchParams(await tokenRequest.text());
  expect(form.get("redirect_uri")).toBe(redirectUri);
  expect(form.get("code")).toBe(callback.searchParams.get("code"));

  const namespace = JSON.stringify(["pod-auth", clientId, redirectUri]);
  const active = required(
    await sessionStorage(required(options.storage).sessions, namespace, options).active(),
  );
  expect(active.requestUrl).toBe(mode === "static" ? op.root : bootstrapUri);
  expect(JSON.parse(active.context)[0]).toBe(active.requestUrl);
  expect(await (await auth.fetch(`${op.root}private`)).text()).toBe("protected Solid");
  expect((await auth.fetch(`${op.root}lws`)).status).toBe(200);
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(op.stats.tokens).toBe(1);
  const reloaded = createPodAuth(options);
  expect(await reloaded.restore()).toMatchObject({ webId: op.webId, storages: [op.root] });
  expect((await reloaded.fetch(`${op.root}private`)).status).toBe(200);
  expect(op.stats.refreshes).toBe(1);
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(constructed.every((url) => new URL(url).protocol === "https:")).toBe(true);
  expect(requests.every((request) => new URL(request.url).protocol === "https:")).toBe(true);
  // Neither the synthetic origin nor another public origin inherits credentials.
  for (const url of [bootstrapUri, `${clientId}/private`, "https://foreign.example/private"]) {
    expect((await reloaded.fetch(url)).status).toBe(401);
    const request = required(requests.at(-1));
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.has("dpop")).toBe(false);
  }
  await reloaded.logout();
  expect(await reloaded.remembered()).toEqual([]);
});

test("native bootstrap works without any storage grant and never trusts a scheme profile assertion", async () => {
  const { op, options, requests } = fixture({ storages: [redirectUri] });
  const auth = createPodAuth(options);
  expect((await auth.login({ issuer: op.issuer })).storages).toEqual([]);
  expect((await auth.fetch(`${op.root}private`)).status).toBe(401);
  expect(options.ui.getCode).toHaveBeenCalledTimes(1);
  expect(op.stats.accepted).toBe(0);
  expect(requests.every((request) => new URL(request.url).protocol === "https:")).toBe(true);
});

test.each([
  "solid",
  "lws",
  "uma",
])("native %s can authenticate first through a bounded resource challenge", async (protocol) => {
  const { op, options, requests } = fixture();
  options.boundary = { roots: [op.root], automatic: false };
  const transport = globalThis.fetch;
  const resource = `${op.root}${protocol === "solid" ? "private" : protocol}`;
  const exchanges: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://pod.example/.well-known/uma2-configuration")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: "https://pod.example/uma-token",
        uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
      });
    if (request.url === "https://pod.example/uma-token") {
      exchanges.push(request.clone());
      const form = new URLSearchParams(await request.text());
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:uma-ticket");
      const encodedClaims = required(required(form.get("claim_token")).split(".")[1]);
      const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString());
      expect(claims.azp).toBe(clientId);
      expect(request.headers.has("dpop")).toBe(true);
      return Response.json({ access_token: "native-uma", token_type: "Bearer", expires_in: 300 });
    }
    if (request.url === `${op.root}uma`)
      return request.headers.get("authorization") === "Bearer native-uma"
        ? new Response("protected UMA")
        : new Response(null, {
            status: 401,
            headers: { "www-authenticate": 'UMA as_uri="https://pod.example/", ticket="native"' },
          });
    return transport(request);
  });
  const auth = createPodAuth(options);
  expect((await auth.fetch(resource)).status).toBe(200);
  expect((await auth.identity())?.webId).toBe(op.webId);
  const getCode = vi.mocked(options.ui.getCode);
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(required(getCode.mock.calls[0])[0].searchParams.get("redirect_uri")).toBe(redirectUri);
  const token = required(requests.find((request) => request.url === `${op.issuer}token`));
  expect(new URLSearchParams(await token.text()).get("redirect_uri")).toBe(redirectUri);
  expect(exchanges).toHaveLength(protocol === "uma" ? 1 : 0);
  expect(op.stats.tokens).toBe(1);
});

test.each([
  "com.attacker.app:/oauth/callback",
  "org.jeswr.suite://attacker.example/oauth/callback",
  "org.jeswr.suite:///oauth/callback",
  "org.jeswr.suite:/wrong-path",
  "https://app.example/oauth/callback",
])("native mode rejects a code returned to a different callback base: %s", async (base) => {
  const { op, options, requests } = fixture();
  options.ui.getCode = async (url, signal) => {
    const callback = new URL(await op.getCode(url, signal));
    return base + callback.search;
  };
  const auth = createPodAuth(options);
  await expect(auth.login()).rejects.toThrow("native redirect URI");
  expect(await auth.identity()).toBeNull();
  expect(requests.some((request) => request.url === `${op.issuer}token`)).toBe(false);
});

test("native callback validation stays pinned to the protocol redirect after option mutation", async () => {
  const { op, options, requests } = fixture();
  const replaced = "com.attacker.app:/oauth/callback";
  options.ui.getCode = async (url, signal) => {
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    const callback = new URL(await op.getCode(url, signal));
    return replaced + callback.search;
  };
  const auth = createPodAuth(options);
  options.redirectUri = replaced;
  await expect(auth.login()).rejects.toThrow("native redirect URI");
  expect(await auth.identity()).toBeNull();
  expect(requests.some((request) => request.url === `${op.issuer}token`)).toBe(false);
});

test.each([
  "state",
  "iss",
  "code",
  "fragment",
  "missing-state",
  "missing-iss",
  "missing-code",
  "duplicate-state",
  "duplicate-iss",
  "duplicate-code",
])("native callbacks retain engine validation of %s", async (field) => {
  const { op, options } = fixture();
  options.ui.getCode = async (url, signal) => {
    const callback = new URL(await op.getCode(url, signal));
    if (field === "fragment") callback.hash = "forbidden";
    else if (field.startsWith("missing-")) callback.searchParams.delete(field.slice(8));
    else if (field.startsWith("duplicate-")) {
      const parameter = field.slice(10);
      callback.searchParams.append(parameter, required(callback.searchParams.get(parameter)));
    } else callback.searchParams.set(field, "tampered");
    return callback.href;
  };
  const auth = createPodAuth(options);
  await expect(auth.login()).rejects.toThrow();
  expect(await auth.identity()).toBeNull();
  expect(op.stats.tokens).toBe(0);
});
