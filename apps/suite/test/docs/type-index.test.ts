// AUTHORED-BY Codex GPT-6.1-Sol
// Ported Pod Docs regression tests.
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type DesiredRegistration,
  discoverRegistrations,
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeIndexDocument,
  TypeRegistration,
  typeIndexLinks,
} from "../../src/apps/docs/lib/model/type-index.js";
import { DOCUMENT_CLASS } from "../../src/apps/docs/lib/model/vocab.js";
import { mockFetch, turtleToStore } from "./helpers.js";

const WEBID = "https://alice.pod/profile/card#me";
const PROFILE_DOC = "https://alice.pod/profile/card";
const POD = "https://alice.pod/";
const PRIVATE_INDEX = "https://alice.pod/settings/privateTypeIndex.ttl";
const CONTAINER = "https://alice.pod/pod-docs/";

const REG: DesiredRegistration = { forClass: DOCUMENT_CLASS, container: CONTAINER };

function profileWith(links: { privateIndex?: string; publicIndex?: string }): string {
  const lines = [
    "@prefix solid: <http://www.w3.org/ns/solid/terms#> .",
    `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person> .`,
  ];
  if (links.privateIndex) lines.push(`<${WEBID}> solid:privateTypeIndex <${links.privateIndex}> .`);
  if (links.publicIndex) lines.push(`<${WEBID}> solid:publicTypeIndex <${links.publicIndex}> .`);
  return lines.join("\n");
}

