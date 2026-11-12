// AUTHORED-BY Codex GPT-6
import { challengeContext, SessionFence } from "@jeswr/reactive-authentication";
import { afterEach, expect, test, vi } from "vitest";
import { createBoundary } from "./boundary.js";
import { createPodAuth } from "./index.js";
import { createLwsProvider } from "./lws-provider.js";
import { createMockLwsAs, createMockOp } from "./testing.js";

const attacker = "https://attacker.example/";
const storageType = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';
const solidDescription = "http://www.w3.org/ns/solid/terms#storageDescription";
const lwsLink = '<https://pod.example/storage>; rel="https://www.w3.org/ns/lws#storage"';
afterEach(() => vi.unstubAllGlobals());

function fixture(config: Parameters<typeof createMockOp>[0] = {}) {
  const op = createMockOp(config);
  const requests: Request[] = [];
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  const make = () => createPodAuth({ clientId: op.clientId, redirectUri: op.redirectUri, ui });
  return { op, requests, ui, make };
}

test.each([
  "DPoP",
  `UMA as_uri="${attacker}", ticket="stolen"`,
  `Bearer as_uri="${attacker}", realm="${attacker}"`,
  `Bearer resource_metadata="${attacker}metadata"`,
])("a hostile self-declared storage cannot obtain credentials or exchange tokens: %s", async (challenge) => {
  const f = fixture();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    return request.url.startsWith(attacker)
      ? Promise.resolve(
          new Response(null, {
            status: 401,
            headers: {
              link: storageType,
              "www-authenticate": challenge,
            },
          }),
        )
      : f.op.fetch(request);
  });
  const auth = f.make();
  expect((await auth.fetch(attacker)).status).toBe(401);
  expect(f.ui.getWebId).not.toHaveBeenCalled();
  expect(f.ui.getCode).not.toHaveBeenCalled();
  await auth.login();
  const tokens = f.op.stats.tokens;
  expect((await auth.fetch(attacker)).status).toBe(401);
  expect((await auth.fetch(attacker + "nested/private")).status).toBe(401);
  const hostile = f.requests.filter((r) => r.url.startsWith(attacker));
  expect(hostile).toHaveLength(3);
  expect(
    hostile.every(
      (r) => !r.headers.has("authorization") && !r.headers.has("dpop") && r.method === "GET",
    ),
  ).toBe(true);
  expect(f.op.stats.tokens).toBe(tokens);
  expect(f.op.stats.exchanges).toBe(0);
  expect((await auth.identity())?.storages).toEqual([f.op.root]);
});

test("profile storages work without target hints; target descriptions and ancestors cannot widen them", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    if (request.url === "https://pod.example/")
      return Promise.resolve(
        new Response(null, {
          status: 401,
          headers: { link: storageType, "www-authenticate": "DPoP" },
        }),
      );
    return f.op.fetch(request);
  });
  const auth = f.make();
  expect((await auth.fetch(f.op.root + "private")).status).toBe(401);
  await auth.login({ webId: f.op.webId });
  expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
  expect((await auth.fetch("https://pod.example/")).status).toBe(401);
  expect((await auth.fetch("https://pod.example/sibling/private")).status).toBe(401);
  expect(f.requests.filter((r) => r.url === "https://pod.example/")).toHaveLength(1);
  await auth.logout();
  expect((await auth.fetch(f.op.root + "private")).status).toBe(401);
});

test.each([
  "native",
  "credentialed",
])("%s redirects to a self-declared foreign storage never get tokens", async (kind) => {
  const f = fixture();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    if (request.url.startsWith(attacker))
      return Promise.resolve(
        new Response(null, {
          status: 401,
          headers: { link: storageType, "www-authenticate": "DPoP" },
        }),
      );
    if (request.url === f.op.root + "redirect") {
      if (kind === "native") {
        const response = new Response(null, {
          status: 401,
          headers: { link: storageType, "www-authenticate": "DPoP" },
        });
        Object.defineProperties(response, {
          redirected: { value: true },
          url: { value: attacker },
        });
        return Promise.resolve(response);
      }
      if (request.headers.has("authorization")) {
        expect(request.redirect).toBe("manual");
        return Promise.resolve(
          new Response(null, { status: 302, headers: { location: attacker } }),
        );
      }
    }
    return f.op.fetch(request);
  });
  const auth = f.make();
  await auth.login();
  expect((await auth.fetch(f.op.root + "redirect")).status).toBe(401);
  expect(
    f.requests
      .filter((r) => r.url.startsWith(attacker))
      .every((r) => !r.headers.has("authorization") && !r.headers.has("dpop")),
  ).toBe(true);
  expect(f.op.stats.exchanges).toBe(0);
});

