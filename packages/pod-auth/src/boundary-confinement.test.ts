// AUTHORED-BY Codex GPT-6.1-Sol
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, expect, test, vi } from "vitest";
import { createBoundary } from "./boundary.js";
import { createPodAuth } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

const storage = "https://pod.example/alice/storage";
const root = "https://pod.example/alice/";
const attacker = "https://attacker.example/";
const lwsRelation = "https://www.w3.org/ns/lws#storage";
const storageType = "http://www.w3.org/ns/pim/space#Storage";

afterEach(() => vi.unstubAllGlobals());

function turtleTypes(subjects: string[]) {
  const dataset = new Store();
  for (const subject of subjects) {
    const types = SetFrom.subjectPredicate(
      new TermWrapper(subject, dataset, DataFactory),
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      TermAs.term,
      TermFrom.itself,
    );
    types.add(DataFactory.namedNode(storageType));
  }
  return new Response(new Writer().quadsToString([...dataset]), {
    headers: { "content-type": "text/turtle" },
  });
}

function descriptionFixture(
  advertised: string,
  format: "lws" | "solid" = "lws",
  confirmation: () => Response | Promise<Response> = () => new Response(null, { status: 404 }),
) {
  const op = createMockOp({ storages: [storage] });
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    if (request.method === "HEAD") return confirmation();
    if (request.url === storage)
      return format === "solid"
        ? turtleTypes([advertised])
        : Response.json({
            id: storage,
            type: "Storage",
            service: [{ type: "StorageRoot", serviceEndpoint: advertised }],
          });
    return op.fetch(request);
  };
  return { op, requests, fetch, boundary: createBoundary({}, { fetch }) };
}

test.each([
  "lws",
  "solid",
] as const)("%s profile-linked descriptions cannot grant a foreign origin, even with a confirming HEAD", async (format) => {
  const f = descriptionFixture(
    attacker,
    format,
    () => new Response(null, { headers: { link: `<${storageType}>; rel="type"` } }),
  );
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.allows(attacker + "anything")).toBe(false);
  expect(
    f.boundary.trustAuthorizationServer({
      authorizationServer: new URL(attacker + "uma"),
      resource: new URL(storage),
    }),
  ).toBe(false);
  expect(
    f.boundary.trustAuthorizationServer({
      authorizationServer: new URL(`${attacker}uma`),
      resource: new URL(`${attacker}anything`),
    }),
  ).toBe(false);
  expect(f.requests.some((request) => request.url.startsWith(attacker))).toBe(false);
});

test.each([
  "https://pod.example/",
  root,
])("an unconfirmed same-origin ancestor %s cannot widen the profile's exact storage grant", async (advertised) => {
  const f = descriptionFixture(advertised);
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.roots()).toEqual([storage]);
  expect(f.boundary.allows(advertised + "private")).toBe(false);
  expect(f.boundary.allows(storage)).toBe(true);
});

test("a description's non-container root cannot add an exact resource grant", async () => {
  const advertised = root + "other";
  const f = descriptionFixture(advertised);
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.allows(advertised)).toBe(false);
  expect(f.requests.some((request) => request.method === "HEAD")).toBe(false);
});

test.each([
  "https://pod.example:8443/alice/",
  "https://pod.example/alice/?view=/",
  "https://pod.example/alice/#/",
  "https://user:secret@pod.example/alice/",
  "https://pod.example/a%2fb/",
  "http://pod.example/alice/",
  "invalid-url",
])("unsafe advertised root %s is dropped without probing it", async (advertised) => {
  const f = descriptionFixture(advertised);
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.roots()).toEqual([storage]);
  expect(f.requests.some((request) => request.method === "HEAD")).toBe(false);
});

test.each([
  "missing-link",
  "wrong-storage",
  "duplicate-storage",
  "foreign-anchor",
  "redirect",
  "redirected",
  "foreign-response",
  "network",
])("root confirmation fails closed on %s", async (kind) => {
  const f = descriptionFixture(root, "lws", () => {
    if (kind === "network") throw new Error("offline");
    const link =
      {
        "missing-link": "",
        "wrong-storage": `<${storage}/other>; rel="${lwsRelation}"`,
        "duplicate-storage": `<${storage}>; rel="${lwsRelation}", <${storage}/other>; rel="${lwsRelation}"`,
        "foreign-anchor": `<${storage}>; rel="${lwsRelation}"; anchor="${attacker}"`,
      }[kind] ?? `<${storageType}>; rel="type"`;
    const response = new Response(null, {
      status: kind === "redirect" ? 302 : 200,
      headers: { link },
    });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    if (kind === "foreign-response") Object.defineProperty(response, "url", { value: attacker });
    return response;
  });
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.roots()).toEqual([storage]);
});

