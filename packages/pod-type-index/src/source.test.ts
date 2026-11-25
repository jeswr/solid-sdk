// AUTHORED-BY Claude Sonnet 5.5
import type { Features } from "@jeswr/storage-capabilities";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import { createTypeIndex } from "./index.js";

const ROOT = "https://pod.example/alice/";
const WEBID = `${ROOT}profile/card#me`;
const CARD = `${ROOT}profile/card`;
const PREFS = `${ROOT}settings/prefs.ttl`;
const PRIVATE = `${ROOT}settings/privateTypeIndex.ttl`;
const PUBLIC = `${ROOT}settings/publicTypeIndex.ttl`;
const CLASS = `${NS.POD_DOCS}Document`;
const PRIVATE_DIR = `${ROOT}private-media/`;
const HOSTILE_DIR = `${ROOT}public-planted/`;
const prefix = `@prefix solid: <${NS.SOLID}>. @prefix pim: <${NS.PIM}>. `;
const reg = (id: string, target: string, cls = CLASS) =>
  `<#${id}> a solid:TypeRegistration; solid:forClass <${cls}>; solid:instanceContainer <${target}>.`;

async function put(storage: StorageClient, url: string, body: string) {
  await storage.write(url, prefix + body, { contentType: "text/turtle", ifMatch: "*" });
}

/** Private index (via preferences) and public index (via profile), each with its own entries. */
async function setup(privateBody: string, publicBody: string) {
  const storage = createMemoryStorage({ root: ROOT });
  await put(
    storage,
    CARD,
    `<${WEBID}> pim:preferencesFile <${PREFS}>; solid:publicTypeIndex <${PUBLIC}>.`,
  );
  await put(storage, PREFS, `<${WEBID}> solid:privateTypeIndex <${PRIVATE}>.`);
  await put(storage, PRIVATE, privateBody);
  await put(storage, PUBLIC, publicBody);
  const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
  return { storage, index };
}

const requested = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([url]) => url);