test.each([
  "uma",
  "legacy",
  "metadata",
  "audience",
  "endpoint",
])("trusted storage cannot widen credential destinations via %s hints", async (kind) => {
  const f = fixture();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    if (request.url === f.op.root + "lws" && kind !== "endpoint")
      return new Response(null, {
        status: 401,
        headers: {
          link: lwsLink,
          "www-authenticate":
            kind === "uma"
              ? `UMA as_uri="${attacker}", ticket="stolen"`
              : kind === "metadata"
                ? 'Bearer resource_metadata="https://pod.example/metadata"'
                : `Bearer as_uri="${kind === "legacy" ? attacker : "https://pod.example/"}", realm="https://pod.example/"`,
        },
      });
    if (request.url === "https://pod.example/metadata")
      return Response.json({ resource: f.op.root + "lws", authorization_servers: [attacker] });
    if (request.url === "https://pod.example/.well-known/lws-configuration" && kind === "endpoint")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: attacker + "exchange",
      });
    return f.op.fetch(request);
  });
  const auth = f.make();
  await auth.login();
  await expect(auth.fetch(f.op.root + "lws")).rejects.toThrow(/trusted|not trusted/);
  expect(f.requests.filter((r) => r.url.startsWith(attacker))).toHaveLength(0);
  expect(f.op.stats.exchanges).toBe(0);
});

test("profile-linked LWS description authorizes its StorageRoot and token audience", async () => {
  const f = fixture({ storages: ["https://lws.example/storage"] });
  const as = createMockLwsAs({
    challenge: "resource_metadata",
    subject: {
      issuer: f.op.issuer,
      subject: f.op.subject,
      clientId: f.op.clientId,
      publicKey: f.op.publicKey,
      tokenType: "id_token",
    },
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith(as.issuer) ? as.fetch(request) : f.op.fetch(request);
  });
  const auth = f.make();
  expect((await auth.fetch(as.root + "private")).status).toBe(401);
  await auth.login();
  expect((await auth.identity())?.storages).toEqual([as.storage, as.root]);
  expect((await auth.fetch(as.root + "private")).status).toBe(200);
  expect(as.stats.exchanges).toBe(1);
});

function policy(fetch: typeof globalThis.fetch, roots: string[] = []) {
  return createBoundary({ boundary: { roots } }, { fetch });
}
const signal = () => new AbortController().signal;
const profile = (storage: string, subject = "https://id.example/alice#me") =>
  new Response(`<${subject}> <http://www.w3.org/ns/pim/space#storage> <${storage}> .`, {
    headers: { "content-type": "text/turtle" },
  });
const binding = (
  realm: string,
  resource = "https://pod.example/alice/private",
  as = "https://pod.example/",
) => ({
  realm: new URL(realm),
  resource: new URL(resource),
  authorizationServer: new URL(as),
});

test.each([
  "https://pod.example/alice/",
  "https://pod.example/alice",
  "https://evil.example/",
  "http://remote.example/",
  "https://pod.example/a%2fb/",
  "https://user:secret@pod.example/",
])("profile assertion is bounded and scheme checked: %s", async (storage) => {
  const boundary = policy(async (input) =>
    String(input).startsWith("https://id.example")
      ? profile(storage)
      : new Response(null, { status: 404 }),
  );
  await boundary.learn("https://id.example/alice#me", signal());
  expect(boundary.allows(storage)).toBe(
    storage.startsWith("https://") && !storage.includes("%") && !storage.includes("@"),
  );
  expect(boundary.allows("https://pod.example/alice-evil/private")).toBe(false);
});

test.each([
  null,
  { id: "https://pod.example/description", type: "Wrong" },
  { id: "https://pod.example/description", type: "Storage" },
  {
    id: "https://pod.example/description",
    type: ["Storage"],
    service: [
      null,
      { type: "Wrong" },
      { type: "StorageRoot" },
      { type: ["StorageRoot"], serviceEndpoint: "https://pod.example/alice/" },
    ],
  },
])("LWS identity descriptions validate id, type, service and endpoint: %#", async (document) => {
  const boundary = policy(async (input, init) => {
    if (new Request(input, init).method === "HEAD")
      return new Response(null, {
        headers: {
          link: `${storageType}, <https://pod.example/description>; rel="${solidDescription}"`,
        },
      });
    return String(input).startsWith("https://id.example")
      ? profile("https://pod.example/description")
      : Response.json(document);
  });
  await boundary.learn("https://id.example/alice#me", signal());
  expect(boundary.allows("https://pod.example/alice/private")).toBe(Array.isArray(document?.type));
});