test.each([
  "abort",
  "clear",
  "lifetime",
] as const)("%s during a root HEAD cannot install credential roots", async (change) => {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const lifetime = new AbortController();
  const f = descriptionFixture(root, "lws", () => {
    ready.resolve();
    return release.promise;
  });
  const pending = f.boundary.learn(f.op.webId, controller.signal, lifetime.signal);
  await ready.promise;
  if (change === "abort") controller.abort();
  if (change === "lifetime") lifetime.abort();
  if (change === "clear") f.boundary.clear();
  release.resolve(new Response(null, { headers: { link: `<${storageType}>; rel="type"` } }));
  await expect(pending).rejects.toThrow();
  expect(f.boundary.roots()).toEqual([]);
});

test.each([
  "lws",
  "solid",
] as const)("a same-origin %s storage root confirmed by HEAD remains usable", async (format) => {
  const f = descriptionFixture(
    root,
    format,
    () =>
      new Response(null, {
        status: 401,
        headers: {
          link:
            format === "solid"
              ? `<${storageType}>; rel="type"`
              : `<${storage}>; rel="${lwsRelation}"`,
        },
      }),
  );
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.allows(root + "private")).toBe(true);
  expect(f.boundary.allows("https://pod.example/sibling/private")).toBe(false);
  const probe = f.requests.find((request) => request.method === "HEAD")!;
  expect(probe.url).toBe(root);
  expect(probe.credentials).toBe("omit");
  expect(probe.redirect).toBe("manual");
  expect(probe.headers.has("authorization")).toBe(false);
  expect(probe.headers.has("dpop")).toBe(false);
});

function umaFixture(secondRoot: string, automatic = true) {
  const op = createMockOp({ storages: [root, secondRoot], refreshTokens: true });
  const as = "https://pod.example/";
  const exchanges: Request[] = [];
  const presentations: Request[] = [];
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === as + ".well-known/uma2-configuration")
      return Response.json({
        issuer: as,
        token_endpoint: as + "uma-token",
        uma_profiles_supported: ["http://openid.net/specs/openid-connect-core-1_0.html#IDToken"],
      });
    if (request.url === as + "uma-token") {
      exchanges.push(request.clone());
      return Response.json({
        access_token: `rpt-${exchanges.length}`,
        token_type: "Bearer",
        expires_in: 300,
      });
    }
    if (request.url.endsWith("/uma")) {
      if (request.headers.has("authorization")) {
        presentations.push(request.clone());
        return new Response("private UMA resource");
      }
      return new Response(null, {
        status: 401,
        headers: { "www-authenticate": `UMA as_uri="${as}", ticket="permission"` },
      });
    }
    return op.fetch(request);
  });
  const storage = { sessions: createMemoryStore(), caches: createMemoryStore() };
  const make = () =>
    createPodAuth({
      clientId: op.clientId,
      redirectUri: op.redirectUri,
      boundary: automatic ? undefined : { roots: [root, secondRoot], automatic: false },
      ui,
      storage,
    });
  return { op, ui, exchanges, presentations, make };
}

test.each([
  false,
  true,
])("UMA RPTs stay per storage on the same origin (restored: %s)", async (restored) => {
  const secondRoot = "https://pod.example/bob/";
  const f = umaFixture(secondRoot);
  let auth = f.make();
  await auth.login({ webId: f.op.webId });
  if (restored) {
    auth = f.make();
    expect(await auth.restore()).not.toBeNull();
  }
  expect((await auth.fetch(root + "uma")).status).toBe(200);
  expect((await auth.fetch(secondRoot + "uma")).status).toBe(200);
  expect((await auth.fetch(root + "uma")).status).toBe(200);
  expect((await auth.fetch(secondRoot + "uma")).status).toBe(200);
  expect(f.exchanges).toHaveLength(2);
  expect(f.presentations.map((request) => request.headers.get("authorization"))).toEqual([
    "Bearer rpt-1",
    "Bearer rpt-2",
    "Bearer rpt-1",
    "Bearer rpt-2",
  ]);
  // The mock refresh omits an ID token. UMA tries refresh once more, then obtains one
  // through OIDC; both storages reuse that shared session after restore.
  expect(f.ui.getCode).toHaveBeenCalledTimes(2);
  if (restored) expect(f.op.stats.refreshes).toBe(2);
  await auth.logout();
});