describe("typed wrappers", () => {
  it("TypeRegistration reads/writes forClass, instance and instanceContainer", () => {
    const store = new Store();
    const reg = new TypeRegistration("https://i/#r", store, DataFactory);
    reg.markRegistration();
    reg.forClass = DOCUMENT_CLASS;
    reg.instanceContainer = CONTAINER;
    reg.instance = "https://alice.pod/pod-docs/one.ttl";
    expect(reg.forClass).toBe(DOCUMENT_CLASS);
    expect(reg.instanceContainer).toBe(CONTAINER);
    expect(reg.instance).toBe("https://alice.pod/pod-docs/one.ttl");
    expect(reg.types.has("http://www.w3.org/ns/solid/terms#TypeRegistration")).toBe(true);
  });

  it("ProfileTypeIndexAnchor reads both index links and writes the private one", () => {
    const store = turtleToStore(
      profileWith({ publicIndex: "https://alice.pod/public.ttl" }),
      PROFILE_DOC,
    );
    const anchor = new ProfileTypeIndexAnchor(WEBID, store, DataFactory);
    expect(anchor.publicIndex).toBe("https://alice.pod/public.ttl");
    expect(anchor.privateIndex).toBeUndefined();
    anchor.privateIndex = PRIVATE_INDEX;
    expect(anchor.privateIndex).toBe(PRIVATE_INDEX);
  });

  it("TypeIndexDocument stamps the unlisted-index types", () => {
    const store = new Store();
    new TypeIndexDocument(PRIVATE_INDEX, store, DataFactory).markUnlistedIndex();
    const doc = new TypeIndexDocument(PRIVATE_INDEX, store, DataFactory);
    expect(doc.types.has("http://www.w3.org/ns/solid/terms#TypeIndex")).toBe(true);
    expect(doc.types.has("http://www.w3.org/ns/solid/terms#UnlistedDocument")).toBe(true);
  });

  it("TypeIndexDataset.all / locate read the registrations; a reg with no forClass is skipped", () => {
    const ttl = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <#a> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
      <#b> a solid:TypeRegistration ; solid:instanceContainer <https://alice.pod/orphan/> .
    `;
    const ds = new TypeIndexDataset(turtleToStore(ttl, PRIVATE_INDEX), DataFactory);
    expect(ds.all()).toHaveLength(1);
    expect(ds.locate(DOCUMENT_CLASS)).toEqual([
      { forClass: DOCUMENT_CLASS, instance: undefined, container: CONTAINER },
    ]);
    expect(ds.locate("https://nope/")).toEqual([]);
  });

  it("typeIndexLinks reads both links off the profile subject", () => {
    const store = turtleToStore(
      profileWith({ privateIndex: PRIVATE_INDEX, publicIndex: "https://alice.pod/pub.ttl" }),
      PROFILE_DOC,
    );
    expect(typeIndexLinks(WEBID, store)).toEqual({
      privateIndex: PRIVATE_INDEX,
      publicIndex: "https://alice.pod/pub.ttl",
    });
  });
});

describe("ensureTypeRegistrations", () => {
  it("bootstraps a private index, links it from the profile, and adds the registration", async () => {
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({}), etag: 'W/"p"' },
      [`PUT ${PRIVATE_INDEX}`]: { status: 201 },
      [`PUT ${PROFILE_DOC}`]: { status: 205 },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: 'W/"i"',
      },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result.bootstrapped).toBe(true);
    expect(result.indexUrl).toBe(PRIVATE_INDEX);
    expect(result.added).toBe(1);
    // The profile PUT carried the read ETag as If-Match.
    const profilePut = calls.find((c) => c.method === "PUT" && c.url === PROFILE_DOC);
    expect(profilePut?.headers["if-match"]).toBe('W/"p"');
    // The bootstrap index PUT was create-only.
    const indexCreate = calls.find(
      (c) => c.method === "PUT" && c.url === PRIVATE_INDEX && c.headers["if-none-match"] === "*",
    );
    expect(indexCreate).toBeDefined();
  });

  it("adds to an existing private index without bootstrapping", async () => {
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }), etag: 'W/"p"' },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: 'W/"i"',
      },
      [`PUT ${PRIVATE_INDEX}`]: { status: 205 },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result.bootstrapped).toBe(false);
    expect(result.added).toBe(1);
    // The index write carried the read ETag.
    const put = calls.find((c) => c.method === "PUT" && c.url === PRIVATE_INDEX);
    expect(put?.headers["if-match"]).toBe('W/"i"');
    // No profile write happened.
    expect(calls.some((c) => c.method === "PUT" && c.url === PROFILE_DOC)).toBe(false);
  });

  it("bootstraps private storage even when a public index exists", async () => {
    const publicIndex = "https://alice.pod/public.ttl";
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ publicIndex }), etag: '"p"' },
      [`PUT ${PRIVATE_INDEX}`]: { status: 201 },
      [`PUT ${PROFILE_DOC}`]: { status: 205 },
      [`GET ${PRIVATE_INDEX}`]: { body: "", etag: '"i"' },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result).toEqual({ indexUrl: PRIVATE_INDEX, bootstrapped: true, added: 1 });
    expect(calls.some((call) => call.url === publicIndex)).toBe(false);
  });

  it("is idempotent — an already-present registration adds nothing and writes nothing", async () => {
    const existingIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
    `;
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }), etag: 'W/"p"' },
      [`GET ${PRIVATE_INDEX}`]: { body: existingIndex, etag: 'W/"i"' },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result.added).toBe(0);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("tolerates a 412 'already exists' when bootstrapping the index document", async () => {
    // The create-only PUT collides (412 — an out-of-band index already exists);
    // the bootstrap path then links it and reuses it. The fetched index already
    // carries the registration, so no second PUT to the index is attempted (the
    // mock keys on method+url, so a single PRIVATE_INDEX PUT response suffices).
    const existingIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
    `;
    const { fetch } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({}), etag: 'W/"p"' },
      [`PUT ${PRIVATE_INDEX}`]: { status: 412 }, // create-only collision
      [`PUT ${PROFILE_DOC}`]: { status: 205 },
      [`GET ${PRIVATE_INDEX}`]: { body: existingIndex, etag: 'W/"i"' },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result.bootstrapped).toBe(true);
    expect(result.added).toBe(0);
  });

  it("propagates a non-412 failure while creating the index document", async () => {
    const { fetch } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({}), etag: 'W/"p"' },
      [`PUT ${PRIVATE_INDEX}`]: { status: 500 },
    });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [REG],
        fetchImpl: fetch,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("discoverRegistrations", () => {
  it("collects locations across both indexes", async () => {
    const Public = "https://alice.pod/pub.ttl";
    const profile = turtleToStore(
      profileWith({ privateIndex: PRIVATE_INDEX, publicIndex: Public }),
      PROFILE_DOC,
    );
    const { fetch } = mockFetch({
      [`GET ${Public}`]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .`,
      },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <https://other/Class> ; solid:instance <https://alice.pod/x.ttl> .",
      },
    });
    const locs = await discoverRegistrations(WEBID, profile, fetch);
    expect(locs).toHaveLength(2);
    expect(locs.map((l) => l.forClass).sort()).toEqual(
      [DOCUMENT_CLASS, "https://other/Class"].sort(),
    );
  });

  it("treats a 404/403 index as contributing nothing", async () => {
    const profile = turtleToStore(profileWith({ privateIndex: PRIVATE_INDEX }), PROFILE_DOC);
    const { fetch } = mockFetch({}); // private index → 404
    await expect(discoverRegistrations(WEBID, profile, fetch)).resolves.toEqual([]);
  });

  it("propagates a non-404/403 index read failure", async () => {
    const profile = turtleToStore(profileWith({ privateIndex: PRIVATE_INDEX }), PROFILE_DOC);
    const { fetch } = mockFetch({ [`GET ${PRIVATE_INDEX}`]: { status: 500, body: "err" } });
    await expect(discoverRegistrations(WEBID, profile, fetch)).rejects.toMatchObject({
      status: 500,
    });
  });

  it("returns nothing when the profile advertises no indexes", async () => {
    const profile = turtleToStore(profileWith({}), PROFILE_DOC);
    const { fetch } = mockFetch({});
    await expect(discoverRegistrations(WEBID, profile, fetch)).resolves.toEqual([]);
  });
});

