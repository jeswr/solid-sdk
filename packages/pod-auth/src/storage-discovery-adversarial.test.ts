// AUTHORED-BY Claude Opus 5.5
// Adversarial review of the login-time storage fallback (review of 14143e09b, findings F1-F4):
// learning nothing is always acceptable; a root broader than the user's own storage never is.
// Re-review of 7c09caa78 (N1-N3, I1) cases follow at the end.
import { DataFactory, Writer } from "n3";
import { expect, test } from "vitest";
import { createBoundary } from "./boundary.js";

const { namedNode, quad } = DataFactory;
const PIM = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const DESCRIPTION_REL = `${SOLID}storageDescription`;

const origin = "https://pod.example/";
const description = `${origin}.well-known/solid`;
const alice = `${origin}alice/`;
const mallory = `${origin}mallory/`;
const card = (pod: string) => `${pod}profile/card`;

const typed = (extra = "") =>
  new Response(null, {
    headers: {
      link: `<${PIM}Storage>; rel="type", <http://www.w3.org/ns/ldp#Container>; rel="type"${extra}`,
    },
  });
const advertising = `, <${description}>; rel="${DESCRIPTION_REL}"`;
const unauthorized = () => new Response(null, { status: 401 });
const readable = () => new Response(null, { status: 200 });

function turtle(triples: [string, string, string][], headers: Record<string, string> = {}) {
  const body = new Writer().quadsToString(
    triples.map(([s, p, o]) => quad(namedNode(s), namedNode(p), namedNode(o))),
  );
  return new Response(body, { headers: { "content-type": "text/turtle", ...headers } });
}
const profile = (webId: string, link?: string) =>
  turtle([[webId, `${SOLID}oidcIssuer`, "https://op.example/"]], link ? { link } : {});
const describesStorages = (...storages: string[]) =>
  turtle(storages.map((storage) => [storage, RDF_TYPE, `${PIM}Storage`]));

type Handler = (request: Request) => Response | undefined;

async function learn(webId: string, handler: Handler) {
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${request.url}`);
    expect(request.headers.get("authorization")).toBeNull();
    return handler(request) ?? new Response(null, { status: 404 });
  };
  const boundary = createBoundary({}, { fetch });
  await boundary.learn(webId, new AbortController().signal);
  return { boundary, requests };
}

/**
 * Community Solid Server 7.2.0 with its own `config/default.json` (captured live): path-based pods
 * plus a storage at the origin root. Every resource advertises `/.well-known/solid`, which says
 * `<../> a pim:Storage` (the origin root). Pod roots are public and typed, the profile container
 * is private and answers 401 without a type Link, the server root is public, typed and writable.
 */
const cssDefault: Handler = (request) => {
  const { url } = request;
  if (url === card(alice) || url === card(mallory))
    return profile(`${url}#me`, `<${description}>; rel="${DESCRIPTION_REL}"`);
  if (url === description) return describesStorages("../");
  if (url === origin || url === alice || url === mallory) return typed(advertising);
  if (url === `${alice}profile/` || url === `${mallory}profile/`) return unauthorized();
  return undefined;
};

test("CSS default config: alice learns her pod, never the server root or a co-tenant", async () => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, cssDefault);
  expect(boundary.discovery()).toEqual({ source: "storage-type", root: alice });
  expect(boundary.storages()).toEqual([alice]);
  expect(boundary.allows(`${alice}private/x`)).toBe(true);
  expect(boundary.allows(`${mallory}private/x`)).toBe(false);
  expect(boundary.allows(origin)).toBe(false);
  expect(boundary.allows(`${origin}app/`)).toBe(false);
  // Every ancestor up to the nearer storage is probed; the claimed root is not reached.
  expect(requests).toEqual([
    `GET ${card(alice)}`,
    `GET ${description}`,
    `HEAD ${alice}profile/`,
    `HEAD ${alice}`,
  ]);
  const other = await learn(`${card(mallory)}#me`, cssDefault);
  expect(other.boundary.storages()).toEqual([mallory]);
  expect(other.boundary.allows(`${alice}x`)).toBe(false);
});

