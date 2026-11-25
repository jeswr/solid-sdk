// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { Book, VideoGame, WatchAction } from "@jeswr/pod-connectors/core/vocab";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError, toStorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { entities, nodes } from "../src/generated/model.js";
import { buildMediaLog, LOG_ENTRY, type MediaEntry, parseMediaLog } from "../src/model.js";
import { createMediaRepository, mediaRepository } from "../src/repository.js";

const verifiedFixture = async () => true;
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
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
for (const protocol of ["solid", "lws"] as const)
  describe(`repository / ${protocol}`, () => {
    it("initialises a container, registers it, saves at returned URLs and edits conditionally", async () => {
      const storage = createMemoryStorage({ root, protocol, pageSize: 1 });
      const index = typeIndex();
      const repo = mediaRepository(storage, index, verifiedFixture);
      expect(await repo.load()).toEqual({ records: [], incomplete: false, skipped: [] });
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
      const repo = mediaRepository(storage, index, verifiedFixture);
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
    const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
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
    await expect(mediaRepository(storage, typeIndex(), verifiedFixture).load()).rejects.toThrow(
      /container/,
    );
  });
  it("reuses a registered container", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const created = await storage.create(root, null, { kind: "container", name: "library" });
    const index = typeIndex(new Map([[LOG_ENTRY, [created.url]]]));
    const repo = mediaRepository(storage, index, verifiedFixture);
    await repo.save(entry);
    expect((await repo.load()).records).toHaveLength(1);
  });
  it("refuses to write an allocated resource without an ETag or with unexpected content", async () => {
    const storage = createMemoryStorage({ root, protocol: "solid" });
    const original = storage.read.bind(storage);
    const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
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
    const repo = mediaRepository(
      storage,
      typeIndex(new Map([["https://schema.org/Book", urls]])),
      verifiedFixture,
    );
    expect((await repo.load()).incomplete).toBe(true);
  });
  it("returns partial records after a later-page container listing failure", async () => {
    const storage = createMemoryStorage({ root, protocol: "lws" });
    const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
    const saved = await repo.save(entry);
    const item = await storage.head(saved.url as string);
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      yield {
        ...item,
        contentType: "text/turtle",
        size: null,
        modified: null,
        displayName: null,
        types: [],
      };
      throw new StorageError("network", { url: root, method: "GET" });
    });
    expect(await repo.load()).toMatchObject({
      records: [{ data: entry }],
      incomplete: true,
      skipped: [{ reason: "network" }],
    });
  });
});
it("uses SDK discovery for live pods and propagates discovery failures", async () => {
  const sdk = await import("@jeswr/storage-client");
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
  expect(await mediaRepository(storage, typeIndex(), verifiedFixture).load()).toEqual({
    records: [],
    incomplete: false,
    skipped: [],
  });
});
it("propagates a non-conflict container creation failure", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  vi.spyOn(storage, "create").mockRejectedValueOnce(
    new StorageError("forbidden", { url: root, method: "PUT" }),
  );
  await expect(mediaRepository(storage, typeIndex(), verifiedFixture).load()).rejects.toMatchObject(
    {
      code: "forbidden",
    },
  );
});
it("reuses an LWS instance's server-reported parent after reopening", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const sources = new Map<string, string[]>();
  const index = typeIndex(sources);
  const first = mediaRepository(storage, index, verifiedFixture);
  const saved = await first.save(entry);
  sources.set(LOG_ENTRY, [saved.url as string]);
  const create = vi.spyOn(storage, "create");
  const reopened = mediaRepository(storage, index, verifiedFixture);
  await reopened.save({ ...entry, title: "Another film" });
  expect(create.mock.calls.every((call) => call[2]?.kind !== "container")).toBe(true);
  expect((await reopened.load()).records).toHaveLength(2);
});

