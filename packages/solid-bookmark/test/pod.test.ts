// AUTHORED-BY Codex (GPT-6.1 Sol)

import { parseRdf } from "@jeswr/fetch-rdf";
import { StorageError, type StorageErrorCode } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { parseBookmark } from "../src/bookmark.js";
import { httpIriOrUndefined } from "../src/iri.js";
import { createBookmarkRepository } from "../src/pod.js";
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

describe.each(["solid", "lws"] as const)("partial reads and registration (%s)", (protocol) => {
  it.each([
    "forbidden",
    "server",
    "network",
    "invalid-response",
  ] as StorageErrorCode[])("keeps healthy siblings after a child %s failure", async (code) => {
    const { storage, repo } = setup(protocol);
    const good = await repo.create({ url: "https://example.org/good" });
    const bad = await repo.create({ url: "https://example.org/bad" });
    const read = storage.readRdf.bind(storage);
    vi.spyOn(storage, "readRdf").mockImplementation((url) =>
      url === bad.url
        ? Promise.reject(
            new StorageError(code, {
              url,
              method: "GET",
              status: code === "forbidden" ? 403 : code === "server" ? 500 : null,
            }),
          )
        : read(url),
    );
    expect(await repo.list()).toEqual({
      items: [expect.objectContaining({ url: good.url })],
      skipped: [{ url: bad.url, reason: code }],
    });
  });
  it("fails the whole listing and stops reading when a child requires sign-in", async () => {
    const { storage, repo } = setup(protocol);
    await repo.create({ url: "https://example.org/one" });
    await repo.create({ url: "https://example.org/two" });
    await repo.create({ url: "https://example.org/three" });
    const entries = (await storage.list(new URL("bookmarks/", storage.root).href)).items;
    const blocked = entries[1];
    if (!blocked) throw new Error("Missing fixture");
    const expired = new StorageError("unauthenticated", { url: blocked.url, method: "GET" });
    const read = storage.readRdf.bind(storage);
    const reads = vi
      .spyOn(storage, "readRdf")
      .mockImplementation((url) => (url === blocked.url ? Promise.reject(expired) : read(url)));
    await expect(repo.list()).rejects.toBe(expired);
    expect(reads.mock.calls.map(([url]) => url)).toEqual(entries.slice(0, 2).map(({ url }) => url));
  });
  it.each([
    0, 1,
  ])("stops at a rate-limited child after %i reads and marks the listing incomplete", async (position) => {
    const { storage, repo } = setup(protocol);
    await repo.create({ url: "https://example.org/one" });
    await repo.create({ url: "https://example.org/two" });
    await repo.create({ url: "https://example.org/three" });
    const entries = (await storage.list(new URL("bookmarks/", storage.root).href)).items;
    const limited = entries[position]?.url;
    if (!limited) throw new Error("Missing fixture");
    const read = storage.readRdf.bind(storage);
    const reads = vi
      .spyOn(storage, "readRdf")
      .mockImplementation((url) =>
        url === limited
          ? Promise.reject(new StorageError("rate-limited", { url, method: "GET", status: 429 }))
          : read(url),
      );
    const listing = await repo.list();
    expect(listing.items.map(({ url }) => url)).toEqual(
      entries.slice(0, position).map(({ url }) => url),
    );
    expect(listing.skipped).toEqual([{ url: limited, reason: "rate-limited" }]);
    expect(reads.mock.calls.map(([url]) => url)).toEqual(
      entries.slice(0, position + 1).map(({ url }) => url),
    );
  });
  it("keeps the container usable when registration fails and retries only once later", async () => {
    const { repo, index } = setup(protocol);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    index.register.mockRejectedValue(new Error("secret-profile-token"));
    try {
      await Promise.all([repo.initialize(), repo.initialize()]);
      expect(index.register).toHaveBeenCalledTimes(1);
      expect(repo.registration).toBe("failed");
      const record = await repo.create({ url: "https://example.org/" });
      expect(index.register).toHaveBeenCalledTimes(2);
      expect((await repo.list()).items[0]?.url).toBe(record.url);
      await repo.initialize();
      expect(index.register).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith("Bookmark Type Index registration failed", {
        reason: "unknown",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-profile-token");
    } finally {
      warn.mockRestore();
    }
  });
  it("recovers registration on a later initialise, including concurrent callers", async () => {
    const { repo, index } = setup(protocol);
    index.register.mockRejectedValueOnce(fault("forbidden"));
    await repo.initialize();
    expect(repo.registration).toBe("failed");
    await Promise.all([repo.initialize(), repo.initialize()]);
    expect(index.register).toHaveBeenCalledTimes(2);
    expect(repo.registration).toBe("registered");
  });
  it("reports an unexpected child parser failure without exposing its message", async () => {
    const { repo, storage } = setup(protocol);
    const record = await repo.create({ url: "https://example.org/" });
    vi.spyOn(storage, "readRdf").mockRejectedValueOnce(new Error("Untrusted private response"));
    expect(await repo.list()).toEqual({
      items: [],
      skipped: [{ url: record.url, reason: "unknown" }],
    });
  });
  it("still fails a container listing without returning a partial collection", async () => {
    const { repo, storage } = setup(protocol);
    await repo.create({ url: "https://example.org/" });
    const entry = (await storage.list(new URL("bookmarks/", storage.root).href)).items[0];
    if (!entry) throw new Error("Missing fixture");
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      yield entry;
      throw fault("forbidden");
    });
    await expect(repo.list()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("failed create cleanup", () => {
  it("removes an empty orphan after a failed PUT using its freshly read ETag", async () => {
    const { repo, storage } = setup();
    await repo.initialize();
    const remove = vi.spyOn(storage, "delete");
    vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("Lost PUT"));
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("Lost PUT");
    expect(remove).toHaveBeenCalledWith(expect.any(String), { ifMatch: expect.any(String) });
    expect((await repo.list()).items).toEqual([]);
    const page = await storage.list(new URL("bookmarks/", storage.root).href);
    expect(page.items).toEqual([]);
  });
  it("cleans up after an initial read lacks an ETag if a fresh validator can be obtained", async () => {
    const { repo, storage } = setup();
    await repo.initialize();
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
      ...(await read(...args)),
      etag: null,
    }));
    const remove = vi.spyOn(storage, "delete");
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("version");
    expect(remove).toHaveBeenCalledOnce();
  });
  it("keeps a committed bookmark when the PUT response was lost", async () => {
    const { repo, storage } = setup();
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
      await write(...args);
      throw new Error("Lost response");
    });
    const remove = vi.spyOn(storage, "delete");
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("Lost response");
    expect(remove).not.toHaveBeenCalled();
    expect((await repo.list()).items).toHaveLength(1);
  });
  it("never deletes concurrently changed data or replaces the original error on cleanup failure", async () => {
    const { repo, storage } = setup();
    const remove = vi.spyOn(storage, "delete").mockRejectedValueOnce(fault("conflict"));
    vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("Original failure"));
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("Original failure");
    expect(remove).toHaveBeenCalledOnce();
    expect((await storage.list(new URL("bookmarks/", storage.root).href)).items).toHaveLength(1);
  });
  it("leaves an unverifiable empty resource alone", async () => {
    const { repo, storage } = setup();
    const create = storage.create.bind(storage);
    vi.spyOn(storage, "create").mockImplementation(async (...args) => ({
      ...(await create(...args)),
      etag: null,
    }));
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
      ...(await read(...args)),
      etag: null,
    }));
    const remove = vi.spyOn(storage, "delete");
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("version");
    expect(remove).not.toHaveBeenCalled();
  });
  it("can use the creation response validator when read responses omit ETags", async () => {
    const { repo, storage } = setup();
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (...args) => ({
      ...(await read(...args)),
      etag: null,
    }));
    const remove = vi.spyOn(storage, "delete");
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("version");
    expect(remove).toHaveBeenCalledOnce();
    expect((await storage.list(new URL("bookmarks/", storage.root).href)).items).toEqual([]);
  });
  it("uses the cleanup read's validator to preserve a concurrent write", async () => {
    const { repo, storage } = setup();
    const remove = storage.delete.bind(storage);
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("Failed PUT"));
    let orphan = "";
    vi.spyOn(storage, "delete").mockImplementationOnce(async (url, options) => {
      orphan = url;
      const fresh = await storage.read(url);
      await write(url, "Another writer's content", {
        contentType: "text/plain",
        ifMatch: fresh.etag as string,
      });
      return remove(url, options);
    });
    await expect(repo.create({ url: "https://example.org/" })).rejects.toThrow("Failed PUT");
    expect(await (await storage.read(orphan)).text()).toBe("Another writer's content");
  });
});

