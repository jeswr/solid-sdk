// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — missing linked index regression tests
// Ported Pod Docs regression tests.
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { ConcurrencyValidatorError } from "../../src/apps/docs/lib/model/errors.js";
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
import { mockFetch, privateIndexPolicy, turtleToStore } from "./helpers.js";

const WEBID = "https://alice.pod/profile/card#me";
const PROFILE_DOC = "https://alice.pod/profile/card";
const POD = "https://alice.pod/";
const PRIVATE_INDEX = "https://alice.pod/settings/privateTypeIndex.ttl";
const CONTAINER = "https://alice.pod/pod-docs/";

const REG: DesiredRegistration = { forClass: DOCUMENT_CLASS, container: CONTAINER };

it.each([
  [false, 'W/"profile"'],
  [true, 'W/"index"'],
  [false, undefined],
  [true, undefined],
] as const)("rejects unusable profile/index validators (linked: %s, ETag: %j)", async (linked, etag) => {
  const transport = mockFetch({
    [`GET ${WEBID}`]: {
      body: profileWith(linked ? { privateIndex: PRIVATE_INDEX } : {}),
      etag,
    },
    [`PUT ${PROFILE_DOC}`]: { etag: 'W/"profile-new"' },
    [`GET ${PRIVATE_INDEX}`]: { body: "", etag },
    [`PUT ${PRIVATE_INDEX}`]: { etag: 'W/"index-new"' },
    ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
  });
  await expect(
    ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl: transport.fetch,
    }),
  ).rejects.toBeInstanceOf(ConcurrencyValidatorError);
  const replacements = transport.calls.filter(
    (call) => call.method === "PUT" && !call.headers["if-none-match"],
  );
  expect(replacements).toEqual([]);
  expect(
    transport.calls.filter((call) => call.url === WEBID && call.method === "GET"),
  ).toHaveLength(1);
});

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
  it.each([
    201, 412,
  ])("repairs a missing linked index with create-only PUT (%s)", async (status) => {
    const linkedIndex = `${POD}preferences/documents.ttl`;
    const { fetch: transport, calls } = mockFetch({
      ...privateIndexPolicy(linkedIndex, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: linkedIndex }) },
      [`GET ${linkedIndex}`]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
          <> a solid:TypeIndex, solid:UnlistedDocument.
          <#other> a solid:TypeRegistration; solid:forClass <https://example.org/Other>.`,
        etag: '"fresh"',
      },
      [`PUT ${linkedIndex}`]: { status: 201 },
    });
    let reads = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url) === linkedIndex && (!init?.method || init.method === "GET") && reads++ === 0)
        return new Response(null, { status: 404 });
      const response = await transport(url, init);
      if (init?.method === "PUT" && new Headers(init.headers).has("if-none-match"))
        return new Response(null, { status });
      return response;
    };
    const result = await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl,
    });
    expect(result).toEqual({ indexUrl: linkedIndex, bootstrapped: true, added: 1 });
    expect(reads).toBe(2);
    const writes = calls.filter((call) => call.method === "PUT");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ url: linkedIndex, headers: { "if-none-match": "*" } });
    const created = new TypeIndexDocument(
      linkedIndex,
      turtleToStore(writes[0]?.body ?? "", linkedIndex),
      DataFactory,
    );
    expect([...created.types].sort()).toEqual([
      "http://www.w3.org/ns/solid/terms#TypeIndex",
      "http://www.w3.org/ns/solid/terms#UnlistedDocument",
    ]);
    expect(writes[1]?.headers["if-match"]).toBe('"fresh"');
    const registered = new TypeIndexDataset(
      turtleToStore(writes[1]?.body ?? "", linkedIndex),
      DataFactory,
    );
    expect(
      registered
        .all()
        .map((reg) => reg.forClass)
        .sort(),
    ).toEqual([DOCUMENT_CLASS, "https://example.org/Other"].sort());
    expect(
      calls.every(
        (call) =>
          call.url === WEBID || call.url === linkedIndex || call.url === `${linkedIndex}.acl`,
      ),
    ).toBe(true);
  });

  it.each([
    401,
    403,
    500,
    "offline",
  ] as const)("propagates linked index read failure %s without writing", async (status) => {
    const { fetch: transport, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }) },
      [`GET ${PRIVATE_INDEX}`]: { status: status === "offline" ? 500 : status },
    });
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url) === PRIVATE_INDEX && status === "offline") throw new Error("offline");
      return transport(url, init);
    };
    const result = ensureTypeRegistrations({
      webId: WEBID,
      podRoot: POD,
      registrations: [REG],
      fetchImpl,
    });
    if (status === "offline") await expect(result).rejects.toThrow("offline");
    else await expect(result).rejects.toMatchObject({ status });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("propagates permission failures when creating a missing linked index", async () => {
    const { fetch, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }) },
      [`PUT ${PRIVATE_INDEX}`]: { status: 403 },
    });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [REG],
        fetchImpl: fetch,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("bounds recovery if a linked index keeps disappearing", async () => {
    const { fetch, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }) },
      [`PUT ${PRIVATE_INDEX}`]: { status: 201 },
    });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: POD,
        registrations: [REG],
        fetchImpl: fetch,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(3);
    expect(
      calls.filter((call) => call.url === PRIVATE_INDEX && call.method === "GET"),
    ).toHaveLength(4);
  });

  it("bootstraps a private index, links it from the profile, and adds the registration", async () => {
    const { fetch, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({}), etag: '"p"' },
      [`PUT ${PRIVATE_INDEX}`]: { status: 201 },
      [`PUT ${PROFILE_DOC}`]: { status: 205 },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: '"i"',
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
    // Profile replacement uses its exact strong validator.
    const profilePut = calls.find((c) => c.method === "PUT" && c.url === PROFILE_DOC);
    expect(profilePut?.headers["if-match"]).toBe('"p"');
    // The bootstrap index PUT was create-only.
    const indexCreate = calls.find(
      (c) => c.method === "PUT" && c.url === PRIVATE_INDEX && c.headers["if-none-match"] === "*",
    );
    expect(indexCreate).toBeDefined();
  });

  it("adds to an existing private index without bootstrapping", async () => {
    const { fetch, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({ privateIndex: PRIVATE_INDEX }), etag: 'W/"p"' },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: '"i"',
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
    // Index replacement uses its exact strong validator.
    const put = calls.find((c) => c.method === "PUT" && c.url === PRIVATE_INDEX);
    expect(put?.headers["if-match"]).toBe('"i"');
    // No profile write happened.
    expect(calls.some((c) => c.method === "PUT" && c.url === PROFILE_DOC)).toBe(false);
  });

  it("bootstraps private storage even when a public index exists", async () => {
    const publicIndex = "https://alice.pod/public.ttl";
    const { fetch, calls } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
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
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
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
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${WEBID}`]: { body: profileWith({}), etag: '"p"' },
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
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
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
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${Public}`]: {
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .`,
      },
      [`GET ${PRIVATE_INDEX}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <#r> a solid:TypeRegistration ; solid:forClass <https://other/Class> ; solid:instance <https://alice.pod/x.ttl> .",
      },
    });
    const locs = await discoverRegistrations(WEBID, profile, fetch, POD);
    expect(locs).toHaveLength(2);
    expect(locs.map((l) => l.forClass).sort()).toEqual(
      [DOCUMENT_CLASS, "https://other/Class"].sort(),
    );
  });

  it("treats a 404/403 index as contributing nothing", async () => {
    const profile = turtleToStore(profileWith({ privateIndex: PRIVATE_INDEX }), PROFILE_DOC);
    const { fetch } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
    }); // private index → 404
    await expect(discoverRegistrations(WEBID, profile, fetch, POD)).resolves.toEqual([]);
  });

  it("propagates a non-404/403 index read failure", async () => {
    const profile = turtleToStore(profileWith({ privateIndex: PRIVATE_INDEX }), PROFILE_DOC);
    const { fetch } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
      [`GET ${PRIVATE_INDEX}`]: { status: 500, body: "err" },
    });
    await expect(discoverRegistrations(WEBID, profile, fetch, POD)).rejects.toMatchObject({
      status: 500,
    });
  });

  it("returns nothing when the profile advertises no indexes", async () => {
    const profile = turtleToStore(profileWith({}), PROFILE_DOC);
    const { fetch } = mockFetch({
      ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
    });
    await expect(discoverRegistrations(WEBID, profile, fetch, POD)).resolves.toEqual([]);
  });
});