test("F1/N1: a claimed pod root past the private profile container is refused, never widened", async () => {
  // Same shape as CSS default, but the description also claims the pod root. Past a container that
  // might itself be the storage, a claimed container is indistinguishable from a broader server
  // storage (N1), so nothing is learned.
  const { boundary } = await learn(`${card(alice)}#me`, (request) =>
    request.url === description ? describesStorages(origin, alice) : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("F2: an unreadable pod root that does not self-identify stops the walk below a typed server root", async () => {
  // CSS sends no type Link on 401, so a private pod root looks like any private container.
  const { boundary } = await learn(`${card(alice)}#me`, (request) => {
    if (request.url === card(alice)) return profile(`${card(alice)}#me`);
    if (request.url === origin) return typed();
    return request.url.startsWith(alice) ? unauthorized() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("F2: CSS default with a private pod root learns nothing rather than the claimed server root", async () => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) =>
    request.url.startsWith(alice) && request.method === "HEAD"
      ? unauthorized()
      : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
});

test("F2: a private document container directly below a typed server root is not passed", async () => {
  const webId = `${alice}card#me`;
  const { boundary } = await learn(webId, (request) => {
    if (request.url === `${alice}card`) return profile(webId);
    if (request.url === origin) return typed();
    return request.url === alice ? unauthorized() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
});

test("F2b: a transient description failure learns nothing and does not fall through to the walk", async () => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, (request) =>
    request.url === description ? new Response(null, { status: 503 }) : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "discovery-failed" });
  expect(requests.filter((r) => r.startsWith("HEAD"))).toEqual([]);
});

test.each([
  ["a 429", () => new Response(null, { status: 429 })],
  [
    "a network failure",
    () => {
      throw new TypeError("offline");
    },
  ],
])("F2b: %s on the description learns nothing", async (_name, answer) => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) =>
    request.url === description ? answer() : cssDefault(request),
  );
  expect(boundary.discovery()).toEqual({ source: "none", reason: "discovery-failed" });
});

test("F2b: a transient ancestor failure learns nothing and never climbs past it", async () => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, (request) =>
    request.url === alice ? new Response(null, { status: 503 }) : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "discovery-failed" });
  expect(requests).not.toContain(`HEAD ${origin}`);
});

test("F3: a contradicted specific claim fails the description; a bare 401 never confirms a broader one", async () => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) => {
    if (request.url === card(alice))
      return profile(`${card(alice)}#me`, `<${description}>; rel="${DESCRIPTION_REL}"`);
    if (request.url === description) return describesStorages(alice, origin);
    if (request.url === `${alice}profile/`) return readable();
    if (request.url === alice) return readable();
    return request.url === origin ? unauthorized() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
});

test("F4: a profile redirect through another origin learns nothing, even back to the WebID's origin", async () => {
  const webId = `${alice}card#me`;
  const { boundary, requests } = await learn(webId, (request) => {
    if (request.url === `${alice}card`)
      return new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/x" },
      });
    if (request.url === "https://elsewhere.example/x")
      return new Response(null, { status: 302, headers: { location: card(mallory) } });
    if (request.url === card(mallory)) return profile(webId);
    if (request.url === mallory) return typed();
    return request.url === `${mallory}profile/` ? readable() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "profile-redirected" });
  expect(requests.filter((r) => r.startsWith("HEAD"))).toEqual([]);
});

// Re-review of 7c09caa78 (findings N1-N3, I1): each case widened, or silently ignored evidence,
// before the fix.

/** CSS 7.2.0 `default.json` behind a path prefix (`-b https://pod.example/solid/`), captured live. */
const prefixed = `${origin}solid/`;
const prefixedDescription = `${prefixed}.well-known/solid`;
const prefixedCard = `${prefixed}alice/card`;
const prefixedAdvertising = `, <${prefixedDescription}>; rel="${DESCRIPTION_REL}"`;
const subPathServer =
  (root: () => Response): Handler =>
  (request) => {
    if (request.url === prefixedCard)
      return profile(`${prefixedCard}#me`, `<${prefixedDescription}>; rel="${DESCRIPTION_REL}"`);
    if (request.url === prefixedDescription) return describesStorages("../");
    if (request.url === prefixed) return root();
    // Alice's pod root holds her WebID document; it is private and untyped on 401.
    if (request.url === `${prefixed}alice/`) return unauthorized();
    return undefined;
  };