describe("registration source (Solid)", () => {
  it("labels every registration and orders private before public, never merging sources", async () => {
    const { storage, index } = await setup(
      reg("p", PRIVATE_DIR) + reg("shared", `${ROOT}shared/`),
      reg("pub", HOSTILE_DIR) + reg("shared", `${ROOT}shared/`),
    );
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: PRIVATE_DIR, source: "private" },
      { location: `${ROOT}shared/`, source: "private" },
      { location: HOSTILE_DIR, source: "public" },
      { location: `${ROOT}shared/`, source: "public" },
    ]);
    expect(requested(read)).toEqual([CARD, PREFS, PRIVATE, PUBLIC]);
    const all = await index.findAllRegistrations([CLASS, "urn:absent"]);
    expect(all.get("urn:absent")).toEqual([]);
    expect(all.get(CLASS)).toHaveLength(4);
    // The legacy string shape de-duplicates by location and keeps the same order.
    expect(await index.find(CLASS)).toEqual([PRIVATE_DIR, `${ROOT}shared/`, HOSTILE_DIR]);
    expect((await index.findAll([CLASS])).get(CLASS)).toEqual(await index.find(CLASS));
  });

  it("restricted to private never reads the public index; a hostile public entry cannot shadow", async () => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), reg("evil", HOSTILE_DIR));
    const read = vi.spyOn(storage, "readRdf");
    const fetched = vi.spyOn(storage, "read");
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([
      { location: PRIVATE_DIR, source: "private" },
    ]);
    expect(await index.find(CLASS, { sources: ["private"] })).toEqual([PRIVATE_DIR]);
    expect(requested(read)).not.toContain(PUBLIC);
    expect(requested(read)).toEqual([CARD, PREFS, PRIVATE, CARD, PREFS, PRIVATE]);
    expect(requested(fetched)).not.toContain(PUBLIC);
    // A location planted publicly is never reported when only private is requested.
    const planted = await setup("", reg("evil", PRIVATE_DIR));
    expect(await planted.index.find(CLASS, { sources: ["private"] })).toEqual([]);
    expect(await planted.index.findRegistrations(CLASS)).toEqual([
      { location: PRIVATE_DIR, source: "public" },
    ]);
  });

  it("restricted to public reads neither preferences nor the private index", async () => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), reg("pub", HOSTILE_DIR));
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.findAllRegistrations([CLASS], { sources: ["public"] })).toEqual(
      new Map([[CLASS, [{ location: HOSTILE_DIR, source: "public" }]]]),
    );
    expect(requested(read)).toEqual([CARD, PUBLIC]);
  });

  it("makes no request at all when no Solid source is requested", async () => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), reg("pub", HOSTILE_DIR));
    const read = vi.spyOn(storage, "readRdf");
    for (const sources of [[], ["lws-search"]] as const) {
      expect(await index.find(CLASS, { sources })).toEqual([]);
      expect(await index.findAllRegistrations([CLASS], { sources })).toEqual(
        new Map([[CLASS, []]]),
      );
    }
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    "private",
    ["private", "nope"],
    [["private"]],
    { 0: "private", length: 1 },
    null,
    // biome-ignore lint/suspicious/noSparseArray: a hole must be rejected
    [, "private"],
  ])("rejects malformed sources %j before any I/O", async (sources) => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), "");
    const read = vi.spyOn(storage, "readRdf");
    const options = { sources } as never;
    await expect(index.find(CLASS, options)).rejects.toThrow(TypeError);
    await expect(index.findAllRegistrations([CLASS], options)).rejects.toThrow(
      "Invalid type index sources",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["an array", ["private"]],
    ["a string", "private"],
    ["null", null],
    ["a number", 1],
    ["a typo key", { source: ["private"] }],
    ["an extra key", { sources: ["private"], extra: true }],
    ["a class instance", new (class Options {})()],
    ["a symbol key", { [Symbol("x")]: 1 }],
  ])("rejects options that are %s before any I/O", async (_name, options) => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), reg("evil", HOSTILE_DIR));
    const read = vi.spyOn(storage, "readRdf");
    await expect(index.find(CLASS, options as never)).rejects.toThrow("Invalid type index options");
    await expect(index.findAll([CLASS], options as never)).rejects.toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a null-prototype options object and an explicit undefined sources", async () => {
    const { index } = await setup(reg("p", PRIVATE_DIR), reg("pub", HOSTILE_DIR));
    const bare = Object.assign(Object.create(null), { sources: ["private"] });
    expect(await index.find(CLASS, bare)).toEqual([PRIVATE_DIR]);
    expect(await index.find(CLASS, { sources: undefined })).toEqual([PRIVATE_DIR, HOSTILE_DIR]);
    expect(await index.find(CLASS, {})).toEqual([PRIVATE_DIR, HOSTILE_DIR]);
  });

  it("labels legacy direct profile pointers private and honours restriction", async () => {
    const storage = createMemoryStorage({ root: ROOT });
    await put(
      storage,
      CARD,
      `<${WEBID}> solid:privateTypeIndex <${PRIVATE}>; solid:publicTypeIndex <${PUBLIC}>.`,
    );
    await put(storage, PRIVATE, reg("p", PRIVATE_DIR));
    await put(storage, PUBLIC, reg("pub", HOSTILE_DIR));
    const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: PRIVATE_DIR, source: "private" },
      { location: HOSTILE_DIR, source: "public" },
    ]);
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([
      { location: PRIVATE_DIR, source: "private" },
    ]);
    expect(requested(read)).toEqual([CARD, PRIVATE]);
  });

  it.each([
    [
      "a legacy profile pointer",
      (url: string) => `<${WEBID}> solid:privateTypeIndex <${url}>.`,
      "",
    ],
    [
      "a legacy pointer with a fragment",
      (url: string) => `<${WEBID}> solid:privateTypeIndex <${url}#x>.`,
      "",
    ],
    ["a preferences pointer", () => "", `<${WEBID}> solid:privateTypeIndex <${PUBLIC}>.`],
    [
      "a preferences pointer with a fragment",
      () => "",
      `<${WEBID}> solid:privateTypeIndex <${PUBLIC}#x>.`,
    ],
  ])("a document also listed publicly is public, never private (%s)", async (_name, card, prefs) => {
    const storage = createMemoryStorage({ root: ROOT });
    await put(
      storage,
      CARD,
      `<${WEBID}> solid:publicTypeIndex <${PUBLIC}>; pim:preferencesFile <${PREFS}>. ${card(PUBLIC)}`,
    );
    await put(storage, PREFS, prefs);
    await put(storage, PUBLIC, reg("evil", HOSTILE_DIR));
    const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
    const read = vi.spyOn(storage, "readRdf");
    const expected = [{ location: HOSTILE_DIR, source: "public" }];
    // The label never depends on `sources`.
    expect(await index.findRegistrations(CLASS)).toEqual(expected);
    expect(await index.findRegistrations(CLASS, { sources: ["public"] })).toEqual(expected);
    expect(await index.findRegistrations(CLASS, { sources: ["public", "private"] })).toEqual(
      expected,
    );
    read.mockClear();
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([]);
    expect(await index.find(CLASS, { sources: ["private"] })).toEqual([]);
    expect(requested(read)).not.toContain(PUBLIC);
  });

  it("a private-only lookup succeeds while the public index is unreadable", async () => {
    const { storage, index } = await setup(reg("p", PRIVATE_DIR), reg("pub", HOSTILE_DIR));
    const original = storage.readRdf.bind(storage);
    vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
      if (String(url) === PUBLIC)
        throw new StorageError("forbidden", { url: PUBLIC, status: 403, method: "GET" });
      return original(url, options);
    });
    expect(await index.find(CLASS, { sources: ["private"] })).toEqual([PRIVATE_DIR]);
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("missing preferences or private index under a private restriction yield nothing", async () => {
    const storage = createMemoryStorage({ root: ROOT });
    await put(
      storage,
      CARD,
      `<${WEBID}> pim:preferencesFile <${PREFS}>; solid:publicTypeIndex <${PUBLIC}>.`,
    );
    await put(storage, PUBLIC, reg("evil", HOSTILE_DIR));
    const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([]);
    await put(storage, PREFS, `<${WEBID}> solid:privateTypeIndex <${PRIVATE}>.`);
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([]);
  });

  it("handles legacy class aliases and registrations naming both instance and container", async () => {
    const { index } = await setup(
      `<#r> a solid:TypeRegistration; solid:forClass <https://w3id.org/jeswr/pod-docs#Document>;
        solid:instance <${ROOT}one.ttl>; solid:instanceContainer <${PRIVATE_DIR}>.`,
      "",
    );
    expect(await index.findRegistrations(CLASS, { sources: ["private"] })).toEqual([
      { location: `${ROOT}one.ttl`, source: "private" },
      { location: PRIVATE_DIR, source: "private" },
    ]);
  });

  it("caps distinct locations, not (source, location) pairs, for find and findAll", async () => {
    const many = (prefixPath: string, count: number) =>
      Array.from({ length: count }, (_, i) => reg(`r${i}`, `${ROOT}${prefixPath}${i}/`)).join("");
    // 6,000 locations asserted by both indexes: 12,000 pairs but only 6,000 distinct locations.
    const body = many("loc", 6000);
    const { index } = await setup(body, body);
    expect(await index.find(CLASS)).toHaveLength(6000);
    expect((await index.findAll([CLASS])).get(CLASS)).toHaveLength(6000);
    expect(await index.findRegistrations(CLASS)).toHaveLength(12000);
    // Over 10,000 distinct locations still fails closed.
    const over = await setup(many("a", 5001), many("b", 5000));
    await expect(over.index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
  }, 60_000);

  it("returns the same location twice when both indexes assert it, once per source", async () => {
    const { index } = await setup(reg("a", PRIVATE_DIR), reg("b", PRIVATE_DIR));
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: PRIVATE_DIR, source: "private" },
      { location: PRIVATE_DIR, source: "public" },
    ]);
    expect(await index.findRegistrations(CLASS, { sources: ["public", "private"] })).toHaveLength(
      2,
    );
  });

  it("registrations written by register carry the matching source", async () => {
    const storage = createMemoryStorage({ root: ROOT });
    await put(storage, CARD, `<${WEBID}> <${NS.FOAF}name> "Alice".`);
    const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
    await index.register(CLASS, { container: PRIVATE_DIR });
    await index.register(CLASS, { container: HOSTILE_DIR }, { index: "public" });
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: PRIVATE_DIR, source: "private" },
      { location: HOSTILE_DIR, source: "public" },
    ]);
  });
});