it("skips stale registrations, forbidden and non-RDF resources and facade validation failures", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const missing = `${root}gone`;
  const sources = new Map([[LOG_ENTRY, [missing]]]);
  const index = typeIndex(sources);
  const repo = mediaRepository(storage, index, verifiedFixture);
  const good = await repo.save(entry);
  const badTitle = await repo.save({ ...entry, title: "Will become invalid" });
  const badRating = await repo.save({ ...entry, rating: 4 });
  const forbidden = await repo.save({ ...entry, title: "Private" });
  const nonRdf = await storage.create(`${root}media/`, "plain text", { contentType: "text/plain" });
  const titleDataset = entities.MediaLog.build(badTitle.url as string, {
    title: "x".repeat(600),
    workType: "http://schema.org/Book",
    status: "want",
  });
  await storage.writeRdf(badTitle.url as string, titleDataset, {
    contentType: "text/turtle",
    ifMatch: badTitle.etag as string,
  });
  const ratingDataset = buildMediaLog(badRating.url as string, { ...entry, rating: 4 });
  const ratingSubject = DataFactory.namedNode(
    nodes.MediaLog.rating.subject(badRating.url as string),
  );
  const predicate = DataFactory.namedNode("http://schema.org/ratingValue");
  ratingDataset.removeMatches(ratingSubject, predicate, null, null);
  ratingDataset.addQuad(
    ratingSubject,
    predicate,
    DataFactory.literal("4.25", DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#decimal")),
  );
  await storage.writeRdf(badRating.url as string, ratingDataset, {
    contentType: "text/turtle",
    ifMatch: badRating.etag as string,
  });
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    url === forbidden.url
      ? Promise.reject(new StorageError("forbidden", { url, method: "GET" }))
      : read(url, options),
  );
  const listing = await repo.load();
  expect(listing.records.map((record) => record.url)).toEqual([good.url]);
  expect(listing.incomplete).toBe(false);
  expect(new Set(listing.skipped?.map((item) => item.url))).toEqual(
    new Set([missing, badTitle.url, badRating.url, forbidden.url, nonRdf.url]),
  );
  sources.clear();
  expect(await repo.load()).toMatchObject({ incomplete: false });
});
it("keeps loading and saving when Type Index lookup and registration are forbidden, registering only once", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  vi.mocked(index.find).mockRejectedValue(new Error("forbidden"));
  vi.mocked(index.findAll).mockRejectedValue(new Error("forbidden"));
  vi.mocked(index.register).mockRejectedValue(new Error("forbidden"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const repo = mediaRepository(storage, index, verifiedFixture);
  await repo.load();
  await repo.save(entry);
  await repo.save({ ...entry, title: "Another" });
  expect((await repo.load()).records).toHaveLength(2);
  expect(index.register).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    "Media Type Index registration unavailable; using the media container.",
  );
  warn.mockRestore();
});
it("passes the cached LWS hint to every create", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const index = typeIndex();
  const hint = { links: [{ rel: "type", target: LOG_ENTRY }] };
  vi.mocked(index.register).mockResolvedValue(hint);
  const repo = mediaRepository(storage, index, verifiedFixture);
  await repo.load();
  const create = vi.spyOn(storage, "create");
  await repo.save(entry);
  await repo.save(entry);
  expect(index.register).toHaveBeenCalledTimes(1);
  expect(create.mock.calls.every((call) => call[2]?.links === hint.links)).toBe(true);
});
it("returns partial results promptly on timeout even when a resource ignores abort", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  const good = await repo.save(entry);
  const slow = await repo.save({ ...entry, title: "Slow" });
  const read = storage.readRdf.bind(storage);
  const fast = pending<void>();
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) => {
    if (url !== slow.url) {
      const result = await read(url, options);
      fast.resolve();
      return result;
    }
    started();
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    const task = repo.load();
    await Promise.all([waiting, fast.promise]);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    expect(await task).toMatchObject({
      records: [{ url: good.url }],
      incomplete: true,
      skipped: [{ url: slow.url, reason: "timeout-or-cancelled" }],
    });
  } finally {
    timeout.mockRestore();
  }
});
it("reads with at most six concurrent requests and includes records beyond 1,000", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const template = await storage.head(`${root}media/`);
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    for (let i = 0; i < 1002; i++)
      yield {
        ...template,
        url: `${root}media/item-${i}`,
        kind: "resource" as const,
        contentType: "text/turtle",
        size: null,
        modified: null,
        displayName: null,
        types: [],
      };
  });
  let active = 0;
  let maximum = 0;
  vi.spyOn(storage, "readRdf").mockImplementation(async (url) => {
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    --active;
    return {
      dataset: buildMediaLog(url, entry),
      etag: '"test"',
      notModified: false,
      url,
      kind: "resource",
      contentType: "text/turtle",
      links: [],
      parent: `${root}media/`,
      metadataUrl: null,
      allow: null,
    };
  });
  const listing = await repo.load({ complete: true });
  expect(listing.records).toHaveLength(1002);
  expect(listing.incomplete).toBe(false);
  expect(maximum).toBe(6);
}, 15000);
it("retains a committed new or edited item as unconfirmed if read-back fails", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  const saved = await repo.save(entry);
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf")
    .mockImplementationOnce(read)
    .mockRejectedValue(new Error("Lost response"));
  expect(await repo.save({ ...entry, rating: 5 }, saved)).toMatchObject({
    url: saved.url,
    unconfirmed: true,
    etag: null,
    data: { rating: 5 },
  });
  expect(await repo.save(entry)).toMatchObject({ unconfirmed: true, etag: null, data: entry });
});
it("best-effort deletes an empty reservation after a failed write under its observed ETag", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const remove = vi.spyOn(storage, "delete");
  const read = vi.spyOn(storage, "read");
  vi.spyOn(storage, "write").mockRejectedValue(
    new StorageError("forbidden", { url: root, method: "PUT" }),
  );
  await expect(repo.save(entry)).rejects.toMatchObject({ code: "forbidden" });
  expect(remove).toHaveBeenCalledTimes(1);
  const reserved = await read.mock.results[0]?.value;
  expect(remove).toHaveBeenCalledWith(reserved?.url, { ifMatch: reserved?.etag });
  expect((await repo.load()).records).toHaveLength(0);
});
it("conditionally deletes a failed reservation without deleting another writer's content on 412", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const write = storage.write.bind(storage);
  const read = vi.spyOn(storage, "read");
  const remove = vi.spyOn(storage, "delete");
  vi.spyOn(storage, "write").mockImplementationOnce(async (url, _body, options) => {
    await write(url, "Another writer's content", options);
    throw new StorageError("precondition-failed", { url, method: "PUT", status: 412 });
  });
  await expect(repo.save(entry)).rejects.toMatchObject({ code: "precondition-failed" });
  const reserved = await read.mock.results[0]?.value;
  expect(remove).toHaveBeenCalledWith(reserved?.url, { ifMatch: reserved?.etag });
  await expect(remove.mock.results[0]?.value).rejects.toMatchObject({
    code: "precondition-failed",
    status: 412,
  });
  expect(await (await storage.read(reserved?.url as string)).text()).toBe(
    "Another writer's content",
  );
});
it("fails when the media container's first listing page cannot be read", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    yield* [];
    throw new StorageError("forbidden", { url: `${root}media/`, method: "GET" });
  });
  await expect(repo.load()).rejects.toMatchObject({ code: "forbidden" });
});
it("keeps rejected resources separate from an unscanned library and ignores generic connector documents", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  const repo = mediaRepository(storage, index, verifiedFixture);
  const good = await repo.save(entry);
  const forbidden = await repo.save({ ...entry, title: "Private" });
  const nonRdf = await storage.create(`${root}media/`, "plain text", { contentType: "text/plain" });
  const connector = new Store();
  const watch = new WatchAction(`${root}takeout#watch`, connector, DataFactory).mark();
  watch.name = "A recorded stream";
  watch.sourceUrl = "https://www.twitch.tv/fictional";
  const document = await storage.create(root, null, { contentType: "text/turtle" });
  await storage.writeRdf(document.url, connector, {
    contentType: "text/turtle",
    ifMatch: document.etag as string,
  });
  vi.mocked(index.findAll).mockResolvedValue(
    new Map([["https://schema.org/WatchAction", [document.url]]]),
  );
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    url === forbidden.url
      ? Promise.reject(new StorageError("forbidden", { url, method: "GET", status: 403 }))
      : read(url, options),
  );
  for (const complete of [false, true]) {
    const listing = await repo.load({ complete });
    expect(listing.records.map((record) => record.url)).toEqual([good.url]);
    expect(listing.incomplete).toBe(false);
    expect(listing.skipped).toHaveLength(2);
    expect(new Set(listing.skipped?.map((skip) => skip.url))).toEqual(
      new Set([forbidden.url, nonRdf.url]),
    );
  }
});
it.each([
  429,
  502,
  503,
  504,
  "network",
] as const)("marks retryable entry reads as unscanned (%s)", async (failure) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  const good = await repo.save(entry);
  const unavailable = await repo.save({ ...entry, title: "Unavailable" });
  const error =
    failure === "network"
      ? new StorageError("network", { url: unavailable.url as string, method: "GET" })
      : toStorageError("GET", unavailable.url as string, new Response(null, { status: failure }));
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    url === unavailable.url ? Promise.reject(error) : read(url, options),
  );
  for (const complete of [false, true]) {
    expect(await repo.load({ complete })).toMatchObject({
      records: [{ url: good.url }],
      incomplete: true,
      skipped: [{ url: unavailable.url, reason: error.code }],
    });
  }
});
it("marks a connector source document with a retryable 503 as unscanned", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const dataset = new Store();
  new Book(`${root}goodreads#book`, dataset, DataFactory).mark().name = "The Orchard Letters";
  const document = await storage.create(root, null, { contentType: "text/turtle" });
  await storage.writeRdf(document.url, dataset, {
    contentType: "text/turtle",
    ifMatch: document.etag as string,
  });
  const index = typeIndex(new Map([["https://schema.org/Book", [document.url]]]));
  const repo = mediaRepository(storage, index, verifiedFixture);
  const good = await repo.save(entry);
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url, options) =>
    url === document.url
      ? Promise.reject(toStorageError("GET", url, new Response(null, { status: 503 })))
      : read(url, options),
  );
  expect(await repo.load({ complete: true })).toMatchObject({
    records: [{ url: good.url }],
    incomplete: true,
    skipped: [{ url: document.url, reason: "server" }],
  });
});
it.each([
  403, 404, 429, 503,
])("classifies a registered instance's failed HEAD (%s)", async (status) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const source = `${root}registered-instance`;
  const index = typeIndex(new Map([["https://schema.org/Book", [source]]]));
  const repo = mediaRepository(storage, index, verifiedFixture);
  const good = await repo.save(entry);
  const error = toStorageError("HEAD", source, new Response(null, { status }));
  const head = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation((url, options) =>
    url === source ? Promise.reject(error) : head(url, options),
  );
  for (const complete of [false, true]) {
    expect(await repo.load({ complete })).toMatchObject({
      records: [{ url: good.url }],
      incomplete: status !== 403 && status !== 404,
      skipped: [{ url: source, reason: error.code }],
    });
  }
});
it.each([
  ["Book", Book],
  ["VideoGame", VideoGame],
] as const)("reports a connector document whose %s items are all dropped", async (type, Wrapper) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const dataset = new Store();
  new Wrapper(`${root}connector#missing-title`, dataset, DataFactory).mark();
  new Wrapper(`${root}connector#oversized`, dataset, DataFactory).mark().name = "x".repeat(501);
  const document = await storage.create(root, null, { contentType: "text/turtle" });
  await storage.writeRdf(document.url, dataset, {
    contentType: "text/turtle",
    ifMatch: document.etag as string,
  });
  const index = typeIndex(new Map([[`https://schema.org/${type}`, [document.url]]]));
  const listing = await mediaRepository(storage, index, verifiedFixture).load({ complete: true });
  expect(listing).toEqual({
    records: [],
    incomplete: false,
    skipped: [{ url: document.url, reason: "invalid-or-unavailable" }],
  });
});
it("lets an import cancel its initialisation wait without aborting a concurrent save", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  const lookup = pending<string[]>();
  vi.mocked(index.find).mockReturnValueOnce(lookup.promise);
  const repo = mediaRepository(storage, index, verifiedFixture);
  const caller = new AbortController();
  const scan = repo.load({ complete: true, signal: caller.signal });
  const rejected = expect(scan).rejects.toMatchObject({ name: "AbortError" });
  const save = repo.save(entry);
  caller.abort();
  await rejected;
  lookup.resolve([]);
  const saved = await save;
  expect(saved).toMatchObject({ data: entry, unconfirmed: false });
  expect(await repo.load({ complete: true })).toMatchObject({
    records: [{ url: saved.url }],
    incomplete: false,
  });
  expect(index.register).toHaveBeenCalledOnce();
});
it("lets a second caller cancel its own wait for shared initialisation", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  const lookup = pending<string[]>();
  vi.mocked(index.find).mockReturnValueOnce(lookup.promise);
  const repo = mediaRepository(storage, index, verifiedFixture);
  const first = repo.load({ complete: true });
  const caller = new AbortController();
  const second = repo.load({ complete: true, signal: caller.signal });
  const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
  caller.abort();
  await rejected;
  lookup.resolve([]);
  expect(await first).toEqual({ records: [], incomplete: false, skipped: [] });
  expect(index.register).toHaveBeenCalledOnce();
});
it("never starts registration after a container request exceeds the initialisation deadline", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  const container = await storage.create(root, null, { kind: "container", name: "media" });
  const metadata = await storage.head(container.url);
  const started = pending<void>();
  const head = pending<typeof metadata>();
  vi.spyOn(storage, "head").mockImplementationOnce(() => {
    started.resolve();
    return head.promise;
  });
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  try {
    const task = mediaRepository(storage, index, verifiedFixture).load({ complete: true });
    const rejected = expect(task).rejects.toMatchObject({ name: "TimeoutError" });
    await started.promise;
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
    head.resolve(metadata);
    // Flush the late transport result without starting any registration work.
    await head.promise;
    expect(index.register).not.toHaveBeenCalled();
  } finally {
    timeout.mockRestore();
  }
});
it("checks the deadline immediately before registration after a successful HEAD", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  await storage.create(root, null, { kind: "container", name: "media" });
  const metadata = await storage.head(`${root}media/`);
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  vi.spyOn(storage, "head").mockResolvedValueOnce({
    ...metadata,
    get url() {
      deadline.abort(new DOMException("Timed out", "TimeoutError"));
      return metadata.url;
    },
  });
  try {
    await expect(
      mediaRepository(storage, index, verifiedFixture).load({ complete: true }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(index.register).not.toHaveBeenCalled();
  } finally {
    timeout.mockRestore();
  }
});
it("retries Type Index discovery on refresh without retaining initialisation failures", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const index = typeIndex();
  vi.mocked(index.find).mockRejectedValueOnce(new Error("Transient discovery failure"));
  vi.mocked(index.findAll).mockRejectedValueOnce(new Error("Still unavailable"));
  const repo = mediaRepository(storage, index, verifiedFixture);
  expect(await repo.load()).toMatchObject({
    incomplete: true,
    skipped: [{ reason: "type-index-unavailable" }],
  });
  expect(await repo.load({ complete: true })).toMatchObject({ incomplete: false, skipped: [] });
  expect(index.findAll).toHaveBeenCalledTimes(2);
});
it.each([
  false,
  true,
])("bounds initialisation when a HEAD fetch ignores abort (complete: %s)", async (complete) => {
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(() => {
    started();
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    const repo = mediaRepository(createSolidBackend({ root, fetch }), typeIndex(), verifiedFixture);
    const task = repo.load({ complete });
    const rejected = expect(task).rejects.toMatchObject({ name: "TimeoutError" });
    await waiting;
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("HEAD");
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
  } finally {
    timeout.mockRestore();
  }
});
it.each([
  "read",
  "bytes",
  "etag",
] as const)("cleans up an empty reservation conditionally after %s fails", async (failure) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const create = vi.spyOn(storage, "create");
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => {
    if (failure === "read") throw new Error("Read failed");
    const fresh = await read(...args);
    return failure === "etag"
      ? { ...fresh, etag: null }
      : {
          ...fresh,
          bytes: async () => {
            throw new Error("Body failed");
          },
        };
  });
  const remove = vi.spyOn(storage, "delete");
  await expect(repo.save(entry)).rejects.toThrow();
  const reserved = await create.mock.results[0]?.value;
  expect(remove).toHaveBeenCalledWith(reserved?.url, { ifMatch: reserved?.etag });
  await expect(storage.head(reserved?.url as string)).rejects.toMatchObject({ code: "not-found" });
  expect(await repo.load()).toEqual({ records: [], incomplete: false, skipped: [] });
});
it.each([
  ["missing", "read"],
  ["missing", "etag"],
  ["follow-up", "read"],
  ["follow-up", "etag"],
] as const)("leaves an ignorable empty reservation without a safe ETag (%s, %s)", async (source, failure) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const create = storage.create.bind(storage);
  vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => ({
    ...(await create(...args)),
    ...(source === "missing" ? { etag: null } : { etagSource: "follow-up" as const }),
  }));
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => {
    if (failure === "read") throw new Error("Read failed");
    return { ...(await read(...args)), etag: null };
  });
  const remove = vi.spyOn(storage, "delete");
  await expect(repo.save(entry)).rejects.toThrow(failure === "read" ? "Read failed" : /reserve/);
  expect(remove).not.toHaveBeenCalled();
  const remaining = [];
  for await (const resource of storage.listAll(`${root}media/`)) remaining.push(resource);
  expect(remaining).toHaveLength(1);
  expect(await repo.load()).toEqual({ records: [], incomplete: false, skipped: [] });
});