it("re-reads and reapplies registrations on 412 without losing concurrent entries", async () => {
  const { fetch: initial } = mockFetch({
    [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }) },
    [`GET ${PRIVATE_INDEX}`]: { body: "", etag: '"old"' },
  });
  let puts = 0;
  const writes: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === PRIVATE_INDEX && init?.method === "PUT") {
      writes.push(String(init.body));
      return new Response(null, { status: ++puts === 1 ? 412 : 205 });
    }
    if (String(url) === PRIVATE_INDEX && puts === 1) {
      return new Response(
        `<#remote> a <http://www.w3.org/ns/solid/terms#TypeRegistration>; <http://www.w3.org/ns/solid/terms#forClass> <https://example.org/Other>.`,
        { headers: { "content-type": "text/turtle", etag: '"new"' } },
      );
    }
    return initial(url, init);
  };
  expect(
    await ensureTypeRegistrations({ webId: WEBID, podRoot: POD, registrations: [REG], fetchImpl }),
  ).toMatchObject({ added: 1 });
  expect(writes).toHaveLength(2);
  expect(writes[0]).not.toContain("https://example.org/Other");
  expect(writes[1]).toContain("https://example.org/Other");
});

it("bounds repeated Type Index conflicts", async () => {
  const { fetch: reads } = mockFetch({
    [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }) },
    [`GET ${PRIVATE_INDEX}`]: { body: "", etag: '"old"' },
  });
  let writes = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    if (init?.method === "PUT") {
      writes++;
      return new Response(null, { status: 412 });
    }
    return reads(url, init);
  };
  await expect(
    ensureTypeRegistrations({ webId: WEBID, podRoot: POD, registrations: [REG], fetchImpl }),
  ).rejects.toMatchObject({ status: 412 });
  expect(writes).toBe(4);
});
