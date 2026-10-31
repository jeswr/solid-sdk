// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NS } from "@jeswr/suite-vocab";
import { Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTypeIndex } from "./index.js";
import { createMemoryStorage as testingMemory } from "./testing.js";

const ROOT = "https://pod.example/alice/";
const WEBID = `${ROOT}profile/card#me`;
const CARD = `${ROOT}profile/card`;
const CLASS = `${NS.POD_DOCS}Document`;
const LEGACY = "https://w3id.org/jeswr/pod-docs#Document";
const LOCATION = { container: `${ROOT}documents/` };
const IDX = `${ROOT}settings/privateTypeIndex.ttl`;
const PREF = `${ROOT}settings/prefs.ttl`;
const prefix = `@prefix solid: <${NS.SOLID}>. @prefix pim: <${NS.PIM}>. `;
const reg = (classIri = CLASS, target = LOCATION.container) =>
  `<#r> a solid:TypeRegistration; solid:forClass <${classIri}>; solid:instanceContainer <${target}>.`;
const fail = (code: ConstructorParameters<typeof StorageError>[0], status: number | null = null) =>
  new StorageError(code, { status, method: "GET", url: CARD });
async function put(storage: StorageClient, url: string, body: string, contentType = "text/turtle") {
  await storage.write(url, prefix + body, { contentType, ifMatch: "*" });
}
async function setup(card = "") {
  const storage = testingMemory({ root: ROOT });
  await put(storage, CARD, card);
  const index = createTypeIndex({ storage, features: storage.features, profile: WEBID });
  return { storage, index };
}
async function linkLegacy(storage: StorageClient, body = reg()) {
  await put(storage, CARD, `<${WEBID}> solid:privateTypeIndex <${IDX}>.`);
  await put(storage, IDX, body);
}

afterEach(() => vi.restoreAllMocks());