it.each([
  true,
  false,
])("refuses all writes under public default access (media exists: %s)", async (exists) => {
  const owner = "https://identity.example/alice#me";
  const acl = `${root}.acl`;
  const policy = ownerPolicy(owner, true);
  policy.grants.push({
    modes: new Set(["read"]),
    who: [[{ kind: "public" }]],
    except: [],
    appliesTo: "members",
    source: { url: acl, node: acl },
  });
  const turtle = await writeWac(policy, root, acl);
  const folder = `${root}media/`;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === acl) {
      return new Response(init?.method === "HEAD" ? null : turtle, {
        headers: { "Content-Type": "text/turtle", ETag: '"acl"' },
      });
    }
    if (url === root || (url === folder && exists)) {
      return new Response(null, {
        headers: {
          Link: `<${url}.acl>; rel="acl", <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"${url === root ? ', <http://www.w3.org/ns/pim/space#Storage>; rel="type"' : ""}`,
        },
      });
    }
    return new Response(null, { status: 404 });
  });
  const repo = await createMediaRepository({
    fetch: transport,
    storage: root,
    webId: owner,
    knownSolid: true,
  });
  await expect(repo.save(entry)).rejects.toThrow(/owner-only destination/);
  expect(
    transport.mock.calls.some(([, init]) => init?.method === "PUT" || init?.method === "POST"),
  ).toBe(false);
  expect(transport.mock.calls.some(([url]) => String(url) === acl)).toBe(true);
  expect(transport.mock.calls.every(([url]) => String(url).startsWith(root))).toBe(true);
});