test.each([
  "redirect",
  "failure",
  "url",
  "malformed",
  "turtle",
  "no-content-type",
])("identity descriptions fail closed or parse Solid roots: %s", async (kind) => {
  const boundary = policy(async (input, init) => {
    if (new Request(input, init).method === "HEAD")
      return new Response(null, {
        headers: {
          link: `${storageType}, <https://pod.example/description>; rel="${solidDescription}"`,
        },
      });
    if (String(input).startsWith("https://id.example"))
      return profile("https://pod.example/description");
    if (kind === "failure") throw new Error("offline");
    if (kind === "redirect") return new Response(null, { status: 302 });
    if (kind === "url") {
      const response = Response.json({});
      Object.defineProperty(response, "url", { value: attacker });
      return response;
    }
    if (kind === "malformed") return new Response("invalid turtle");
    return new Response(
      "<https://pod.example/alice/> a <http://www.w3.org/ns/pim/space#Storage> . [] a <http://www.w3.org/ns/pim/space#Storage> .",
      kind === "turtle" ? { headers: { "content-type": "text/turtle" } } : {},
    );
  });
  await boundary.learn("https://id.example/alice#me", signal());
  expect(boundary.allows("https://pod.example/alice/private")).toBe(
    ["turtle", "no-content-type"].includes(kind),
  );
});

test("profile redirects preserve the original WebID subject; a redirect URL is never a grant", async () => {
  const boundary = policy(async (input) =>
    String(input).startsWith("https://id.example")
      ? new Response(null, { status: 302, headers: { location: attacker + "profile" } })
      : profile("https://pod.example/alice/"),
  );
  await boundary.learn("https://id.example/alice#me", signal());
  expect(boundary.allows("https://pod.example/alice/private")).toBe(true);
  expect(boundary.allows(attacker)).toBe(false);
  const other = policy(async () => profile(attacker, attacker + "profile"));
  await other.learn("https://id.example/alice#me", signal());
  expect(other.roots()).toEqual([]);
});

test("profile failures, cancellation and logout cannot leave new authority", async () => {
  const failure = policy(async () => new Response(null, { status: 503 }));
  await expect(failure.learn("https://id.example/alice#me", signal())).rejects.toThrow(
    "WebID storage",
  );
  for (const abort of [false, true]) {
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const boundary = policy(async () => {
      ready.resolve();
      return release.promise;
    });
    const controller = new AbortController();
    const pending = boundary.learn("https://id.example/alice#me", controller.signal);
    await ready.promise;
    if (abort) controller.abort();
    else boundary.clear();
    release.resolve(profile("https://pod.example/alice/"));
    await expect(pending).rejects.toThrow();
    expect(boundary.roots()).toEqual([]);
  }
});

test("LWS audiences must fit a grant or a description rooted within it", async () => {
  const boundary = policy(
    async () =>
      Response.json({
        id: "https://pod.example/storage",
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: "https://pod.example/alice/" }],
      }),
    ["https://pod.example/alice/"],
  );
  expect(await boundary.trustLws(binding("https://pod.example/alice/"), signal())).toBe(true);
  expect(await boundary.trustLws(binding("https://pod.example/storage"), signal())).toBe(true);
  expect(await boundary.trustLws(binding(attacker), signal())).toBe(false);
  expect(await boundary.trustLws(binding("https://pod.example/"), signal())).toBe(false);
  expect(await boundary.trustLws(binding("https://pod.example/alice/", attacker), signal())).toBe(
    false,
  );
});

test("UMA metadata cannot move the claim-token exchange to a foreign endpoint", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    if (request.url === f.op.root + "uma")
      return new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": 'UMA as_uri="https://pod.example/", ticket="stolen"',
        },
      });
    if (request.url === "https://pod.example/.well-known/uma2-configuration")
      return Response.json({
        issuer: "https://pod.example/",
        token_endpoint: attacker + "exchange",
        uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
      });
    return f.op.fetch(request);
  });
  const auth = f.make();
  await auth.login();
  await expect(auth.fetch(f.op.root + "uma")).rejects.toThrow("endpoint is not trusted");
  expect(f.requests.filter((r) => r.url.startsWith(attacker))).toHaveLength(0);
});

