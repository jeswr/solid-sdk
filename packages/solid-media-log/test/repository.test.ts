// AUTHORED-BY Codex (GPT-6.1 Sol)

import { Book } from "@jeswr/pod-connectors/core/vocab";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { LOG_ENTRY, type MediaEntry, parseMediaLog } from "../src/model.js";
import { mediaRepository } from "../src/repository.js";

const root = "https://pod.example/";
const entry: MediaEntry = { title: "The Last Lighthouse", kind: "film", status: "want" };
function typeIndex(sources = new Map<string, string[]>()): TypeIndex {
  return {
    find: vi.fn(async (type: string) => sources.get(type) ?? []),
    findAll: vi.fn(async () => sources),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => {}),
    listClasses: vi.fn(async () => []),
  };
}
for (const protocol of ["solid", "lws"] as const)
  describe(`repository / ${protocol}`, () => {
    it("initialises a container, registers it, saves at returned URLs and edits conditionally", async () => {
      const storage = createMemoryStorage({ root, protocol, pageSize: 1 });
      const index = typeIndex();
      const repo = mediaRepository(storage, index);
      expect(await repo.load()).toEqual({ records: [], incomplete: false });
      const saved = await repo.save(entry);
      expect(saved.url).toBeTruthy();
      expect(saved.etag).toBeTruthy();
      expect(index.register).toHaveBeenCalledWith(LOG_ENTRY, { container: expect.any(String) });
      expect(
        parseMediaLog(saved.url as string, (await storage.readRdf(saved.url as string)).dataset),
      ).toMatchObject(entry);
      const updated = await repo.save(
        { ...entry, status: "finished", finished: "2026-03-03", rating: 4.5 },
        saved,
      );
      expect(updated.data).toMatchObject({ status: "finished", rating: 4.5 });
      expect(updated.etag).not.toBe(saved.etag);
      await expect(repo.save({ ...entry, rating: 5 }, saved)).rejects.toMatchObject({
        code: "precondition-failed",
      });
      await expect(repo.save(entry, { ...updated, etag: null })).rejects.toThrow(/Reload/);
    });
    it("finds registered importer resources and saves a separate log on editing", async () => {
      const storage = createMemoryStorage({ root, protocol });
      const imported = await storage.create(root, null, { kind: "container", name: "imported" });
      const url = new URL("book", root).href;
      const dataset = new Store();
      const book = new Book(`${url}#book`, dataset, DataFactory).mark();
      book.name = "The Orchard Letters";
      book.readingStatus = "read";
      book.ratingValue = 4;
      const document = await storage.create(imported.url, null, { contentType: "text/turtle" });
      const empty = await storage.read(document.url);
      await storage.writeRdf(document.url, dataset, {
        contentType: "text/turtle",
        ifMatch: empty.etag as string,
      });
      const index = typeIndex(new Map([["https://schema.org/Book", [imported.url, document.url]]]));
      const repo = mediaRepository(storage, index);
      const original = await storage.read(document.url);
      const record = (await repo.load()).records[0];
      expect(record).toMatchObject({
        url: null,
        data: { kind: "book", status: "finished", rating: 4 },
      });
      if (!record) throw new Error("Missing imported record");
      const saved = await repo.save({ ...record.data, rating: 5 }, record);
      expect(saved.url).not.toBe(document.url);
      expect((await storage.read(document.url)).etag).toBe(original.etag);
      const listing = await repo.load();
      expect(listing.records).toHaveLength(1);
      expect(listing.records[0]?.data.rating).toBe(5);
    });
  });