test("N1 (A): a typed, claimed sub-path server storage past a private pod root is refused", async () => {
  const { boundary } = await learn(
    `${prefixedCard}#me`,
    subPathServer(() => typed(prefixedAdvertising)),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${prefixed}mallory/x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N1 (A2): a claimed sub-path server storage answering 401 past a private pod root is refused", async () => {
  const { boundary } = await learn(`${prefixedCard}#me`, subPathServer(unauthorized));
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${prefixed}mallory/x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N1 (A3): without a description, a typed container past a private one is refused", async () => {
  const webId = `${origin}a/b/card#me`;
  const { boundary } = await learn(webId, (request) => {
    if (request.url === `${origin}a/b/card`) return profile(webId);
    if (request.url === `${origin}a/b/`) return unauthorized();
    return request.url === `${origin}a/` ? typed() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${origin}a/other/x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N1: CSS default behind a path prefix still learns the nested pod, never the server storage", async () => {
  const webId = `${prefixed}alice/profile/card#me`;
  const { boundary } = await learn(webId, (request) => {
    if (request.url === `${prefixed}alice/profile/card`)
      return profile(webId, `<${prefixedDescription}>; rel="${DESCRIPTION_REL}"`);
    if (request.url === prefixedDescription) return describesStorages("../");
    if (request.url === `${prefixed}alice/profile/`) return unauthorized();
    if (request.url === `${prefixed}alice/` || request.url === prefixed)
      return typed(prefixedAdvertising);
    return undefined;
  });
  expect(boundary.discovery()).toEqual({ source: "storage-type", root: `${prefixed}alice/` });
  expect(boundary.allows(`${prefixed}mallory/x`)).toBe(false);
});

test("N1: a typed pod past the document's container must answer 2xx and not be claimed itself", async () => {
  // A typed 401 pod root under the claimed server storage is not accepted past a passed container.
  const { boundary } = await learn(`${card(alice)}#me`, (request) =>
    request.url === alice
      ? new Response(null, { status: 401, headers: { link: `<${PIM}Storage>; rel="type"` } })
      : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N2 (B): a typed origin root past readable, untyped containers is refused", async () => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) => {
    if (request.url === card(alice)) return profile(`${card(alice)}#me`);
    if (request.url === `${alice}profile/` || request.url === alice) return readable();
    return request.url === origin ? typed() : undefined;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N2: a claimed root past a readable, untyped container is refused", async () => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) => {
    if (request.url === `${alice}profile/`) return readable();
    if (request.url === description) return describesStorages(alice);
    return request.url === alice ? unauthorized() : cssDefault(request);
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
});

test("N3 (C): a same-origin profile redirect to another user's document learns nothing", async () => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, (request) => {
    if (request.url === card(alice))
      return new Response(null, { status: 302, headers: { location: card(mallory) } });
    return cssDefault(request);
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "profile-redirected" });
  expect(requests.filter((r) => r.startsWith("HEAD"))).toEqual([]);
});

test("N3: a document served for another URL without a visible redirect learns nothing", async () => {
  const { boundary } = await learn(`${card(alice)}#me`, (request) => {
    const response = cssDefault(request);
    if (request.url === card(alice) && response !== undefined)
      Object.defineProperty(response, "url", { value: card(mallory) });
    return response;
  });
  expect(boundary.storages()).toEqual([]);
});

test.each([
  [
    "two description links",
    `<${description}>; rel="${DESCRIPTION_REL}", <${alice}.well-known/solid>; rel="${DESCRIPTION_REL}"`,
  ],
  [
    "a cross-origin description link",
    `<https://elsewhere.example/solid>; rel="${DESCRIPTION_REL}"`,
  ],
])("I1 (D): %s on the profile is reported and learns nothing", async (_name, link) => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, (request) =>
    request.url === card(alice) ? profile(`${card(alice)}#me`, link) : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
  expect(requests).toEqual([`GET ${card(alice)}`]);
});

test("I1: a profile response that does not describe the document is reported and learns nothing", async () => {
  const { boundary, requests } = await learn(`${card(alice)}#me`, (request) => {
    const response = cssDefault(request);
    if (request.url === card(alice) && response !== undefined)
      Object.defineProperty(response, "url", { value: `${card(alice)}?v=2` });
    return response;
  });
  expect(boundary.storages()).toEqual([]);
  expect(boundary.discovery()).toEqual({ source: "none", reason: "storage-unconfirmed" });
  expect(requests).toEqual([`GET ${card(alice)}`]);
});

// Review of c86c6eab7 (L1): a WebID document stored directly in a shared storage at the origin
// root must never make the whole origin the user's boundary.
test("L1: a WebID document directly in a typed origin-root storage learns nothing", async () => {
  const doc = `${origin}alice-card`;
  const { boundary } = await learn(`${doc}#me`, (request) => {
    if (request.url === doc)
      return profile(`${doc}#me`, `<${description}>; rel="${DESCRIPTION_REL}"`);
    if (request.url === description) return describesStorages("../");
    if (request.url === origin) return typed(advertising);
    return undefined;
  });
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
  expect(boundary.allows(`${mallory}x`)).toBe(false);
});

test("L1: a WebID document directly in a claimed, private origin root learns nothing", async () => {
  const doc = `${origin}alice-card`;
  const { boundary } = await learn(`${doc}#me`, (request) => {
    if (request.url === doc)
      return profile(`${doc}#me`, `<${description}>; rel="${DESCRIPTION_REL}"`);
    if (request.url === description) return describesStorages("../");
    if (request.url === origin) return unauthorized();
    return undefined;
  });
  expect(boundary.discovery()).toEqual({ source: "none", reason: "no-storage-declared" });
  expect(boundary.allows(`${mallory}x`)).toBe(false);
});