test.each([
  "metadata",
  "legacy",
])("CID agents apply the same foreign-AS refusal for %s challenges", async (kind) => {
  const f = fixture();
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", key.publicKey);
  const documentUrl = "https://agent.example/id";
  const keyId = documentUrl + "#key";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    f.requests.push(request.clone());
    if (request.url === documentUrl)
      return Response.json({
        id: documentUrl,
        authentication: [{ id: keyId, type: "JsonWebKey", controller: documentUrl, publicKeyJwk }],
      });
    if (request.url === f.op.root + "private")
      return new Response(null, {
        status: 401,
        headers: {
          link: lwsLink,
          "www-authenticate":
            kind === "metadata"
              ? 'Bearer resource_metadata="https://pod.example/metadata"'
              : `Bearer as_uri="${attacker}", realm="https://pod.example/storage"`,
        },
      });
    if (request.url === "https://pod.example/metadata")
      return Response.json({ resource: f.op.root + "private", authorization_servers: [attacker] });
    return f.op.fetch(request);
  });
  const auth = createPodAuth({
    clientId: f.op.clientId,
    redirectUri: f.op.redirectUri,
    boundary: { roots: [f.op.root] },
    ui: f.ui,
    lws: { subject: { cid: { documentUrl, keyId, privateKey: key.privateKey } } },
  });
  await auth.login();
  await expect(auth.fetch(f.op.root + "private")).rejects.toThrow(/trusted/);
  expect(f.requests.filter((r) => r.url.startsWith(attacker))).toHaveLength(0);
  expect(
    f.requests.every(
      (r) =>
        !r.headers.has("authorization") &&
        !r.headers.has("dpop") &&
        (r.method === "GET" || r.method === "HEAD"),
    ),
  ).toBe(true);
});

test("session supersession removes automatic roots while preserving explicit grants", async () => {
  const boundary = policy(
    async () => profile("https://pod.example/alice/"),
    ["https://configured.example/"],
  );
  const lifetime = new AbortController();
  await boundary.learn("https://id.example/alice#me", signal(), lifetime.signal);
  lifetime.abort();
  expect(boundary.allows("https://pod.example/alice/private")).toBe(false);
  expect(boundary.allows("https://configured.example/private")).toBe(true);
});

test("exact resource grants cannot silently authorize a container audience", async () => {
  const boundary = policy(
    async () => new Response(null, { status: 404 }),
    ["https://pod.example/alice", "https://pod.example/alice/private"],
  );
  expect(await boundary.trustLws(binding("https://pod.example/alice"), signal())).toBe(false);
  expect(await boundary.trustLws(binding("https://pod.example/alice/private"), signal())).toBe(
    true,
  );
});