it("rechecks the allocated document and a reused edit target before writing", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const verify = vi.fn(async () => true);
  const repo = mediaRepository(storage, typeIndex(), verify);
  const saved = await repo.save(entry);
  const write = vi.spyOn(storage, "write");
  verify.mockImplementation(async (url?: string) => url === `${root}media/`);
  await expect(repo.save({ ...entry, review: "Private" }, saved)).rejects.toThrow(/owner-only/);
  await expect(repo.save(entry)).rejects.toThrow(/owner-only/);
  expect(write).not.toHaveBeenCalled();
});

it("skips auxiliary targets and refuses an injected edit of a mixed access document", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const folder = await storage.create(root, null, { name: "media", kind: "container" });
  const acl = await storage.create(folder.url, null, {
    name: "entry.acl",
    contentType: "text/turtle",
  });
  const mixed = await storage.create(folder.url, null, {
    name: "other.ttl",
    contentType: "text/turtle",
  });
  const owner = `${root}profile#me`;
  await storage.write(acl.url, await writeWac(ownerPolicy(owner), mixed.url, acl.url), {
    contentType: "text/turtle",
    ifMatch: acl.etag as string,
  });
  const media = buildMediaLog(mixed.url, entry);
  media.addQuads([...(await storage.readRdf(acl.url)).dataset]);
  const stored = await storage.writeRdf(mixed.url, media, {
    ifMatch: mixed.etag as string,
  });
  const index = typeIndex(new Map([[LOG_ENTRY, [acl.url, mixed.url]]]));
  const repo = mediaRepository(storage, index, verifiedFixture);
  await expect(repo.load()).resolves.toMatchObject({
    records: [],
    skipped: [
      { url: acl.url, reason: "auxiliary-resource" },
      { url: mixed.url, reason: "auxiliary-resource" },
    ],
  });
  const write = vi.spyOn(storage, "write");
  await expect(
    repo.save(entry, {
      url: mixed.url,
      id: mixed.url,
      data: entry,
      etag: stored.etag,
    }),
  ).rejects.toThrow(/verified media document/);
  expect(write).not.toHaveBeenCalled();
});