describe("repository error paths", () => {
  it("retries failed initialisation and never treats forbidden as absence", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const original = storage.head.bind(storage);
    vi.spyOn(storage, "head")
      .mockRejectedValueOnce(new StorageError("forbidden", { url: root, method: "HEAD" }))
      .mockImplementation(original);
    const repo = mediaRepository(storage, typeIndex());
    await expect(repo.load()).rejects.toMatchObject({ code: "forbidden" });
    expect(await repo.load()).toMatchObject({ records: [] });
  });
  it("refuses to use a resource as the media container", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const head = await storage.head(root);
    vi.spyOn(storage, "head").mockResolvedValue({
      ...head,
      url: `${root}media/`,
      kind: "resource",
    });
    await expect(mediaRepository(storage, typeIndex()).load()).rejects.toThrow(/container/);
  });
  it("reuses a registered container", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const created = await storage.create(root, null, { kind: "container", name: "library" });
    const index = typeIndex(new Map([[LOG_ENTRY, [created.url]]]));
    const repo = mediaRepository(storage, index);
    await repo.save(entry);
    expect((await repo.load()).records).toHaveLength(1);
  });
  it("refuses to write an allocated resource without an ETag or with unexpected content", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const original = storage.read.bind(storage);
    const repo = mediaRepository(storage, typeIndex());
    await repo.load();
    const read = vi.spyOn(storage, "read").mockImplementation(async (url, options) => ({
      ...(await original(url, options)),
      etag: null,
    }));
    await expect(repo.save(entry)).rejects.toThrow(/reserve/);
    read.mockImplementation(async (url, options) => ({
      ...(await original(url, options)),
      bytes: async () => new Uint8Array([1]),
    }));
    await expect(repo.save(entry)).rejects.toThrow(/reserve/);
  });
  it("marks capped discovery incomplete", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const urls = [];
    for (let i = 0; i < 33; i++)
      urls.push((await storage.create(root, null, { kind: "container", name: `source${i}` })).url);
    const repo = mediaRepository(storage, typeIndex(new Map([["https://schema.org/Book", urls]])));
    expect((await repo.load()).incomplete).toBe(true);
  });
  it("propagates later-page listing failures rather than displaying a partial empty library", async () => {
    const storage = createMemoryStorage({ root, protocol: "lws" });
    const repo = mediaRepository(storage, typeIndex());
    await repo.load();
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      yield* [];
      throw new StorageError("network", { url: root, method: "GET" });
    });
    await expect(repo.load()).rejects.toMatchObject({ code: "network" });
  });
});
it("uses SDK discovery for live pods and propagates discovery failures", async () => {
  const sdk = await import("@jeswr/storage-client");
  const { createMediaRepository } = await import("../src/repository.js");
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const client = vi.spyOn(sdk, "createPodClient").mockResolvedValue({
    storage,
    features: storage.features,
    description: {} as Awaited<ReturnType<typeof sdk.createPodClient>>["description"],
  });
  const transport = vi.fn<typeof fetch>();
  const repo = await createMediaRepository({
    fetch: transport,
    storage: root,
    webId: `${root}profile#me`,
  });
  expect(repo.load).toBeTypeOf("function");
  expect(client).toHaveBeenCalledWith({ fetch: transport, storage: root });
  client.mockRejectedValueOnce(new Error("No capability metadata"));
  await expect(
    createMediaRepository({ fetch: transport, storage: root, webId: `${root}profile#me` }),
  ).rejects.toThrow("No capability metadata");
  client.mockRestore();
});
it("safely handles another writer creating the media container during initialisation", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const original = storage.create.bind(storage);
  vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new StorageError("conflict", { url: `${root}media/`, method: "PUT" });
  });
  expect(await mediaRepository(storage, typeIndex()).load()).toEqual({
    records: [],
    incomplete: false,
  });
});
it("propagates a non-conflict container creation failure", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  vi.spyOn(storage, "create").mockRejectedValueOnce(
    new StorageError("forbidden", { url: root, method: "PUT" }),
  );
  await expect(mediaRepository(storage, typeIndex()).load()).rejects.toMatchObject({
    code: "forbidden",
  });
});
it("reuses an LWS instance's server-reported parent after reopening", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const sources = new Map<string, string[]>();
  const index = typeIndex(sources);
  const first = mediaRepository(storage, index);
  const saved = await first.save(entry);
  sources.set(LOG_ENTRY, [saved.url as string]);
  const create = vi.spyOn(storage, "create");
  const reopened = mediaRepository(storage, index);
  await reopened.save({ ...entry, title: "Another film" });
  expect(create.mock.calls.every((call) => call[2]?.kind !== "container")).toBe(true);
  expect((await reopened.load()).records).toHaveLength(2);
});