describe.each(["solid", "lws"] as const)("bookmark repository (%s)", (protocol) => {
  it.each([
    ["http://example.org", "http://example.org/"],
    ["  https://EXAMPLE.org:443/a/../b  ", "https://example.org/b"],
    ["HTTPS://example.org/a b", "https://example.org/a%20b"],
    ["https://example.org/a\n", "https://example.org/a"],
  ])("canonicalises create and update URLs: %s", async (input, canonical) => {
    const { repo } = setup(protocol);
    expect(httpIriOrUndefined(input)).toBe(canonical);
    const data = { url: input, title: "Original" };
    const record = await repo.create(data);
    expect(data.url).toBe(input);
    expect(record.data.url).toBe(canonical);
    expect((await repo.list()).items[0]?.data.url).toBe(canonical);
    const patch = { url: input, title: "Edited" };
    const updated = await repo.update(record, patch);
    expect(patch.url).toBe(input);
    expect(updated.data).toMatchObject({ url: canonical, title: "Edited" });
    expect((await repo.list()).items[0]?.data.url).toBe(canonical);
  });
  it.each([
    "",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///x",
    "mailto:a@example.org",
    "/relative",
    "//example.org/",
    "https:example.org",
    "https:/example.org",
    "ht\ntps://example.org/",
    "https://",
    "https://[invalid]/",
    "https://example.org/|unsafe",
    "https://exa mple.org/",
  ])("rejects guard-invalid create and update URLs before pod I/O: %s", async (url) => {
    const { repo, storage } = setup(protocol);
    const record = await repo.create({ url: "https://example.org/" });
    const create = vi.spyOn(storage, "create");
    const read = vi.spyOn(storage, "readRdf");
    const write = vi.spyOn(storage, "writeRdf");
    expect(httpIriOrUndefined(url)).toBeUndefined();
    await expect(repo.create({ url })).rejects.toThrow(TypeError);
    await expect(repo.update(record, { url })).rejects.toThrow(TypeError);
    expect(create).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it("initialises once, registers a private container and performs conditional CRUD", async () => {
    const { repo, index, storage } = setup(protocol);
    await Promise.all([repo.initialize(), repo.initialize()]);
    expect(index.register).toHaveBeenCalledTimes(1);
    expect(index.register).toHaveBeenCalledWith(
      BOOKMARK_CLASS,
      { container: expect.any(String) },
      { index: "private" },
    );
    expect((await repo.list()).items).toEqual([]);
    const record = await repo.create({
      url: "https://example.org/",
      title: "First",
      tags: ["reading"],
    });
    expect(record.url.startsWith(storage.root)).toBe(true);
    expect(record.data.created).toBeInstanceOf(Date);
    expect((await repo.list()).items[0]?.data.title).toBe("First");
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
    expect((await repo.list()).items).toEqual([]);
  });
  it("validates URLs before writing and carries explicit creation dates", async () => {
    const { repo } = setup(protocol);
    await expect(repo.create({ url: "javascript:x" })).rejects.toThrow(TypeError);
    const record = await repo.create({ url: "https://example.org/", created: new Date(0) });
    await expect(repo.update(record, { url: "file:///x" })).rejects.toThrow(TypeError);
    expect((await repo.list()).items[0]?.data.created).toEqual(new Date(0));
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
  const current = (await repo.list()).items[0];
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
  expect((await second.list()).items).toEqual([]);
});
it("propagates container failures but tolerates registration failures", async () => {
  const { storage, index } = setup();
  vi.spyOn(storage, "create").mockRejectedValueOnce(fault("forbidden"));
  const repo = createBookmarkRepository({
    storage,
    index,
    profile: "https://pod.example/owner/profile#me",
  });
  await expect(repo.initialize()).rejects.toMatchObject({ code: "forbidden" });
  index.register.mockRejectedValueOnce(new Error("No index permission"));
  await expect(repo.initialize()).resolves.toBeUndefined();
  expect(repo.registration).toBe("failed");
  await repo.initialize();
  expect(repo.registration).toBe("registered");
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
  expect((await repo.list()).items).toEqual([]);
  vi.spyOn(storage, "readRdf").mockRejectedValue(fault("forbidden"));
  expect((await repo.list()).items).toEqual([]);
  expect((await repo.list()).skipped).toEqual(
    expect.arrayContaining([{ url: removed.url, reason: "forbidden" }]),
  );
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
  const current = (await repo.list()).items[0];
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