describe("Solid discovery and bootstrap adversarial cases", () => {
  it("exports the public memory fixture and makes no request for an empty batch", async () => {
    expect(testingMemory).toBe(createMemoryStorage);
    const { storage, index } = await setup();
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.findAll([])).toEqual(new Map());
    expect(read).not.toHaveBeenCalled();
    await expect(index.listClasses()).rejects.toMatchObject({ code: "unsupported" });
  });

  it("uses canonical and legacy registrations, tolerant multi-values and blank nodes", async () => {
    const { storage, index } = await setup();
    await linkLegacy(
      storage,
      `
      _:r a solid:TypeRegistration, "garbage"; solid:forClass <${LEGACY}>, "bad";
        solid:instance <${ROOT}one>, "bad", <https://foreign.example/secret>;
        solid:instanceContainer <${LOCATION.container}>, <javascript:alert(1)>.
      <#duplicate> a solid:TypeRegistration; solid:forClass <${CLASS}>; solid:instance <${ROOT}one>.
      <#other> a solid:TypeRegistration; solid:forClass <urn:other>; solid:instance <${ROOT}other>.
    `,
    );
    expect(await index.find(CLASS)).toEqual([`${ROOT}one`, LOCATION.container]);
    expect(await index.find(LEGACY)).toEqual([`${ROOT}one`, LOCATION.container]);
    await index.register(CLASS, LOCATION);
    const write = vi.spyOn(storage, "writeRdf");
    await index.register(CLASS, LOCATION);
    expect(write).not.toHaveBeenCalled();
  });

  it("shares duplicate document pointers across public/private/preferences", async () => {
    const { storage, index } = await setup(
      `<${WEBID}> solid:publicTypeIndex <${IDX}>, <${IDX}#alias>; solid:privateTypeIndex <${IDX}>; pim:preferencesFile <${CARD}>.`,
    );
    await put(storage, IDX, reg());
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
    expect(read.mock.calls.map(([url]) => url)).toEqual([CARD, IDX]);
  });

  it("ignores foreign and malformed pointers without fetching them", async () => {
    const { storage, index } = await setup(
      `<${WEBID}> solid:publicTypeIndex <https://foreign.example/index>, "bad"; pim:preferencesFile <https://foreign.example/prefs>.`,
    );
    const read = vi.spyOn(storage, "readRdf");
    expect(await index.find(CLASS)).toEqual([]);
    expect(read.mock.calls.map(([url]) => url)).toEqual([CARD]);
    const create = vi.spyOn(storage, "create");
    await expect(index.register(CLASS, LOCATION, { index: "public" })).rejects.toMatchObject({
      code: "scope",
      url: ROOT,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("drops missing linked index/preferences documents", async () => {
    const { index } = await setup(
      `<${WEBID}> solid:publicTypeIndex <${ROOT}absent>; pim:preferencesFile <${PREF}>.`,
    );
    expect(await index.find(CLASS)).toEqual([]);
  });

  it.each(["find", "register"])("does not create a missing profile (%s)", async (method) => {
    const { storage, index } = await setup();
    await storage.delete(CARD, { ifMatch: (await storage.head(CARD)).etag as string });
    const create = vi.spyOn(storage, "create");
    await expect(
      method === "find" ? index.find(CLASS) : index.register(CLASS, LOCATION),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403],
    ["unauthenticated", 401],
    ["not-found", 410],
    ["network", null],
    ["not-rdf", null],
  ] as const)("never treats %s/%s as absence", async (code, status) => {
    const { storage, index } = await setup(`<${WEBID}> pim:preferencesFile <${PREF}>.`);
    const original = storage.readRdf;
    vi.spyOn(storage, "readRdf").mockImplementation(async (url, opts) => {
      if (url === PREF) throw fail(code, status);
      return original(url, opts);
    });
    const create = vi.spyOn(storage, "create");
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code, status });
    await expect(index.find(CLASS)).rejects.toMatchObject({ code, status });
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves existing unlinked preferences and adopts a pre-existing default index", async () => {
    const { storage, index } = await setup();
    await put(storage, PREF, `<${WEBID}> <urn:setting> "keep".`);
    await put(storage, IDX, `<> a solid:TypeIndex. ${reg()}`);
    const create = vi.spyOn(storage, "create");
    await index.register(CLASS, LOCATION);
    expect(create).not.toHaveBeenCalled();
    expect(await (await storage.read(PREF)).text()).toContain("keep");
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
  });

  it("repairs a missing linked preferences document and missing public index", async () => {
    const { storage, index } = await setup(
      `<${WEBID}> pim:preferencesFile <${PREF}>; solid:publicTypeIndex <${ROOT}settings/public.ttl>.`,
    );
    await index.register(CLASS, LOCATION);
    await index.register(CLASS, { instance: `${ROOT}one` }, { index: "public" });
    expect(await index.find(CLASS)).toEqual([LOCATION.container, `${ROOT}one`]);
    expect(await (await storage.read(`${ROOT}settings/public.ttl`)).text()).toContain(
      "ListedDocument",
    );
  });

  it("does not overwrite a conflicting default-path document", async () => {
    const { storage, index } = await setup();
    await put(storage, IDX, '<> <urn:unrelated> "keep".');
    const create = vi.spyOn(storage, "create");
    const write = vi.spyOn(storage, "writeRdf");
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "conflict" });
    expect(create).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "*",
    'W/"weak"',
    '"one", "two"',
  ])("requires an observed strong ETag (%s)", async (etag) => {
    const { storage, index } = await setup();
    await linkLegacy(storage);
    const original = storage.readRdf;
    vi.spyOn(storage, "readRdf").mockImplementation(async (url, opts) => ({
      ...(await original(url, opts)),
      etag,
    }));
    const write = vi.spyOn(storage, "writeRdf");
    await expect(index.register("urn:another", LOCATION)).rejects.toMatchObject({
      code: "precondition-required",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("conditionally re-reads and merges an intervening registration on 412", async () => {
    const { storage, index } = await setup();
    await linkLegacy(storage, "");
    const original = storage.writeRdf;
    const write = vi
      .spyOn(storage, "writeRdf")
      .mockImplementationOnce(async (url, dataset, opts) => {
        await put(
          storage,
          IDX,
          `<#concurrent> a solid:TypeRegistration; solid:forClass <urn:concurrent>; solid:instance <${ROOT}concurrent>.`,
        );
        return original(url, dataset, opts);
      });
    await index.register(CLASS, LOCATION);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0]?.[2].ifMatch).not.toBe(write.mock.calls[1]?.[2].ifMatch);
    expect(await index.find("urn:concurrent")).toEqual([`${ROOT}concurrent`]);
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
  });

  it("reconciles concurrent creates without duplicate registrations", async () => {
    const { index } = await setup();
    await Promise.all([index.register(CLASS, LOCATION), index.register(CLASS, LOCATION)]);
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
  });

  it("bounds repeated precondition failures and propagates non-storage failures", async () => {
    const { storage, index } = await setup();
    await linkLegacy(storage, "");
    const write = vi.spyOn(storage, "writeRdf").mockRejectedValue(fail("precondition-failed", 412));
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    expect(write).toHaveBeenCalledTimes(3);
    write.mockRejectedValueOnce(new Error("transport failed"));
    await expect(index.register(CLASS, LOCATION)).rejects.toThrow("transport failed");
  });

  it.each([
    `<${WEBID}> solid:privateTypeIndex <${IDX}>, <${ROOT}second>.`,
    `<${WEBID}> pim:preferencesFile <${PREF}>, <${ROOT}second>.`,
  ])("refuses ambiguous write destinations", async (card) => {
    const { index, storage } = await setup(card);
    const create = vi.spyOn(storage, "create");
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "conflict" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    `<${WEBID}> solid:privateTypeIndex "bad".`,
    `<${WEBID}> pim:preferencesFile <https://foreign.example/prefs>.`,
  ])("rejects malformed write pointers", async (card) => {
    const { index } = await setup(card);
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "scope" });
  });

  it("refuses query-bearing mutation documents", async () => {
    const { index } = await setup(`<${WEBID}> solid:privateTypeIndex <${IDX}?query=yes>.`);
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "bad-request" });
  });

  it.each([
    null,
    { write: false, control: true },
    { write: true, control: false },
  ])("requires known root Write and Control for bootstrap (%j)", async (allow) => {
    const { index, storage } = await setup();
    const original = storage.head;
    vi.spyOn(storage, "head").mockImplementation(async (url, opts) => ({
      ...(await original(url, opts)),
      allow: allow as never,
    }));
    const create = vi.spyOn(storage, "create");
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "forbidden" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    "forbidden",
    "not-found",
  ] as const)("does not create unsafe/unreadable linked parents (%s)", async (code) => {
    const { index, storage } = await setup(
      `<${WEBID}> solid:publicTypeIndex <${ROOT}arbitrary/index.ttl>.`,
    );
    const original = storage.head;
    vi.spyOn(storage, "head").mockImplementation(async (url, opts) => {
      if (url === `${ROOT}arbitrary/`) throw fail(code, code === "not-found" ? 404 : 403);
      return original(url, opts);
    });
    const create = vi.spyOn(storage, "create");
    await expect(index.register(CLASS, LOCATION, { index: "public" })).rejects.toMatchObject({
      code,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("avoids collision with an existing registration subject", async () => {
    const { storage, index } = await setup();
    await linkLegacy(storage, '<#registration-taken> <urn:annotation> "keep".');
    const random = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("taken")
      .mockReturnValueOnce("free");
    await index.register(CLASS, LOCATION);
    expect(random).toHaveBeenCalledTimes(2);
    expect(await (await storage.read(IDX)).text()).toContain("keep");
  });

  it("propagates serialization failures during a confirmed create", async () => {
    const { index } = await setup();
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce(function (callback) {
      callback(new Error("serialization"), "");
      return this;
    });
    await expect(index.register(CLASS, LOCATION)).rejects.toThrow("serialization");
  });

  it("ignores named-graph registrations on read and refuses to rewrite named graphs", async () => {
    const { storage, index } = await setup(`<${WEBID}> solid:privateTypeIndex <${IDX}>.`);
    await put(storage, IDX, `<urn:graph> { ${reg()} }`, "application/trig");
    expect(await index.find(CLASS)).toEqual([]);
    await expect(index.register(CLASS, LOCATION)).rejects.toMatchObject({ code: "not-rdf" });
  });

  it("bounds discovered documents including preferences, without silent truncation", async () => {
    const { index, storage } = await setup(
      `<${WEBID}> solid:publicTypeIndex ${Array.from({ length: 64 }, (_, i) => `<${ROOT}index-${i}>`).join(", ")}.`,
    );
    const read = vi.spyOn(storage, "readRdf");
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
    expect(read).toHaveBeenCalledTimes(64);
  });

  it("bounds matching results at 10,000", async () => {
    const { storage, index } = await setup();
    await linkLegacy(
      storage,
      `<#r> a solid:TypeRegistration; solid:forClass <${CLASS}>; solid:instance ${Array.from({ length: 10_001 }, (_, i) => `<${ROOT}r-${i}>`).join(", ")}.`,
    );
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("exact unregistration", () => {
  it.each([
    "bare",
    "missing-prefs",
    "prefs-no-index",
    "missing-index",
  ])("does not bootstrap when unregistering (%s)", async (state) => {
    const card = state === "bare" ? "" : `<${WEBID}> pim:preferencesFile <${PREF}>.`;
    const { storage, index } = await setup(card);
    if (state === "prefs-no-index") await put(storage, PREF, "");
    if (state === "missing-index")
      await put(storage, PREF, `<${WEBID}> solid:privateTypeIndex <${IDX}>.`);
    const create = vi.spyOn(storage, "create");
    await index.unregister(CLASS, LOCATION);
    await index.unregister(CLASS, LOCATION, { index: "public" });
    expect(create).not.toHaveBeenCalled();
  });

  it("removes matching instances/containers, retains annotations, and avoids no-op writes", async () => {
    const { storage, index } = await setup();
    await linkLegacy(
      storage,
      `_:r a solid:TypeRegistration; solid:forClass <${LEGACY}>; solid:instance <${ROOT}one>; <urn:annotation> "keep". ${reg()}`,
    );
    await index.unregister(CLASS, { instance: `${ROOT}one` });
    expect(await index.find(CLASS)).toEqual([LOCATION.container]);
    expect(await (await storage.read(IDX)).text()).toContain("keep");
    await index.unregister(CLASS, LOCATION);
    const write = vi.spyOn(storage, "writeRdf");
    await index.unregister(CLASS, LOCATION);
    expect(write).not.toHaveBeenCalled();
    expect(await index.find(CLASS)).toEqual([]);
  });

  it.each([
    `solid:forClass <${CLASS}>, <urn:other>; solid:instanceContainer <${LOCATION.container}>`,
    `solid:forClass <${CLASS}>; solid:instanceContainer <${LOCATION.container}>, <${ROOT}other/>`,
  ])("refuses ambiguous registration removal", async (content) => {
    const { storage, index } = await setup();
    await linkLegacy(storage, `<#r> a solid:TypeRegistration; ${content}.`);
    const write = vi.spyOn(storage, "writeRdf");
    await expect(index.unregister(CLASS, LOCATION)).rejects.toMatchObject({ code: "conflict" });
    expect(write).not.toHaveBeenCalled();
  });
});
