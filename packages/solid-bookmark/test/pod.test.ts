// AUTHORED-BY Codex (GPT-6.1 Sol)

import { parseRdf } from "@jeswr/fetch-rdf";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { parseBookmark } from "../src/bookmark.js";
import { createBookmarkRepository, createSolidBookmarkRepository } from "../src/pod.js";
import { BOOKMARK_CLASS } from "../src/vocab.js";

function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ protocol, root: "https://pod.example/owner/" });
  const index = { register: vi.fn(async () => undefined) };
  return {
    storage,
    index,
    repo: createBookmarkRepository({
      storage,
      index,
      profile: "https://pod.example/owner/profile#me",
    }),
  };
}
const fault = (code: "forbidden" | "conflict" | "not-found") =>
  new StorageError(code, { url: "https://pod.example/owner/", method: "HEAD" });

describe.each(["solid", "lws"] as const)("bookmark repository (%s)", (protocol) => {
  it("initialises once, registers a private container and performs conditional CRUD", async () => {
    const { repo, index, storage } = setup(protocol);
    await Promise.all([repo.initialize(), repo.initialize()]);
    expect(index.register).toHaveBeenCalledTimes(1);
    expect(index.register).toHaveBeenCalledWith(
      BOOKMARK_CLASS,
      { container: expect.any(String) },
      { index: "private" },
    );
    expect(await repo.list()).toEqual([]);
    const record = await repo.create({
      url: "https://example.org/",
      title: "First",
      tags: ["reading"],
    });
    expect(record.url.startsWith(storage.root)).toBe(true);
    expect(record.data.created).toBeInstanceOf(Date);
    expect((await repo.list())[0]?.data.title).toBe("First");
    const updated = await repo.update(record, {
      title: "Second",
      description: "Description",
      notes: "Notes",
      tags: ["weekend"],
      archived: true,
      url: "https://example.net/",
    });
    expect(updated.data).toMatchObject({
      title: "Second",
      archived: true,
      tags: ["weekend"],
      url: "https://example.net/",
    });
    expect(updated.data.modified).toBeInstanceOf(Date);
    await expect(repo.update(record, { title: "Stale" })).rejects.toMatchObject({
      code: "precondition-failed",
    });
    await expect(repo.remove(record)).rejects.toMatchObject({ code: "precondition-failed" });
    await repo.remove(updated);
    expect(await repo.list()).toEqual([]);
  });
  it("validates URLs before writing and carries explicit creation dates", async () => {
    const { repo } = setup(protocol);
    await expect(repo.create({ url: "javascript:x" })).rejects.toThrow(TypeError);
    const record = await repo.create({ url: "https://example.org/", created: new Date(0) });
    await expect(repo.update(record, { url: "file:///x" })).rejects.toThrow(TypeError);
    expect((await repo.list())[0]?.data.created).toEqual(new Date(0));
  });
});
it("preserves unrelated RDF and unprofiled text on edits", async () => {
  const { storage, repo } = setup();
  const record = await repo.create({ url: "https://example.org/", title: "Initial" });
  const dataset = await parseRdf(
    `<${record.url}#it> <https://example.org/extra> "untouched". <${record.url}#else> <https://example.org/note> "also kept".`,
    "text/turtle",
  );
  const original = await storage.readRdf(record.url);
  for (const quad of original.dataset) dataset.add(quad);
  await storage.writeRdf(record.url, dataset, { ifMatch: original.etag as string });
  const current = (await repo.list())[0];
  if (!current) throw new Error("Missing fixture");
  await repo.update(current, { title: "Edited", notes: "" });
  const result = await storage.readRdf(record.url);
  for (const quad of dataset)
    if (quad.predicate.value.startsWith("https://example.org/"))
      expect(result.dataset.has(quad)).toBe(true);
});
it("retries failed initialisation and never treats denied storage as absent", async () => {
  const { storage, index } = setup();
  const head = vi.spyOn(storage, "head").mockRejectedValueOnce(fault("forbidden"));
  const create = vi.spyOn(storage, "create");
  const repo = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await expect(repo.initialize()).rejects.toMatchObject({ code: "forbidden" });
  expect(create).not.toHaveBeenCalled();
  await repo.initialize();
  expect(head).toHaveBeenCalled();
  expect(index.register).toHaveBeenCalledTimes(1);
});
it("reuses an existing container and recovers a concurrent exact-name create", async () => {
  const { storage, index } = setup();
  await storage.create(storage.root, null, { kind: "container", name: "bookmarks" });
  vi.spyOn(storage, "head").mockRejectedValueOnce(fault("not-found"));
  const repo = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await repo.initialize();
  expect(index.register).toHaveBeenCalledTimes(1);
  const second = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await second.initialize();
  expect(await second.list()).toEqual([]);
});
it("propagates unexpected create and registration failures", async () => {
  const { storage, index } = setup();
  vi.spyOn(storage, "create").mockRejectedValueOnce(fault("forbidden"));
  const repo = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await expect(repo.initialize()).rejects.toMatchObject({ code: "forbidden" });
  index.register.mockRejectedValueOnce(new Error("No index permission"));
  await expect(repo.initialize()).rejects.toThrow("No index permission");
  await repo.initialize();
});
it("skips non-RDF files, empty resources, containers and resources deleted during a read", async () => {
  const { storage, repo } = setup();
  await repo.initialize();
  const base = new URL("bookmarks/", storage.root).href;
  await storage.create(base, null, { name: "folder", kind: "container" });
  await storage.create(base, "hello", { name: "plain.txt", contentType: "text/plain" });
  await storage.create(base, "", { name: "empty.ttl", contentType: "text/turtle" });
  const removed = await repo.create({ url: "https://example.org/" });
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementation((url) =>
    url === removed.url ? Promise.reject(fault("not-found")) : read(url),
  );
  expect(await repo.list()).toEqual([]);
  vi.spyOn(storage, "readRdf").mockRejectedValue(fault("forbidden"));
  await expect(repo.list()).rejects.toMatchObject({ code: "forbidden" });
});
it("refuses editing resources without a validator or bookmark identity", async () => {
  const { storage, repo } = setup();
  const record = await repo.create({ url: "https://example.org/" });
  const read = await storage.readRdf(record.url);
  await expect(repo.update({ ...record, etag: null }, { title: "x" })).rejects.toThrow("version");
  vi.spyOn(storage, "readRdf").mockResolvedValueOnce({
    ...read,
    dataset: await parseRdf("", "text/turtle"),
  });
  await expect(repo.update(record, {})).rejects.toThrow("no longer a bookmark");
});
it("provides an explicit Solid factory and propagates access failures", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  const repo = createSolidBookmarkRepository({
    fetch,
    storageRoot: "https://pod.example/",
    profile: "https://pod.example/profile#me",
  });
  await expect(repo.initialize()).rejects.toMatchObject({ code: "forbidden" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects unsafe or unverifiable creates and deletes", async () => {
  const { repo, storage } = setup();
  const record = await repo.create({ url: "https://example.org/" });
  await expect(repo.remove({ ...record, etag: null })).rejects.toThrow("version");
  const fresh = await storage.read(record.url);
  vi.spyOn(storage, "read").mockResolvedValueOnce({
    ...fresh,
    bytes: async () => new Uint8Array([1]),
  });
  await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("no longer empty");
  vi.spyOn(storage, "read").mockResolvedValueOnce({
    ...fresh,
    bytes: async () => new Uint8Array(),
    etag: null,
  });
  await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("version");
});
it("requires a refresh if a write result has only a follow-up validator", async () => {
  const { repo, storage } = setup();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => ({
    ...(await write(...args)),
    etagSource: "follow-up",
  }));
  const created = await repo.create({ url: "https://example.org/" });
  expect(created.etag).toBeNull();
  await expect(repo.update(created, { title: "unsafe" })).rejects.toThrow("version");
  const current = (await repo.list())[0];
  if (!current) throw new Error("Missing fixture");
  const writeRdf = storage.writeRdf.bind(storage);
  vi.spyOn(storage, "writeRdf").mockImplementation(async (...args) => ({
    ...(await writeRdf(...args)),
    etagSource: "follow-up",
  }));
  expect((await repo.update(current, { title: "safe" })).etag).toBeNull();
});
it("forwards LWS class hints and refuses silently truncated collections", async () => {
  const { storage } = setup("lws");
  const index = {
    register: vi.fn(async () => ({ links: [{ rel: "type", target: BOOKMARK_CLASS }] })),
  };
  const repo = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await repo.initialize();
  const create = vi.spyOn(storage, "create");
  await repo.create({ url: "https://example.org/" });
  expect(create.mock.calls[0]?.[2]?.links).toEqual([{ rel: "type", target: BOOKMARK_CLASS }]);
  const entry = (await storage.list(storage.root)).items[0];
  if (!entry) throw new Error("Missing container");
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    for (let i = 0; i <= 5000; i++) yield { ...entry, kind: "container" };
  });
  await expect(repo.list()).rejects.toThrow("5,000");
});
it("does not claim compatibility with Pod Manager's distinct W3C ontology", async () => {
  const url = "https://pod.example/bookmarks/legacy.ttl";
  const dataset = await parseRdf(
    `<${url}#it> a <http://www.w3.org/2002/01/bookmark#Bookmark>; <http://www.w3.org/2002/01/bookmark#recalls> <https://example.org/>.`,
    "text/turtle",
  );
  expect(parseBookmark(url, dataset)).toBeUndefined();
});
