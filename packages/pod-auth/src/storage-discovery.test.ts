// AUTHORED-BY Claude Opus 5.5
// Credential boundary discovery for WebID profiles without pim:storage (CSS 7 default profiles).
import { DataFactory, Writer } from "n3";
import { afterEach, expect, test, vi } from "vitest";
import { createBoundary } from "./boundary.js";
import { createPodAuth } from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => vi.unstubAllGlobals());

const { namedNode, quad } = DataFactory;
const PIM = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const DESCRIPTION_REL = `${SOLID}storageDescription`;
const STORAGE_TYPE = `<${PIM}Storage>; rel="type"`;

const document = "https://pod.example/alice/profile/card";
const webId = `${document}#me`;
const root = "https://pod.example/alice/";
const description = "https://pod.example/alice/.well-known/solid";
const attacker = "https://attacker.example/";

function turtle(triples: [string, string, string][], headers: Record<string, string> = {}) {
  const body = new Writer().quadsToString(
    triples.map(([s, p, o]) => quad(namedNode(s), namedNode(p), namedNode(o))),
  );
  return new Response(body, { headers: { "content-type": "text/turtle", ...headers } });
}

const profile = (link?: string, extra: [string, string, string][] = []) =>
  turtle(
    [[webId, `${SOLID}oidcIssuer`, "https://op.example/"], ...extra],
    link === undefined ? {} : { link },
  );
const describesStorages = (...storages: string[]) =>
  turtle(storages.map((storage) => [storage, RDF_TYPE, `${PIM}Storage`]));
const unauthorized = () => new Response(null, { status: 401 });

type Handler = (request: Request) => Response | Promise<Response> | undefined;

/** A server answering only what `handler` knows; everything else is 404. Records every request. */
function server(handler: Handler) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return (await handler(request)) ?? new Response(null, { status: 404 });
  };
  return { requests, fetch };
}

async function learn(handler: Handler, options: Parameters<typeof createBoundary>[0] = {}) {
  const s = server(handler);
  const boundary = createBoundary(options, { fetch: s.fetch });
  await boundary.learn(webId, new AbortController().signal);
  return { ...s, boundary };
}

/** The CSS 7.2.0 shape: description link on the profile, public description, private root. */
const css: Handler = (request) => {
  if (request.url === document) return profile(`<${description}>; rel="${DESCRIPTION_REL}"`);
  if (request.url === description) return describesStorages("../");
  if (request.url.startsWith(root)) return unauthorized();
  if (request.url === "https://pod.example/")
    return new Response("<html>", { headers: { "content-type": "text/html" } });
  return undefined;
};

function expectAnonymous(requests: Request[]) {
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("dpop")).toBeNull();
    expect(request.credentials).toBe("omit");
  }
}

test("a CSS 7.2 profile without pim:storage gets its storage from the advertised description", async () => {
  const { boundary, requests } = await learn(css);
  expect(boundary.storages()).toEqual([root]);
  expect(boundary.discovery()).toEqual({ source: "storage-description", root });
  expect(boundary.allows(`${root}private/image.png`)).toBe(true);
  expect(boundary.allows("https://pod.example/bob/x")).toBe(false);
  expect(boundary.allows("https://pod.example/")).toBe(false);
  expect(boundary.allows(`${attacker}alice/`)).toBe(false);
  // Profile GET, description GET, then every ancestor up to the claimed root; nothing else.
  expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
    `GET ${document}`,
    `GET ${description}`,
    `HEAD ${root}profile/`,
    `HEAD ${root}`,
  ]);
  expectAnonymous(requests);
});

test("a public root that self-identifies confirms the description", async () => {
  const { boundary } = await learn((request) =>
    request.url === root
      ? new Response(null, {
          headers: { link: `${STORAGE_TYPE}, <${description}>; rel="${DESCRIPTION_REL}"` },
        })
      : css(request),
  );
  expect(boundary.discovery()).toEqual({ source: "storage-description", root });
});

test("a readable root that does not self-identify contradicts the description", async () => {
  const { boundary } = await learn((request) =>
    request.url === root ? new Response(null, { status: 200 }) : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
});

test("a root naming another storage description contradicts the description", async () => {
  const { boundary } = await learn((request) =>
    request.url === root
      ? new Response(null, {
          headers: {
            link: `${STORAGE_TYPE}, <https://pod.example/other/.well-known/solid>; rel="${DESCRIPTION_REL}"`,
          },
        })
      : css(request),
  );
  // The document and its storage disagree about the description: nothing is learned.
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
});

test.each([
  [
    "a redirect",
    () => new Response(null, { status: 302, headers: { location: root } }),
    "storage-unconfirmed",
  ],
  ["a not-found", () => new Response(null, { status: 404 }), "storage-unconfirmed"],
  ["a server error", () => new Response(null, { status: 500 }), "discovery-failed"],
  ["a rate limit", () => new Response(null, { status: 429 }), "discovery-failed"],
  [
    "a network failure",
    () => {
      throw new TypeError("offline");
    },
    "discovery-failed",
  ],
] as const)("a root answering with %s does not confirm the description", async (_name, answer, reason) => {
  const { boundary } = await learn((request) => (request.url === root ? answer() : css(request)));
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason });
});

