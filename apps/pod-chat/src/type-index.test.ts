// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { mockFetch, turtleToStore } from "./test-helpers.js";
import {
  type DesiredRegistration,
  discoverRegistrations,
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeIndexDocument,
  TypeRegistration,
  typeIndexLinks,
} from "./type-index.js";
import { CHAT_ROOM_CLASS } from "./vocab.js";

const WEBID = "https://alice.pod/profile/card#me";
const PROFILE_DOC = "https://alice.pod/profile/card";
const POD = "https://alice.pod/";
const PRIVATE_INDEX = "https://alice.pod/settings/privateTypeIndex.ttl";
const CONTAINER = "https://alice.pod/pod-chat/rooms/";

const REG: DesiredRegistration = { forClass: CHAT_ROOM_CLASS, container: CONTAINER };

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
    reg.forClass = CHAT_ROOM_CLASS;
    reg.instanceContainer = CONTAINER;
    reg.instance = "https://alice.pod/pod-chat/rooms/one.ttl";
    expect(reg.forClass).toBe(CHAT_ROOM_CLASS);
    expect(reg.instanceContainer).toBe(CONTAINER);
    expect(reg.instance).toBe("https://alice.pod/pod-chat/rooms/one.ttl");
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
      <#a> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
      <#b> a solid:TypeRegistration ; solid:instanceContainer <https://alice.pod/orphan/> .
    `;
    const ds = new TypeIndexDataset(turtleToStore(ttl, PRIVATE_INDEX), DataFactory);
    expect(ds.all()).toHaveLength(1);
    expect(ds.locate(CHAT_ROOM_CLASS)).toEqual([
      { forClass: CHAT_ROOM_CLASS, instance: undefined, container: CONTAINER },
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

  it("falls back to the public index when no private index is linked", async () => {
    const Public = "https://alice.pod/settings/publicTypeIndex.ttl";
    const { fetch } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ publicIndex: Public }), etag: 'W/"p"' },
      [`GET ${Public}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: 'W/"i"',
      },
      [`PUT ${Public}`]: { status: 205 },
    });
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: fetch,
    });
    expect(result.indexUrl).toBe(Public);
    expect(result.bootstrapped).toBe(false);
    expect(result.added).toBe(1);
  });

  it("is idempotent — an already-present registration adds nothing and writes nothing", async () => {
    const existingIndex = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
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
      <#reg> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
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

  it("recovers from an advertised-but-missing index (404) by bootstrapping a fresh one", async () => {
    // The profile advertises a private index, but that document is gone (404 —
    // a stale or half-created profile). ensureTypeRegistrations must bootstrap a
    // fresh private index rather than propagating the 404.
    const Stale = "https://alice.pod/settings/stale.ttl";
    const { fetch, calls } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: Stale }), etag: 'W/"p"' },
      // GET Stale → 404 (mock default) → recoverable
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
    // The freshly-bootstrapped index was re-linked from the profile.
    expect(calls.some((c) => c.method === "PUT" && c.url === PROFILE_DOC)).toBe(true);
  });

  it("propagates a non-404 failure while reading the advertised index", async () => {
    const { fetch } = mockFetch({
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }), etag: 'W/"p"' },
      [`GET ${PRIVATE_INDEX}`]: { status: 500, body: "err" },
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
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <${CHAT_ROOM_CLASS}> ; solid:instanceContainer <${CONTAINER}> .`,
      },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <https://other/Class> ; solid:instance <https://alice.pod/x.ttl> .",
      },
    });
    const locs = await discoverRegistrations(WEBID, profile, fetch);
    expect(locs).toHaveLength(2);
    expect(locs.map((l) => l.forClass).sort()).toEqual(
      [CHAT_ROOM_CLASS, "https://other/Class"].sort(),
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
