// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createRxDatabase } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { describe, expect, it, vi } from "vitest";
import { replicateSolid } from "./replication.js";
import { DOC_CONTENT_TYPE, keyToResourceName, META_RESOURCE_NAME, SolidDocStore } from "./store.js";

const ROOT = "https://memory.example/items/";

describe.each(["solid", "lws"] as const)("StorageClient adapter (%s)", (protocol) => {
  function fixture(storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 1 })) {
    const fetch = vi.fn<typeof globalThis.fetch>();
    return { storage, fetch, store: new SolidDocStore({ container: ROOT, storage, fetch }) };
  }

  it("round-trips documents, opaque RDF payloads and metadata through paginated listings", async () => {
    const { store, storage, fetch } = fixture();
    for (const key of ["a", "b", "space and 🔥", "meta.json"]) {
      expect(
        (await store.putDoc(keyToResourceName(key), JSON.stringify({ key }), DOC_CONTENT_TYPE)).ok,
      ).toBe(true);
      expect((await store.getDoc(keyToResourceName(key)))?.body).toBe(JSON.stringify({ key }));
    }
    await store.putDoc(META_RESOURCE_NAME, "{}", DOC_CONTENT_TYPE, { ifNoneMatch: "*" });
    await storage.create(ROOT, "foreign", { name: "foreign.txt", contentType: "text/plain" });
    await storage.create(ROOT, null, { name: "sub", kind: "container" });
    const urls = await store.listDocUrls();
    expect(urls).toHaveLength(4);
    expect(urls).toEqual([...urls].sort());
    const name = keyToResourceName("rdf");
    await store.putDoc(name, "<> <https://example/p> 1 .", "text/turtle");
    expect((await store.getDoc(name))?.contentType).toBe("text/turtle");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains create and stale-update conflict signals without clobbering bytes", async () => {
    const { store } = fixture();
    const name = keyToResourceName("a");
    expect((await store.putDoc(name, "one", DOC_CONTENT_TYPE, { ifNoneMatch: "*" })).ok).toBe(true);
    expect((await store.putDoc(name, "two", DOC_CONTENT_TYPE, { ifNoneMatch: "*" })).ok).toBe(
      false,
    );
    const current = await store.getDoc(name);
    expect(
      (await store.putDoc(name, "two", DOC_CONTENT_TYPE, { ifMatch: current?.etag as string })).ok,
    ).toBe(true);
    expect(
      (await store.putDoc(name, "stale", DOC_CONTENT_TYPE, { ifMatch: current?.etag as string }))
        .ok,
    ).toBe(false);
    expect((await store.getDoc(name))?.body).toBe("two");
  });

  it("observes an ETag before GC and keeps absence idempotent", async () => {
    const { storage, store } = fixture();
    const remove = vi.spyOn(storage, "delete");
    const name = keyToResourceName("a");
    await store.putDoc(name, "one", DOC_CONTENT_TYPE);
    const etag = (await store.getDoc(name))?.etag;
    await store.deleteDoc(name);
    expect(remove).toHaveBeenCalledWith(`${ROOT}${name}`, { ifMatch: etag });
    await store.deleteDoc(name);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await store.getDoc(name)).toBeNull();
  });

  it("bounds injected reads and refuses unsafe names before invoking storage", async () => {
    const { storage } = fixture();
    const store = new SolidDocStore({ container: ROOT, storage, maxResponseBytes: 3 });
    await store.putDoc(keyToResourceName("a"), "four", DOC_CONTENT_TYPE);
    await expect(store.getDoc(keyToResourceName("a"))).rejects.toThrow(/3-byte limit/);
    const read = vi.spyOn(storage, "read");
    await expect(store.getDoc("../escape")).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("fails closed without a delete validator and on a concurrent edit", async () => {
    const { storage, store } = fixture();
    const name = keyToResourceName("a");
    const url = store.docUrl("a");
    await store.putDoc(name, "one", DOC_CONTENT_TYPE);
    const head = storage.head.bind(storage);
    const remove = vi.spyOn(storage, "delete");
    vi.spyOn(storage, "head").mockImplementationOnce(async (target) => ({
      ...(await head(target)),
      etag: null,
    }));
    await expect(store.deleteDoc(name)).rejects.toThrow(/without an ETag/);
    expect(remove).not.toHaveBeenCalled();
    vi.spyOn(storage, "head").mockImplementationOnce(async (target) => {
      const result = await head(target);
      await storage.write(url, "new", {
        ifMatch: result.etag as string,
        contentType: DOC_CONTENT_TYPE,
      });
      return result;
    });
    await expect(store.deleteDoc(name)).rejects.toMatchObject({ status: 412 });
    expect((await store.getDoc(name))?.body).toBe("new");
  });

  it("replicates checkpoints, edits and tombstones through real RxDB collections", async () => {
    const { storage, fetch } = fixture();
    const schema = {
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: { id: { type: "string", maxLength: 100 }, title: { type: "string" } },
      required: ["id", "title"],
    } as const;
    async function database() {
      const db = await createRxDatabase({
        name: `adapter${Math.random().toString(36).slice(2)}`,
        storage: getRxStorageMemory(),
      });
      const { items } = await db.addCollections({ items: { schema } });
      return { db, items };
    }
    const a = await database();
    const b = await database();
    async function sync(items: typeof a.items) {
      const replication = replicateSolid({
        collection: items,
        container: ROOT,
        storage,
        live: false,
        batchSize: 1,
      });
      try {
        await replication.awaitInitialReplication();
      } finally {
        await replication.cancel();
      }
    }
    try {
      await a.items.insert({ id: "a", title: "first" });
      await a.items.insert({ id: "b", title: "second" });
      await sync(a.items);
      await sync(b.items);
      expect((await b.items.find().exec()).map((doc) => doc.id).sort()).toEqual(["a", "b"]);
      await (await a.items.findOne("a").exec())?.incrementalPatch({ title: "edited" });
      await (await a.items.findOne("b").exec())?.remove();
      await sync(a.items);
      await sync(b.items);
      expect((await b.items.find().exec()).map((doc) => doc.toJSON())).toEqual([
        { id: "a", title: "edited" },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await a.db.remove();
      await b.db.remove();
    }
  }, 10_000);
});

it("rejects a changed create URL instead of indexing an unreachable document", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root: ROOT });
  vi.spyOn(storage, "create").mockResolvedValueOnce({
    url: `${ROOT}opaque`,
    etag: '"e"',
    created: true,
  });
  const store = new SolidDocStore({ storage, container: ROOT });
  await expect(
    store.putDoc(keyToResourceName("a"), "x", DOC_CONTENT_TYPE, { ifNoneMatch: "*" }),
  ).rejects.toThrow(/preserve the document name/);
});

it("propagates failed listing pages instead of returning a partial result", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root: ROOT });
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    yield {
      url: `${ROOT}doc.a.json`,
      kind: "resource",
      size: null,
      contentType: null,
      modified: null,
      types: [],
    };
    throw new StorageError("network", { method: "GET", url: ROOT });
  });
  await expect(new SolidDocStore({ storage, container: ROOT }).listDocUrls()).rejects.toMatchObject(
    { code: "network" },
  );
});

it("keeps pod operations behind StorageClient's public interface", () => {
  for (const file of ["store.ts", "replication.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:this\.)?fetch\s*\(|from\s+["']@jeswr\/storage-client\//);
  }
});