it("dereferences registered subjects once and treats external media instances as read-only sources", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const plan: MediaEntry = { ...entry, title: "Paper Moons: Season 2", source: "Netflix" };
  const created = await storage.create(root, null, {
    name: "registered.ttl",
    contentType: "text/turtle",
  });
  const written = await storage.writeRdf(created.url, buildMediaLog(created.url, plan), {
    ifMatch: created.etag as string,
  });
  const index = typeIndex(new Map([[LOG_ENTRY, [`${created.url}#it`, created.url]]]));
  const repo = mediaRepository(storage, index, verifiedFixture);
  const read = vi.spyOn(storage, "readRdf");
  const listing = await repo.load();
  expect(listing.records).toEqual([
    { id: created.url, url: null, etag: null, data: expect.objectContaining(plan) },
  ]);
  expect(read).toHaveBeenCalledExactlyOnceWith(
    created.url,
    expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }),
  );
  await expect(
    repo.save(entry, {
      id: created.url,
      url: created.url,
      etag: written.etag,
      data: entry,
    }),
  ).rejects.toThrow(/your media container/);
});

it("marks a capped media body incomplete for both browsing and duplicate scans", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  const good = await repo.save(entry);
  const huge = await storage.create(`${root}media/`, " ".repeat(2 * 1024 * 1024 + 1), {
    contentType: "text/turtle",
  });
  for (const complete of [false, true]) {
    expect(await repo.load({ complete })).toMatchObject({
      records: [{ url: good.url }],
      incomplete: true,
      skipped: [{ url: huge.url, reason: "payload-too-large" }],
    });
  }
});

