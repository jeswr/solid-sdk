// AUTHORED-BY Codex GPT-6.1-Sol
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createIndexedDbCache, createMemoryCache } from "./cache.js";
import { parseLwsDescription } from "./lws-description.js";
import { sparqLwsCid } from "./testing.js";
import type { DescriptionCache } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const description = parseLwsDescription(sparqLwsCid, sparqLwsCid.id, "https://lws.example/data");
const record = {
  description,
  probe: { url: description.root, observedAt: 42, acceptPatch: ["text/n3"], evidence: [] },
};

describe.each([
  ["memory", () => createMemoryCache()],
  [
    "IndexedDB",
    () => {
      vi.stubGlobal("indexedDB", new IDBFactory());
      return createIndexedDbCache();
    },
  ],
] as const)("%s cache contract", (_name, makeCache) => {
  test("round-trips descriptions and probes, overwrites and deletes records", async () => {
    const cache: DescriptionCache = makeCache();
    expect(await cache.get(description.id)).toBeUndefined();
    await cache.set(description.id, record);
    expect(await cache.get(description.id)).toEqual(record);
    await cache.set(description.id, { description });
    expect(await cache.get(description.id)).toEqual({ description });
    await cache.delete(description.id);
    expect(await cache.get(description.id)).toBeUndefined();
    await cache.delete(description.id);
  });

  test("copies metadata on both writes and reads", async () => {
    const cache = makeCache();
    const original = structuredClone(record);
    await cache.set(description.id, original);
    original.description.etag = "changed";
    const first = await cache.get(description.id);
    expect(first).toEqual(record);
    if (!first) throw new Error("Missing record");
    first.description.etag = "changed again";
    expect(await cache.get(description.id)).toEqual(record);
  });

  test("uses longest normalised prefixes with path boundaries and origin isolation", async () => {
    const cache = makeCache();
    expect(await cache.lookupPrefix("https://pod.example/a")).toBeUndefined();
    await cache.rememberPrefix("https://POD.example:443/", "origin");
    await cache.rememberPrefix("https://pod.example/alice", "alice");
    await cache.rememberPrefix("https://pod.example/alice/private/?a=1#x", "private");
    expect(await cache.lookupPrefix("https://pod.example/alice")).toBe("alice");
    expect(await cache.lookupPrefix("https://pod.example/alice/file?x=1#y")).toBe("alice");
    expect(await cache.lookupPrefix("https://pod.example/alice/private/file")).toBe("private");
    expect(await cache.lookupPrefix("https://pod.example/alice-other/file")).toBe("origin");
    expect(await cache.lookupPrefix("http://pod.example/alice/file")).toBeUndefined();
    expect(await cache.lookupPrefix("https://pod.example:444/alice/file")).toBeUndefined();
    expect(await cache.lookupPrefix("https://other.example/alice/file")).toBeUndefined();
    await cache.rememberPrefix("https://pod.example/alice", "new-alice");
    expect(await cache.lookupPrefix("https://pod.example/alice/file")).toBe("new-alice");
  });
});

test("memory cache instances are isolated", async () => {
  const cache = createMemoryCache();
  await cache.set(description.id, record);
  expect(await createMemoryCache().get(description.id)).toBeUndefined();
});

test("IndexedDB persists across instances and isolates database names", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const first = createIndexedDbCache({ dbName: "public-metadata" });
  await first.set(description.id, record);
  await first.rememberPrefix(description.root, description.id);
  const reopened = createIndexedDbCache({ dbName: "public-metadata" });
  expect(await reopened.get(description.id)).toEqual(record);
  expect(await reopened.lookupPrefix(`${description.root}file`)).toBe(description.id);
  expect(await createIndexedDbCache({ dbName: "other" }).get(description.id)).toBeUndefined();
});

test("IndexedDB rejects open failures and synchronous transaction failures", async () => {
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  await new Promise<void>((resolve, reject) => {
    const request = factory.open("newer", 2);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  await expect(createIndexedDbCache({ dbName: "newer" }).get(description.id)).rejects.toMatchObject(
    {
      name: "VersionError",
    },
  );
  const cache = createIndexedDbCache();
  await expect(
    cache.set(description.id, {
      description: { ...description, capabilities: [{ type: [], extra: { invalid: () => 1 } }] },
    }),
  ).rejects.toMatchObject({ name: "DataCloneError" });
  expect(await cache.get(description.id)).toBeUndefined();
});

test("IndexedDB rejects aborted transactions", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const cache = createIndexedDbCache();
  await cache.set(description.id, record);
  const original = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (key) {
    const request = original.call(this, key);
    this.transaction.abort();
    return request;
  });
  await expect(cache.get(description.id)).rejects.toThrow("IndexedDB transaction aborted");
});