test.each([
  ["a not-found", () => new Response(null, { status: 404 }), "storage-unconfirmed"],
  [
    "a redirect",
    () => new Response(null, { status: 302, headers: { location: "/" } }),
    "storage-unconfirmed",
  ],
  [
    "an unparseable body",
    () => new Response("<<<", { headers: { "content-type": "text/turtle" } }),
    "storage-unconfirmed",
  ],
  ["a server error", () => new Response(null, { status: 500 }), "discovery-failed"],
] as const)("a description answering with %s learns nothing and never walks", async (_name, answer, reason) => {
  const { boundary, requests } = await learn((request) =>
    request.url === description ? answer() : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason });
  expect(requests.some((r) => r.method === "HEAD")).toBe(false);
});

test.each([
  ["another origin", `${attacker}alice/`],
  ["a sibling pod", "https://pod.example/bob/"],
  ["a descendant of the profile container", "https://pod.example/alice/profile/card/"],
  ["a non-container", "https://pod.example/alice"],
  ["a container with a query", "https://pod.example/alice/?x=1"],
  ["an ambiguous path", "https://pod.example/alice/%2e%2e/"],
])("a description claiming %s grants nothing", async (_name, claim) => {
  const { boundary, requests } = await learn((request) =>
    request.url === description ? describesStorages(claim) : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(claim)).toBe(false);
  expect(requests.some((r) => r.url.startsWith(attacker))).toBe(false);
  expectAnonymous(requests);
});

test("an LWS-format description with malformed or relative roots grants nothing", async () => {
  const { boundary } = await learn((request) =>
    request.url === description
      ? Response.json(
          {
            id: description,
            type: "Storage",
            service: [
              { type: "StorageRoot", serviceEndpoint: "not a url" },
              { type: "StorageRoot", serviceEndpoint: "/alice/" },
              { type: "StorageRoot", serviceEndpoint: "https://user@pod.example/alice/" },
            ],
          },
          { headers: { "content-type": "application/lws+cid" } },
        )
      : css(request),
  );
  expect(boundary.storages()).toEqual([]);
});

test("a description claiming the origin root is refused when the root does not self-identify", async () => {
  const { boundary } = await learn((request) =>
    request.url === description ? describesStorages("https://pod.example/") : css(request),
  );
  expect(boundary.allows("https://pod.example/bob/x")).toBe(false);
  expect(boundary.storages()).toEqual([]);
});

test("of nested claimed storages a contradicted inner claim fails them all", async () => {
  const { boundary } = await learn((request) =>
    request.url === description
      ? describesStorages("https://pod.example/", root, `${root}profile/`)
      : request.url === `${root}profile/`
        ? new Response(null, { status: 200 })
        : css(request),
  );
  // profile/ is readable without self-identifying, which contradicts the description outright.
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
});

test("of nested claimed storages the nearest one wins", async () => {
  const { boundary } = await learn((request) =>
    request.url === description ? describesStorages("https://pod.example/", root) : css(request),
  );
  expect(boundary.discovery()).toEqual({ source: "storage-description", root });
});

test.each([
  ["on another origin", `<${attacker}.well-known/solid>; rel="${DESCRIPTION_REL}"`],
  [
    "twice",
    `<${description}>; rel="${DESCRIPTION_REL}", <https://pod.example/x/.well-known/solid>; rel="${DESCRIPTION_REL}"`,
  ],
  ["anchored to another resource", `<${description}>; rel="${DESCRIPTION_REL}"; anchor="/bob/"`],
])("a description link %s is ignored", async (_name, link) => {
  const { boundary, requests } = await learn((request) =>
    request.url === document
      ? profile(link)
      : request.url.startsWith(attacker)
        ? describesStorages(`${attacker}`)
        : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(requests.some((r) => r.url.startsWith(attacker))).toBe(false);
  expect(requests.some((r) => r.url === description)).toBe(false);
});

test("a redirected storage description is not followed", async () => {
  const { boundary, requests } = await learn((request) =>
    request.url === description
      ? new Response(null, { status: 302, headers: { location: `${attacker}solid` } })
      : request.url.startsWith(attacker)
        ? describesStorages(root)
        : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(requests.some((r) => r.url.startsWith(attacker))).toBe(false);
});

test("without a description, the nearest self-identifying ancestor is the storage", async () => {
  const { boundary, requests } = await learn((request) => {
    if (request.url === document) return profile();
    if (request.method === "HEAD" && request.url === root)
      return new Response(null, { headers: { link: STORAGE_TYPE } });
    if (request.method === "HEAD" && request.url === "https://pod.example/")
      return new Response(null, { headers: { link: STORAGE_TYPE } });
    return unauthorized();
  });
  expect(boundary.storages()).toEqual([root]);
  expect(boundary.discovery()).toEqual({ source: "storage-type", root });
  expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
    `GET ${document}`,
    `HEAD ${root}profile/`,
    `HEAD ${root}`,
  ]);
  expectAnonymous(requests);
});