it("opens a conventional Solid container with an external WebID and performs no foreign I/O", async () => {
  const owner = "https://identity.example/alice#me";
  const folder = `${root}media/`;
  const transport = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(init?.method === "HEAD" ? null : "", {
        headers: {
          "Content-Type": "text/turtle",
          Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      }),
  );
  const repo = await createMediaRepository({
    fetch: transport,
    storage: root,
    webId: owner,
    knownSolid: true,
  });
  expect(await repo.load({ complete: true })).toMatchObject({
    records: [],
    incomplete: false,
    connectorDiscoveryUnavailable: true,
  });
  expect(transport.mock.calls.length).toBeGreaterThan(0);
  expect(transport.mock.calls.every(([url]) => String(url) === folder)).toBe(true);
});

it("completes the LWS media scan when optional type search is unsupported", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  const index = typeIndex();
  const error = new StorageError("unsupported", { url: root, method: "QUERY" });
  vi.mocked(index.find).mockRejectedValue(error);
  vi.mocked(index.findAll).mockRejectedValue(error);
  const repo = mediaRepository(storage, index, verifiedFixture);
  const saved = await repo.save(entry);
  expect(await repo.load({ complete: true })).toMatchObject({
    records: [{ url: saved.url }],
    incomplete: false,
    connectorDiscoveryUnavailable: true,
  });
});