it("re-reads and reapplies registrations on 412 without losing concurrent entries", async () => {
  const { fetch: initial } = mockFetch({
    ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
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
    if (String(url) === PRIVATE_INDEX && init?.method !== "HEAD" && puts === 1) {
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
    ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
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

it.each([false, true])("recovers profile linking conflicts (new link: %s)", async (linked) => {
  const concurrentIndex = `${POD}settings/concurrent.ttl`;
  let profiles = 0;
  let profilePuts = 0;
  const writes: { url: string; body: string; etag: string | null }[] = [];
  const { fetch: transport } = mockFetch({
    ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
    ...privateIndexPolicy(concurrentIndex, WEBID),
    [`PUT ${PRIVATE_INDEX}`]: { status: 201 },
    [`GET ${PRIVATE_INDEX}`]: { body: "", etag: '"index"' },
    [`GET ${concurrentIndex}`]: { body: "", etag: '"concurrent"' },
    [`PUT ${concurrentIndex}`]: { status: 201 },
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === WEBID) {
      profiles++;
      return new Response(
        profiles > 1
          ? `${profileWith(linked ? { privateIndex: concurrentIndex } : {})}\n<${WEBID}> <https://example.org/note> "remote".`
          : profileWith({}),
        { headers: { "content-type": "text/turtle", etag: profiles === 1 ? '"old"' : '"fresh"' } },
      );
    }
    if (String(url) === PROFILE_DOC && init?.method === "PUT") {
      writes.push({
        url: String(url),
        body: String(init.body),
        etag: new Headers(init.headers).get("if-match"),
      });
      return new Response(null, { status: ++profilePuts === 1 ? 412 : 205 });
    }
    return transport(url, init);
  };
  const result = await ensureTypeRegistrations({
    webId: WEBID,
    podRoot: POD,
    registrations: [REG],
    fetchImpl,
  });
  expect(result.indexUrl).toBe(linked ? concurrentIndex : PRIVATE_INDEX);
  expect(profiles).toBe(2);
  expect(profilePuts).toBe(linked ? 1 : 2);
  if (!linked)
    expect(writes[1]).toMatchObject({ etag: '"fresh"', body: expect.stringContaining('"remote"') });
});

it.each([412, 403])("bounds or propagates profile linking failures (%s)", async (status) => {
  const { fetch, calls } = mockFetch({
    ...privateIndexPolicy(PRIVATE_INDEX, WEBID),
    [`GET ${WEBID}`]: { body: profileWith({}), etag: '"profile"' },
    [`PUT ${PRIVATE_INDEX}`]: { status: 412 },
    [`PUT ${PROFILE_DOC}`]: { status },
  });
  await expect(
    ensureTypeRegistrations({ webId: WEBID, podRoot: POD, registrations: [REG], fetchImpl: fetch }),
  ).rejects.toMatchObject({ status });
  const writes = calls.filter((call) => call.url === PROFILE_DOC);
  expect(writes).toHaveLength(status === 412 ? 4 : 1);
  expect(writes.every((call) => call.headers["if-match"] === '"profile"')).toBe(true);
});
