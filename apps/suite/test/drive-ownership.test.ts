// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import { isOwnStorage, resolveItemOwner } from "../src/apps/drive/lib/client/ownership";

const ROOT = "https://pod.example/bob/";
const ITEM = `${ROOT}public/file.txt`;
const WEBID = "https://id.example/bob#me";
const DESCRIPTION = `${ROOT}description`;
const REL = "http://www.w3.org/ns/solid/terms#storageDescription";
const OWNER = "http://www.w3.org/ns/solid/terms#owner";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const FOAF = "http://xmlns.com/foaf/0.1/name";
const VCARD = "http://www.w3.org/2006/vcard/ns#fn";
function rdf(body: string, link?: string) {
  return new Response(body, {
    headers: { "content-type": "text/turtle", ...(link ? { link } : {}) },
  });
}
function fixture(body: string, link = `<${DESCRIPTION}>; rel="${REL}"`) {
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "HEAD") return new Response(null, { headers: { link } });
    if (url === DESCRIPTION) return rdf(body);
    return new Response(null, { status: 404 });
  });
  return {
    http,
    session: {
      storageUrl: "https://pod.example/alice/",
      webId: "https://id.example/alice",
      fetch: http,
    },
  };
}
it("owns only items inside the session storage root, including other apps' folders", async () => {
  const f = fixture("");
  expect(await resolveItemOwner(`${f.session.storageUrl}docs/a`, f.session)).toEqual({
    webId: f.session.webId,
    label: "Me",
  });
  expect(f.http).not.toHaveBeenCalled();
  for (const url of [
    ITEM,
    "https://pod.example/alice-other/a",
    "https://pod.example/alice/../bob/a",
    "https://pod.example/alice/%2e%2e/bob/a",
    "https://evil.example/alice/a",
    "invalid",
    "https://alice@pod.example/alice/a",
  ])
    expect(isOwnStorage(url, f.session.storageUrl)).toBe(false);
});
it.each([
  "file",
  "folder",
])("resolves a foreign %s owner from a storage description and WebID profile", async (kind) => {
  const f = fixture(`<${ROOT}> <${OWNER}> <${WEBID}>.`);
  f.http.mockImplementation(async (url, init) => {
    if (init?.method === "HEAD")
      return new Response(null, { headers: { link: `<${DESCRIPTION}>; rel="other ${REL}"` } });
    if (url === DESCRIPTION) return rdf(`<${ROOT}> <${OWNER}> <${WEBID}>.`);
    if (url === WEBID) return rdf(`<${WEBID}> <${VCARD}> "Bob"; <${FOAF}> "Robert".`);
    return new Response(null, { status: 404 });
  });
  expect(await resolveItemOwner(kind === "file" ? ITEM : `${ROOT}public/`, f.session)).toEqual({
    webId: WEBID,
    label: "Bob",
  });
});
it("uses pim:storage only when it contains the opened item, ignoring malformed sibling storages", async () => {
  const f = fixture(
    `<https://id.example/wrong> <${STORAGE}> <https://other.example/>. <${WEBID}> <${STORAGE}> "bad", <${ROOT}>; <${FOAF}> "Bob".`,
  );
  expect(await resolveItemOwner(ITEM, f.session)).toEqual({ webId: WEBID, label: "Bob" });
});
it.each([
  "",
  `<${WEBID}> <${FOAF}> <https://bad.example/>.`,
])("keeps a discovered WebID if its profile has no usable name (%s)", async (profile) => {
  const f = fixture(`<${ROOT}> <${OWNER}> <${WEBID}>.`);
  const http = f.http.getMockImplementation();
  f.http.mockImplementation(async (url, init) =>
    url === WEBID ? rdf(profile) : (http as typeof fetch)(url, init),
  );
  expect(await resolveItemOwner(ITEM, f.session)).toEqual({ webId: WEBID, label: WEBID });
});
it("falls back from a malformed vcard name to foaf:name", async () => {
  const f = fixture(
    `<${WEBID}> <${STORAGE}> <${ROOT}>; <${VCARD}> <https://bad.example/>; <${FOAF}> "Bob".`,
  );
  expect(await resolveItemOwner(ITEM, f.session)).toEqual({ webId: WEBID, label: "Bob" });
});
it("uses solid:owner on the storage root when HEAD or storage descriptions are unavailable", async () => {
  const f = fixture("");
  f.http.mockImplementation(async (url, init) => {
    if (init?.method === "HEAD") throw new Error("HEAD unavailable");
    if (url === ROOT)
      return rdf(
        `<${ROOT}> <${OWNER}> "invalid", <urn:invalid>, <${WEBID}>. <${WEBID}> <${FOAF}> "Bob".`,
      );
    return new Response(null, { status: 403 });
  });
  expect(await resolveItemOwner(ITEM, f.session)).toEqual({ webId: WEBID, label: "Bob" });
});
it("follows ancestor description links and stops description cycles", async () => {
  const f = fixture("");
  f.http.mockImplementation(async (url, init) => {
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    if (url === `${ROOT}public/`) return rdf("", `<${DESCRIPTION}>; rel=${REL}`);
    if (url === DESCRIPTION) return rdf("", `<${ROOT}public/>; rel="${REL}"`);
    return rdf("");
  });
  expect(await resolveItemOwner(ITEM, f.session)).toBeUndefined();
  expect(f.http.mock.calls.filter(([url]) => url === DESCRIPTION)).toHaveLength(1);
});
it.each([
  "",
  '<other>; title="unrelated"',
  '<other>; rel="unrelated"',
  `<mailto:bad>; rel="${REL}"`,
  `<http://[bad>; rel="${REL}"`,
])("leaves ownership unknown for missing or unusable discovery (%s)", async (link) => {
  const f = fixture("", link);
  expect(await resolveItemOwner(ITEM, f.session)).toBeUndefined();
});
it("rejects owner assertions on a file or another storage and preserves valid fallback profile storage", async () => {
  const f = fixture(
    `<${ITEM}> <${OWNER}> <https://id.example/wrong>. <https://other.example/> <${OWNER}> <https://id.example/wrong>. <${ROOT}> <${OWNER}> "not an IRI". <${WEBID}> <${STORAGE}> <${ROOT}>.`,
  );
  expect(await resolveItemOwner(ITEM, f.session)).toEqual({ webId: WEBID, label: WEBID });
});
it("leaves ownership unknown after unreadable or malformed RDF", async () => {
  const f = fixture("not turtle");
  expect(await resolveItemOwner(ITEM, f.session)).toBeUndefined();
});