test.each([
  ["a redirect", { status: 302, headers: { location: "/", link: STORAGE_TYPE } }],
  ["a server error", { status: 500, headers: { link: STORAGE_TYPE } }],
  ["an anchored type", { headers: { link: `${STORAGE_TYPE}; anchor="/bob/"` } }],
] as const)("an ancestor type link on %s is not storage evidence", async (_name, init) => {
  const { boundary } = await learn((request) =>
    request.url === document
      ? profile()
      : request.method === "HEAD" && request.url === root
        ? new Response(null, init)
        : unauthorized(),
  );
  expect(boundary.storages()).toEqual([]);
});

test("no claim at all leaves the boundary empty, stopping at the first unreadable ancestor past the document's container", async () => {
  const { boundary, requests } = await learn((request) =>
    request.url === document ? profile() : unauthorized(),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${root}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
  expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
    `GET ${document}`,
    `HEAD ${root}profile/`,
    `HEAD ${root}`,
  ]);
  expectAnonymous(requests);
});

test("ancestor probing is bounded for deep WebID paths", async () => {
  const deep = `https://pod.example/${"a/".repeat(30)}card`;
  // Readable, untyped containers are passed; the walk still stops after ten.
  const s = server((request) =>
    request.url === deep ? turtle([]) : new Response(null, { status: 200 }),
  );
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn(`${deep}#me`, new AbortController().signal);
  expect(s.requests.filter((r) => r.method === "HEAD")).toHaveLength(10);
  expect(boundary.storages()).toEqual([]);
});

test("a WebID document served from another origin after a redirect gets no fallback", async () => {
  const other = "https://id.example/alice";
  const s = server((request) => {
    if (request.url === other)
      return new Response(null, { status: 302, headers: { location: document } });
    // The redirect target advertises a storage, but it is not the WebID's origin.
    return css(request);
  });
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn(`${other}#me`, new AbortController().signal);
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "profile-redirected" });
  expect(s.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
    `GET ${other}`,
    `GET ${document}`,
  ]);
});

test("a same-origin redirect discovers from the document actually served", async () => {
  const s = server((request) =>
    request.url === "https://pod.example/alice/me"
      ? new Response(null, { status: 303, headers: { location: document } })
      : css(request),
  );
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn("https://pod.example/alice/me#i", new AbortController().signal);
  expect(boundary.storages()).toEqual([root]);
});

test("a profile with pim:storage never falls back to server discovery", async () => {
  const { boundary, requests } = await learn((request) =>
    request.url === document
      ? profile(`<${description}>; rel="${DESCRIPTION_REL}"`, [
          [webId, `${PIM}storage`, "https://storage.example/alice/"],
        ])
      : css(request),
  );
  expect(boundary.storages()).toEqual(["https://storage.example/alice/"]);
  expect(boundary.discovery()).toEqual({ source: "profile" });
  expect(requests.map((r) => r.url)).toEqual([document]);
});

test("a profile whose pim:storage is ineligible reports it and does not fall back", async () => {
  const { boundary, requests } = await learn((request) =>
    request.url === document
      ? profile(`<${description}>; rel="${DESCRIPTION_REL}"`, [
          [webId, `${PIM}storage`, "http://pod.example/alice/"],
        ])
      : css(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({
    source: "none",
    reason: "storage-ineligible",
    declaredBy: "profile",
  });
  expect(requests.map((r) => r.url)).toEqual([document]);
});

test("the eligibility policy applies to discovered storages", async () => {
  const { boundary } = await learn(css, { boundary: { eligible: () => false } });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({
    source: "none",
    reason: "storage-ineligible",
    declaredBy: "server",
  });
});

test("automatic: false performs no discovery and reports none", async () => {
  const { boundary, requests } = await learn(css, { boundary: { automatic: false } });
  expect(requests).toEqual([]);
  expect(boundary.discovery()).toBeUndefined();
});

test("logout clears the discovered storage and its provenance", async () => {
  const { boundary } = await learn(css);
  boundary.clear();
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toBeUndefined();
});

/** A mock OP whose WebID lives in a CSS-style pod without pim:storage. */
function cssLogin(advertise: boolean) {
  const op = createMockOp({ webId, storages: [] });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === document)
      return turtle(
        [[webId, `${SOLID}oidcIssuer`, op.issuer]],
        advertise ? { link: `<${description}>; rel="${DESCRIPTION_REL}"` } : {},
      );
    if (request.url === description) return describesStorages("../");
    // CSS 7.2 answers anonymous requests for a private container with a bare 401.
    if (request.method === "HEAD" && !request.headers.has("authorization")) return unauthorized();
    return op.fetch(request);
  };
  vi.stubGlobal("fetch", fetch);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    ui: { getWebId: async () => webId, getCode: op.getCode },
  });
  return { op, auth };
}

