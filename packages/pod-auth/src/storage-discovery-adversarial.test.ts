// AUTHORED-BY Claude Opus 5.5
// Adversarial review of the login-time storage fallback (review of 14143e09b, findings F1-F4):
// learning nothing is always acceptable; a root broader than the user's own storage never is.
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

test("F1: a typed storage nearer than the claimed root wins, even when the root is claimed and typed", async () => {
  // Same shape as CSS default, but the pod root is checked against a description that names it too.
  const { boundary } = await learn(`${card(alice)}#me`, (request) =>
    request.url === description ? describesStorages(origin, alice) : cssDefault(request),
  );
  expect(boundary.storages()).toEqual([alice]);
  expect(boundary.allows(`${mallory}x`)).toBe(false);
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