describe("registration source (LWS)", () => {
  const LwsRoot = "https://lws.example/alice/";
  const Search = `${LwsRoot}search`;
  function setupLws() {
    const storage = createMemoryStorage({ protocol: "lws", root: LwsRoot });
    const features: Features = {
      ...storage.features,
      typeIndex: {
        state: "available",
        evidence: "fixture",
        detail: { mode: "server", searchEndpoint: Search, indexEndpoint: `${LwsRoot}types` },
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            type: "ContainerPage",
            items: [{ id: `${LwsRoot}a`, type: CLASS }],
          }),
          { headers: { "content-type": "application/lws+json" } },
        ),
    );
    const index = createTypeIndex({ storage, features, profile: "https://id.example/#me", fetch });
    return { index, fetch };
  }

  it('labels search results "lws-search" and shares the legacy shape', async () => {
    const { index, fetch } = setupLws();
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: `${LwsRoot}a`, source: "lws-search" },
    ]);
    expect(await index.findRegistrations(CLASS, { sources: ["lws-search"] })).toHaveLength(1);
    expect(await index.find(CLASS)).toEqual([`${LwsRoot}a`]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["private only", ["private"]],
    ["public only", ["public"]],
    ["empty", []],
  ] as const)("excluding the search service (%s) sends no request", async (_name, sources) => {
    const { index, fetch } = setupLws();
    expect(await index.findAllRegistrations([CLASS], { sources })).toEqual(new Map([[CLASS, []]]));
    expect(await index.find(CLASS, { sources })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('labels every page of a multi-page search "lws-search"', async () => {
    const storage = createMemoryStorage({ protocol: "lws", root: LwsRoot });
    const next = await storage.create(
      LwsRoot,
      JSON.stringify({
        type: "ContainerPage",
        items: [{ id: `${LwsRoot}b`, type: CLASS }],
      }),
      { name: "next", contentType: "application/lws+json" },
    );
    const features: Features = {
      ...storage.features,
      typeIndex: {
        state: "available",
        evidence: "fixture",
        detail: { mode: "server", searchEndpoint: Search, indexEndpoint: `${LwsRoot}types` },
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ type: "ContainerPage", items: [{ id: `${LwsRoot}a`, type: CLASS }] }),
          {
            headers: {
              "content-type": "application/lws+json",
              link: `<${next.url}>; rel="next"`,
            },
          },
        ),
    );
    const index = createTypeIndex({ storage, features, profile: "https://id.example/#me", fetch });
    expect(await index.findRegistrations(CLASS)).toEqual([
      { location: `${LwsRoot}a`, source: "lws-search" },
      { location: `${LwsRoot}b`, source: "lws-search" },
    ]);
  });
});