test.each([
  false,
  true,
])("UMA cannot name another learned storage's AS (restored: %s)", async (restored) => {
  const secondRoot = "https://other-pod.example/bob/";
  const f = umaFixture(secondRoot);
  let auth = f.make();
  await auth.login({ webId: f.op.webId });
  if (restored) {
    auth = f.make();
    expect(await auth.restore()).not.toBeNull();
  }
  expect((await auth.fetch(root + "uma")).status).toBe(200);
  const logins = f.ui.getCode.mock.calls.length;
  await expect(auth.fetch(secondRoot + "uma")).rejects.toThrow("not trusted");
  expect(f.exchanges).toHaveLength(1);
  expect(f.presentations.some((request) => request.url.startsWith(secondRoot))).toBe(false);
  expect(f.ui.getCode).toHaveBeenCalledTimes(logins);
  await auth.logout();
});

test.each([
  false,
  true,
])("an explicitly configured root's origin may serve as another storage's UMA AS without sharing RPTs (restored: %s)", async (restored) => {
  const secondRoot = "https://other-pod.example/bob/";
  const f = umaFixture(secondRoot, false);
  let auth = f.make();
  await auth.login({ webId: f.op.webId });
  if (restored) {
    auth = f.make();
    expect(await auth.restore()).not.toBeNull();
  }
  expect((await auth.fetch(root + "uma")).status).toBe(200);
  expect((await auth.fetch(secondRoot + "uma")).status).toBe(200);
  // Configured roots vouch for the AS origin, but each storage still exchanges its own ticket.
  expect(f.exchanges).toHaveLength(2);
  expect(f.presentations.map((request) => request.headers.get("authorization"))).toEqual([
    "Bearer rpt-1",
    "Bearer rpt-2",
  ]);
  await auth.logout();
});

test("the UMA AS check refuses a learned storage's origin and accepts the resource's own origin", () => {
  const boundary = createBoundary({ boundary: { roots: [root] } }, { fetch: globalThis.fetch });
  const binding = (as: string, resource: string) => ({
    authorizationServer: new URL(as),
    resource: new URL(resource),
  });
  expect(boundary.trustUmaAuthorizationServer(binding("https://pod.example/as", root + "x"))).toBe(
    true,
  );
  expect(boundary.trustUmaAuthorizationServer(binding(attacker, root + "x"))).toBe(false);
  expect(boundary.trustUmaAuthorizationServer(binding("https://pod.example/as", attacker))).toBe(
    false,
  );
});

test("a Solid storage type alone cannot confirm a sibling of the identifier", async () => {
  const sibling = "https://pod.example/bob/";
  const f = descriptionFixture(
    sibling,
    "solid",
    () => new Response(null, { headers: { link: `<${storageType}>; rel="type"` } }),
  );
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.allows(`${sibling}private`)).toBe(false);
  expect(f.boundary.roots()).toEqual([storage]);
});

test("at most eight same-origin description roots are probed", async () => {
  const op = createMockOp({ storages: [storage] });
  const advertised = Array.from({ length: 12 }, (_, i) => `https://pod.example/r${i}/`);
  const heads: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "HEAD") {
      heads.push(request.url);
      return new Response(null, { status: 404 });
    }
    if (request.url === storage) return turtleTypes(advertised);
    return op.fetch(request);
  };
  const boundary = createBoundary({}, { fetch });
  await boundary.learn(op.webId, new AbortController().signal);
  expect(heads).toHaveLength(8);
  expect(boundary.roots()).toEqual([storage]);
});

test.each([
  ["a back-link to the identifier", true],
  ["a back-link to another description", false],
])("a Solid sibling root is confirmed only by %s", async (_label, matches) => {
  const sibling = "https://pod.example/bob/";
  const description = matches ? storage : "https://pod.example/bob/description";
  const f = descriptionFixture(
    sibling,
    "solid",
    () =>
      new Response(null, {
        headers: {
          link: `<${storageType}>; rel="type", <${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      }),
  );
  await f.boundary.learn(f.op.webId, new AbortController().signal);
  expect(f.boundary.allows(`${sibling}private`)).toBe(matches);
});