it.each([
  true,
  false,
])("reconciles a committed PUT with a lost response (immediate read: %s)", async (immediate) => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const create = vi.spyOn(storage, "create");
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (url, body, options) => {
    await write(url, body, options);
    throw new StorageError("network", { url, method: "PUT" });
  });
  const read = vi.spyOn(storage, "readRdf");
  if (!immediate) read.mockRejectedValueOnce(new Error("Still offline"));
  const attempt = {};
  const first = repo.save(entry, undefined, { attempt });
  if (!immediate) await expect(first).rejects.toMatchObject({ code: "network" });
  const saved = await (immediate ? first : repo.save({ ...entry }, undefined, { attempt }));
  expect(saved).toMatchObject({ data: entry, unconfirmed: false });
  expect(create).toHaveBeenCalledOnce();
  expect((await repo.load()).records.map((record) => record.url)).toEqual([saved.url]);
});

it("refuses to overwrite or delete a reservation whose empty representation changed", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  await repo.load();
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
    ...(await read(...args)),
    etag: '"changed"',
  }));
  const write = vi.spyOn(storage, "write");
  const remove = vi.spyOn(storage, "delete");
  await expect(repo.save(entry)).rejects.toThrow(/reserve/);
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it("requires a strong ETag for in-place edits", async () => {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const repo = mediaRepository(storage, typeIndex(), verifiedFixture);
  const saved = await repo.save(entry);
  const write = vi.spyOn(storage, "write");
  await expect(repo.save({ ...entry, rating: 5 }, { ...saved, etag: "*" })).rejects.toThrow(
    /Reload/,
  );
  expect(write).not.toHaveBeenCalled();
});