test.each([
  ["oidc", "legacy", "caller", "abort"],
  ["oidc", "legacy", "logout", "abort"],
  ["oidc", "resource_metadata", "caller", "abort"],
  ["oidc", "resource_metadata", "logout", "abort"],
  ["cid", "legacy", "caller", "abort"],
  ["cid", "legacy", "logout", "abort"],
  ["cid", "resource_metadata", "caller", "abort"],
  ["cid", "resource_metadata", "logout", "abort"],
  ["oidc", "legacy", "logout", "late"],
  ["oidc", "resource_metadata", "logout", "late"],
  ["cid", "legacy", "logout", "late"],
  ["cid", "resource_metadata", "logout", "late"],
] as const)("%s %s trust discovery honors %s cancellation with an %s transport", async (mode, challenge, cancellation, delivery) => {
  const f = fixture();
  const documentUrl = "https://agent.example/id";
  const keyId = documentUrl + "#key";
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const as = createMockLwsAs({
    challenge,
    subject:
      mode === "oidc"
        ? {
            issuer: f.op.issuer,
            subject: f.op.subject,
            clientId: f.op.clientId,
            publicKey: f.op.publicKey,
            tokenType: "id_token",
          }
        : {
            issuer: documentUrl,
            subject: documentUrl,
            clientId: documentUrl,
            publicKey: publicKeyJwk,
            tokenType: "jwt",
          },
  });
  const ready = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<Response>();
  const requests: Request[] = [];
  let descriptions = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    // RFC 9728 first resolves storage in the engine; stall the subsequent policy fetch.
    if (request.url === as.storage && ++descriptions === (challenge === "legacy" ? 1 : 2)) {
      ready.resolve(request);
      if (delivery === "abort")
        request.signal.addEventListener("abort", () => release.reject(request.signal.reason), {
          once: true,
        });
      return release.promise;
    }
    if (request.url === documentUrl)
      return Promise.resolve(
        Response.json({
          id: documentUrl,
          authentication: [
            { id: keyId, type: "JsonWebKey", controller: documentUrl, publicKeyJwk },
          ],
        }),
      );
    return request.url.startsWith(as.issuer) ? as.fetch(request) : f.op.fetch(request);
  });
  const auth = createPodAuth({
    clientId: f.op.clientId,
    redirectUri: f.op.redirectUri,
    boundary: { roots: [as.root], automatic: false },
    ui: f.ui,
    ...(mode === "cid"
      ? { lws: { subject: { cid: { documentUrl, keyId, privateKey: keys.privateKey } } } }
      : {}),
  });
  await auth.login();
  const caller = new AbortController();
  const pending = auth.fetch(as.root + "private", { signal: caller.signal });
  // Observe rejection immediately so logout cannot cause an unhandled rejection.
  const settled = pending.then(
    (response) => ({ response, error: undefined }),
    (error: Error) => ({ response: undefined, error }),
  );
  const discovery = await ready.promise;
  const description = await as.fetch(as.storage);
  try {
    expect(discovery.signal.aborted).toBe(false);
    expect(discovery.credentials).toBe("omit");
    expect(discovery.redirect).toBe("error");
    expect(discovery.headers.has("authorization")).toBe(false);
    expect(discovery.headers.has("dpop")).toBe(false);
    if (cancellation === "caller") caller.abort();
    else await auth.logout();
    expect(discovery.signal.aborted).toBe(true);
    if (delivery === "late") release.resolve(description);
    const result = await settled;
    expect(result.response).toBeUndefined();
    expect(result.error).toBe(discovery.signal.reason);
    expect(as.stats.exchanges).toBe(0);
    expect(requests.filter((request) => request.url === as.tokenEndpoint)).toHaveLength(0);
    expect(
      requests
        .filter((request) => request.url.startsWith(as.issuer))
        .every((request) => !request.headers.has("authorization") && !request.headers.has("dpop")),
    ).toBe(true);
    if (cancellation === "logout") expect(await auth.identity()).toBeNull();
    else {
      // Cancelling one fetch preserves the session and its ability to authenticate another fetch.
      expect(await auth.identity()).not.toBeNull();
      expect((await auth.fetch(as.root + "other")).status).toBe(200);
      expect(as.stats.exchanges).toBe(1);
    }
  } finally {
    release.resolve(description);
    await settled;
  }
});

test("session supersession cancels LWS policy discovery even without a manager-bound request", async () => {
  const ready = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<Response>();
  const boundary = policy(
    async (input, init) => {
      const request = new Request(input, init);
      ready.resolve(request);
      request.signal.addEventListener("abort", () => release.reject(request.signal.reason), {
        once: true,
      });
      return release.promise;
    },
    ["https://pod.example/alice/"],
  );
  const fence = new SessionFence(crypto.randomUUID(), { broadcast: false });
  const source = { id: "subject", fence, getCredential: vi.fn() };
  const provider = createLwsProvider(source, boundary, fence);
  const request = new Request("https://pod.example/alice/private");
  const pending = provider.upgrade(
    request,
    challengeContext(
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer as_uri="https://pod.example/", realm="https://pod.example/storage"',
        },
      }),
    ),
  );
  const rejected = expect(pending).rejects.toThrow("superseded");
  const discovery = await ready.promise;
  await fence.supersede();
  expect(request.signal.aborted).toBe(false);
  expect(discovery.signal.aborted).toBe(true);
  await rejected;
  expect(source.getCredential).not.toHaveBeenCalled();
});

test("concurrent LWS requests for the same resource keep caller cancellation independent", async () => {
  const f = fixture();
  const ready = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<Response>();
  let descriptions = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "https://pod.example/storage" && ++descriptions === 2) {
      ready.resolve(request);
      request.signal.addEventListener("abort", () => release.reject(request.signal.reason), {
        once: true,
      });
      return release.promise;
    }
    return f.op.fetch(request);
  });
  const auth = f.make();
  await auth.login();
  const caller = new AbortController();
  const pending = auth.fetch(f.op.root + "lws", { signal: caller.signal });
  const rejected = expect(pending).rejects.toThrow("aborted");
  const discovery = await ready.promise;
  // The second request must complete while the first request's description is still stalled.
  expect((await auth.fetch(f.op.root + "lws")).status).toBe(200);
  caller.abort();
  expect(discovery.signal.aborted).toBe(true);
  await rejected;
  expect((await auth.fetch(f.op.root + "lws")).status).toBe(200);
  expect(f.op.stats.exchanges).toBe(1);
});