test("end to end: a CSS-style pod receives DPoP credentials after login", async () => {
  const { op, auth } = cssLogin(true);
  const identity = await auth.login({ webId });
  expect(identity.storages).toEqual([root]);
  expect(identity.storageDiscovery).toEqual({ source: "storage-description", root });
  expect(await auth.identity()).toEqual(identity);
  const response = await auth.fetch(`${root}private`);
  expect(await response.text()).toBe("protected Solid");
  const sent = op.requests.filter((r) => r.url === `${root}private`);
  expect(sent.at(-1)?.headers.get("authorization")).toMatch(/^DPoP /);
});

test("end to end: no declared storage stays anonymous and says why", async () => {
  const { op, auth } = cssLogin(false);
  const identity = await auth.login({ webId });
  expect(identity.storages).toEqual([]);
  expect(identity.storageDiscovery).toEqual({ source: "none", reason: "no-storage-declared" });
  const response = await auth.fetch(`${root}private`);
  expect(response.status).toBe(401);
  for (const request of op.requests.filter((r) => r.url.startsWith(root)))
    expect(request.headers.get("authorization")).toBeNull();
});

test("a WebID whose document is a container may be its own storage", async () => {
  const s = server((request) =>
    request.method === "GET"
      ? turtle([])
      : request.url === root
        ? new Response(null, { headers: { link: STORAGE_TYPE } })
        : unauthorized(),
  );
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn(`${root}#me`, new AbortController().signal);
  expect(boundary.discovery()).toEqual({ source: "storage-type", root });
});

test("a WebID document with an ambiguous path probes nothing", async () => {
  const ambiguous = "https://pod.example/alice%2fbob/card";
  const s = server((request) =>
    request.method === "GET"
      ? turtle([], { link: `<${description}>; rel="${DESCRIPTION_REL}"` })
      : new Response(null, { headers: { link: STORAGE_TYPE } }),
  );
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn(`${ambiguous}#me`, new AbortController().signal);
  expect(boundary.storages()).toEqual([]);
  expect(s.requests.filter((r) => r.method === "HEAD")).toEqual([]);
});

test("a profile response for another URL (a followed browser redirect) gives no description evidence", async () => {
  const { boundary, requests } = await learn((request) => {
    if (request.url !== document) return css(request);
    const response = profile(`<${description}>; rel="${DESCRIPTION_REL}"`);
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  expect(boundary.storages()).toEqual([]);
  expect(requests.some((r) => r.url === description)).toBe(false);
});

test("a profile response describing another URL gives no description evidence", async () => {
  const { boundary, requests } = await learn((request) => {
    if (request.url !== document) return css(request);
    const response = profile(`<${description}>; rel="${DESCRIPTION_REL}"`);
    Object.defineProperty(response, "url", { value: `${root}other` });
    return response;
  });
  // Only the ancestor walk runs: the document's container is passed, the private root stops it.
  expect(requests.some((r) => r.url === description)).toBe(false);
  expect(boundary.storages()).toEqual([]);
});

test("an unreadable origin root holding the document is never passed", async () => {
  const s = server((request) =>
    request.method === "GET"
      ? turtle([])
      : request.url === "https://pod.example/"
        ? unauthorized()
        : undefined,
  );
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn("https://pod.example/card#me", new AbortController().signal);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("a claimed origin root is not confirmed by a 401 past the document's unreadable container", async () => {
  const s = server((request) => {
    if (request.url === `${root}card`)
      return turtle([], {
        link: `<https://pod.example/.well-known/solid>; rel="${DESCRIPTION_REL}"`,
      });
    if (request.url === "https://pod.example/.well-known/solid") return describesStorages("../");
    return unauthorized();
  });
  const boundary = createBoundary({}, { fetch: s.fetch });
  await boundary.learn(`${root}card#me`, new AbortController().signal);
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
});
