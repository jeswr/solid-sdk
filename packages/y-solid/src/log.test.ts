// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { SolidPersistence, YSolidProvider } from "./provider.js";
import { decodeRecord, encodeRecord } from "./record.js";
import { SolidUpdateStore, UPDATE_CONTENT_TYPE } from "./store.js";

const ROOT = "https://pod.example/";
const CONTENT = { contentType: UPDATE_CONTENT_TYPE };

async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 2 });
  const { url: container } = await storage.create(ROOT, null, { kind: "container", name: "doc" });
  const store = new SolidUpdateStore({ storage, container });
  return { storage, container, store };
}

function wire(kind: "update" | "snapshot", timestamp: bigint, random: number, payload: Uint8Array) {
  const { bytes } = encodeRecord(payload, kind);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(4, timestamp);
  view.setUint32(12, random);
  return bytes;
}

function state(text: string) {
  const doc = new Y.Doc();
  doc.getMap("m").set(text, text);
  return { doc, update: Y.encodeStateAsUpdate(doc) };
}

async function entries(storage: StorageClient, container: string) {
  const result = [];
  for await (const entry of storage.listAll(container)) result.push(entry);
  return result;
}

// Inspect retained data directly: public reads alone cannot detect payload retention.
function observations(store: SolidUpdateStore): ReadonlyMap<string, unknown> {
  return Reflect.get(store, "observed") as ReadonlyMap<string, unknown>;
}

describe.each(["solid", "lws"] as const)("%s log mode", (protocol) => {
  it("writes exact 16-byte network-order headers and unique create name hints", async () => {
    const { storage, container } = await setup(protocol);
    const create = vi.fn(storage.create);
    const store = new SolidUpdateStore({ storage: { ...storage, create }, container });
    const payload = new Uint8Array([255, 0, 128]);
    const { url } = await store.appendUpdate(payload);
    payload.fill(0);
    const bytes = await (await storage.read(url)).bytes();
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("JYU1");
    expect(bytes.length).toBe(19);
    expect(new DataView(bytes.buffer).getBigUint64(4)).toBeGreaterThan(0n);
    expect([...bytes.subarray(16)]).toEqual([255, 0, 128]);
    expect(create.mock.calls[0]?.[2]).toMatchObject({
      name: expect.stringMatching(/^\d{13}-[a-z2-7]{8}\.yupdate$/),
      ...CONTENT,
    });
    expect(await store.readUpdate(url)).toEqual(new Uint8Array([255, 0, 128]));
  });

  it("orders snapshots first, then unsigned header time/random, ignoring filenames", async () => {
    const { storage, container, store } = await setup(protocol);
    for (const [name, kind, time, random, value] of [
      ["000-first", "update", 10n, 9, 4],
      ["zzz-last", "snapshot", 99n, 1, 1],
      ["middle", "update", 10n, 2, 3],
      ["offline", "update", 1n, 0, 2],
      ["huge", "update", 0xffffffffffffffffn, 0, 5],
    ] as const) {
      await storage.create(container, wire(kind, time, random, new Uint8Array([value])), {
        ...CONTENT,
        name,
      });
    }
    expect((await store.loadUpdates()).map((r) => r.update[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("replays every concurrent snapshot and an older offline update", async () => {
    const { storage, container } = await setup(protocol);
    const a = state("snapshot-a");
    const b = state("snapshot-b");
    const late = state("late");
    await storage.create(container, wire("snapshot", 100n, 1, a.update), CONTENT);
    await storage.create(container, wire("snapshot", 200n, 1, b.update), CONTENT);
    await storage.create(container, wire("update", 1n, 1, late.update), CONTENT);
    const doc = new Y.Doc();
    const provider = new YSolidProvider({ doc, storage, container });
    await provider.whenSynced;
    expect(doc.getMap("m").toJSON()).toEqual({
      "snapshot-a": "snapshot-a",
      "snapshot-b": "snapshot-b",
      late: "late",
    });
    provider.destroy();
  });

  it("loads the legacy headerless name-ordered disk layout alongside new records", async () => {
    const { storage, container, store } = await setup(protocol);
    const old = state("legacy");
    const modern = state("modern");
    await storage.create(container, old.update, { ...CONTENT, name: "0001700000000000-uuid" });
    await store.appendUpdate(modern.update);
    const doc = new Y.Doc();
    const provider = new SolidPersistence({ doc, store });
    await provider.whenSynced;
    expect(doc.getMap("m").toJSON()).toEqual({ legacy: "legacy", modern: "modern" });
    provider.destroy();
  });

  it("re-lists after a listed member vanishes, including a replacement snapshot", async () => {
    const { storage, container, store } = await setup(protocol);
    const original = state("original");
    const first = await store.appendUpdate(original.update);
    const read = vi.fn(async (url: string, opts?: Parameters<StorageClient["read"]>[1]) => {
      if (url === first.url && read.mock.calls.length === 1) {
        const observed = await storage.read(url);
        await storage.create(container, wire("snapshot", 1n, 1, original.update), CONTENT);
        await storage.delete(url, { ifMatch: observed.etag as string });
      }
      return storage.read(url, opts);
    });
    const reader = new SolidUpdateStore({ storage: { ...storage, read }, container });
    const loaded = await reader.loadUpdates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.kind).toBe("snapshot");
    expect(loaded[0]?.update).toEqual(original.update);
  });

  it("confirms the snapshot before deleting exactly the read ETags, retaining concurrent appends", async () => {
    const { storage, container, store } = await setup(protocol);
    await store.appendUpdate(state("a").update);
    await store.appendUpdate(state("b").update);
    const loaded = await store.loadUpdates();
    const newcomer = await store.appendUpdate(state("late").update);
    const order: string[] = [];
    const create = vi.fn(async (...args: Parameters<StorageClient["create"]>) => {
      order.push("create");
      return storage.create(...args);
    });
    const del = vi.fn(async (...args: Parameters<StorageClient["delete"]>) => {
      order.push("delete");
      return storage.delete(...args);
    });
    const compactor = new SolidUpdateStore({
      storage: { ...storage, create, delete: del },
      container,
    });
    const result = await compactor.compact(Y.mergeUpdates(loaded.map((r) => r.update)), loaded);
    expect(order).toEqual(["create", "delete", "delete"]);
    expect(del.mock.calls).toEqual(loaded.map((r) => [r.url, { ifMatch: r.etag }]));
    expect(result.deletedUrls).toEqual(loaded.map((r) => r.url));
    expect(decodeRecord(await (await storage.read(result.url)).bytes(), result.url).kind).toBe(
      "snapshot",
    );
    expect((await entries(storage, container)).map((e) => e.url).sort()).toEqual(
      [newcomer.url, result.url].sort(),
    );
  });

  it.each([
    false,
    "throw",
  ])("retains all records when snapshot creation is unconfirmed (%s)", async (failure) => {
    const { storage, container, store } = await setup(protocol);
    await store.appendUpdate(state("safe").update);
    const loaded = await store.loadUpdates();
    const del = vi.fn(storage.delete);
    const compactor = new SolidUpdateStore({
      container,
      storage: {
        ...storage,
        delete: del,
        create: async () => {
          if (failure === "throw") throw new Error("offline");
          return { url: loaded[0]?.url as string, etag: null, created: false };
        },
      },
    });
    await expect(compactor.compact(loaded[0]?.update as Uint8Array, loaded)).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
    expect(await entries(storage, container)).toHaveLength(1);
  });

  it("never deletes a replacement at an obsolete URL", async () => {
    const { storage, container, store } = await setup(protocol);
    const { url } = await store.appendUpdate(state("old").update);
    const loaded = await store.loadUpdates();
    const changed = state("replacement");
    await storage.write(url, changed.update, { ...CONTENT, ifMatch: loaded[0]?.etag as string });
    await expect(store.compact(loaded[0]?.update as Uint8Array, loaded)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    expect(await store.readUpdate(url)).toEqual(changed.update);
    expect(await entries(storage, container)).toHaveLength(2);
  });

  it.each([
    null,
    'W/"weak"',
    "*",
  ])("retains originals without a strong read ETag (%s)", async (etag) => {
    const { storage, container, store } = await setup(protocol);
    await store.appendUpdate(state("keep").update);
    const loaded = (await store.loadUpdates()).map((r) => ({ ...r, etag }));
    const result = await store.compact(loaded[0]?.update as Uint8Array, loaded);
    expect(result.deletedUrls).toEqual([]);
    expect(await entries(storage, container)).toHaveLength(2);
  });

  it.each([404, 410])("reports folded records already absent at deletion (%s)", async (status) => {
    const { storage, container, store: writer } = await setup(protocol);
    await writer.appendUpdate(state("gone").update);
    const loaded = await writer.loadUpdates();
    const store = new SolidUpdateStore({
      container,
      storage: {
        ...storage,
        delete: async (url, options) => {
          await storage.delete(url, options);
          throw new StorageError("not-found", { url, method: "DELETE", status });
        },
      },
    });
    const result = await store.compact(loaded[0]?.update as Uint8Array, loaded);
    expect(result.deletedUrls).toEqual(loaded.map((r) => r.url));
    expect((await entries(storage, container)).map((e) => e.url)).toEqual([result.url]);
  });

  it.each([
    null,
    'W/"weak"',
    "*",
  ])("does not recount retained records after automatic compaction (%s)", async (etag) => {
    const { storage, container, store: writer } = await setup(protocol);
    const retained = new Set<string>();
    for (const key of ["a", "b"]) {
      retained.add((await writer.appendUpdate(state(key).update)).url);
    }
    await writer.appendUpdate(state("deletable").update);
    const read = vi.fn(async (...args: Parameters<StorageClient["read"]>) => {
      const result = await storage.read(...args);
      return { ...result, etag: retained.has(args[0]) ? etag : result.etag };
    });
    const store = new SolidUpdateStore({ storage: { ...storage, read }, container });
    const compact = vi.spyOn(store, "compact");
    const doc = new Y.Doc();
    const provider = new SolidPersistence({
      doc,
      store,
      compaction: { afterUpdates: 2, minIntervalMs: 0 },
    });
    try {
      await provider.whenSynced;
      const snapshot = await provider.compact();
      expect(snapshot).toBeDefined();
      expect(compact).toHaveBeenCalledOnce();
      expect((await entries(storage, container)).map((e) => e.url).sort()).toEqual(
        [...retained, snapshot?.url].sort(),
      );
      read.mockClear();
      for (let round = 0; round < 3; round++) {
        expect(await provider.sync()).toBe(0);
      }
      expect(read).not.toHaveBeenCalled();
      expect(compact).toHaveBeenCalledOnce();
      expect(await entries(storage, container)).toHaveLength(3);
      expect(doc.getMap("m").toJSON()).toEqual({ a: "a", b: "b", deletable: "deletable" });
    } finally {
      provider.destroy();
    }
  });

  it("keeps retained records first encountered during compaction known", async () => {
    const { storage, container, store: writer } = await setup(protocol);
    const store = new SolidUpdateStore({
      container,
      storage: {
        ...storage,
        read: async (...args) => ({ ...(await storage.read(...args)), etag: null }),
      },
    });
    const compact = vi.spyOn(store, "compact");
    const doc = new Y.Doc();
    const provider = new SolidPersistence({
      doc,
      store,
      compaction: { afterUpdates: 2, minIntervalMs: 0 },
    });
    try {
      await provider.whenSynced;
      await writer.appendUpdate(state("unseen-a").update);
      await writer.appendUpdate(state("unseen-b").update);
      expect(await provider.compact()).toBeDefined();
      expect(await provider.sync()).toBe(0);
      expect(compact).toHaveBeenCalledOnce();
      expect(await entries(storage, container)).toHaveLength(3);
      expect(doc.getMap("m").toJSON()).toEqual({ "unseen-a": "unseen-a", "unseen-b": "unseen-b" });
    } finally {
      provider.destroy();
    }
  });

  it("fails closed before synced after bounded disappearing-member rounds", async () => {
    const { storage, container, store } = await setup(protocol);
    await store.appendUpdate(state("lost").update);
    const listAll = vi.fn(storage.listAll);
    const broken = new SolidUpdateStore({
      container,
      maxLoadRounds: 3,
      storage: {
        ...storage,
        listAll,
        read: async (url) => {
          throw new StorageError("not-found", { method: "GET", url, status: 404 });
        },
      },
    });
    const provider = new SolidPersistence({ doc: new Y.Doc(), store: broken });
    await expect(provider.whenSynced).rejects.toThrow(/did not stabilise/);
    expect(listAll).toHaveBeenCalledTimes(3);
    expect(provider.synced).toBe(false);
    provider.destroy();
  });

  it("fails compaction without deleting a corrupt or partially decodable Yjs record", async () => {
    const { storage, container, store } = await setup(protocol);
    await store.appendUpdate(state("valid").update);
    await store.appendUpdate(new Uint8Array([255, 255, 255]));
    const doc = new Y.Doc();
    const provider = new SolidPersistence({ doc, store });
    await provider.whenSynced;
    await expect(provider.compact()).rejects.toThrow();
    expect(await entries(storage, container)).toHaveLength(2);
    expect(doc.getMap("m").toJSON()).toEqual({ valid: "valid" });
    provider.destroy();
  });

  it("converges under random client edits, flushes, syncs and concurrent compactions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.array(fc.record({ client: fc.nat(20), op: fc.nat(7), value: fc.nat(1000) }), {
          minLength: 20,
          maxLength: 70,
        }),
        async (count, operations) => {
          const { storage, container } = await setup(protocol);
          const allUpdates: Uint8Array[] = [];
          const docs = Array.from({ length: count }, () => new Y.Doc());
          for (const doc of docs) doc.on("update", (update: Uint8Array) => allUpdates.push(update));
          const providers = docs.map(
            (doc) => new YSolidProvider({ doc, storage, container, mode: "log" }),
          );
          try {
            await Promise.all(providers.map((p) => p.whenSynced));
            for (const operation of operations) {
              const index = operation.client % count;
              const provider = providers[index] as YSolidProvider;
              const text = (docs[index] as Y.Doc).getText("text");
              switch (operation.op) {
                case 0:
                case 1:
                  text.insert(operation.value % (text.length + 1), String(operation.value));
                  break;
                case 2:
                  if (text.length) text.delete(operation.value % text.length, 1);
                  break;
                case 3:
                  (docs[index] as Y.Doc)
                    .getMap("map")
                    .set(String(operation.value % 4), operation.value);
                  break;
                case 4:
                  await provider.flush();
                  break;
                case 5:
                  await provider.sync();
                  break;
                case 6:
                  await provider.compact();
                  break;
                case 7: {
                  const results = await Promise.allSettled(providers.map((p) => p.compact()));
                  for (const result of results) {
                    if (result.status === "rejected")
                      expect(result.reason).toMatchObject({ code: "precondition-failed" });
                  }
                }
              }
            }
            await Promise.all(providers.map((p) => p.flush()));
            await Promise.all(providers.map((p) => p.sync()));
            const expected = new Y.Doc();
            Y.applyUpdate(expected, Y.mergeUpdates(allUpdates));
            const fresh = new Y.Doc();
            const reader = new YSolidProvider({ doc: fresh, storage, container });
            try {
              await reader.whenSynced;
              for (const doc of [...docs, fresh]) {
                expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(expected));
                expect(doc.getText("text").toString()).toBe(expected.getText("text").toString());
                expect(doc.getMap("map").toJSON()).toEqual(expected.getMap("map").toJSON());
              }
            } finally {
              reader.destroy();
              expected.destroy();
              fresh.destroy();
            }
          } finally {
            for (const p of providers) p.destroy();
            for (const doc of docs) doc.destroy();
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe.each(["solid", "lws"] as const)("%s observation retention", (protocol) => {
  it("retains only URLs and first-read ETags, without decoded payloads", async () => {
    const { storage, store } = await setup(protocol);
    const { url } = await store.appendUpdate(new Uint8Array(1024));
    const record = await store.readStoredUpdate(url);
    expect(record?.update).toHaveLength(1024);
    await storage.write(url, new Uint8Array([1]), { ...CONTENT, ifMatch: record?.etag as string });
    expect(await store.readUpdate(url)).toEqual(new Uint8Array([1]));
    expect(observations(store)).toEqual(new Map([[url, { url, etag: record?.etag }]]));
  });

  it("prunes historical observations across another client's repeated compactions", async () => {
    const { storage, container, store: writer } = await setup(protocol);
    const reader = new SolidUpdateStore({ storage, container });
    const known = new Set<string>();
    for (let round = 0; round < 3; round++) {
      await writer.appendUpdate(state(`round-${round}`).update);
      for (const record of await reader.loadUpdates(known)) known.add(record.url);
      const loaded = await writer.loadUpdates();
      const snapshot = await writer.compact(Y.mergeUpdates(loaded.map((r) => r.update)), loaded);
      const fresh = await reader.loadUpdates(known);
      expect(fresh.map((r) => r.url)).toEqual([snapshot.url]);
      expect(observations(reader)).toEqual(
        new Map([[snapshot.url, { url: snapshot.url, etag: fresh[0]?.etag }]]),
      );
      known.add(snapshot.url);
    }
  });

  it.each([
    "readUpdate",
    "deleteUpdate",
    "compact",
  ] as const)("forgets a resource retired by another client when %s confirms it is missing", async (operation) => {
    const { storage, store } = await setup(protocol);
    const { url } = await store.appendUpdate(state("retired").update);
    const record = await store.readStoredUpdate(url);
    await storage.delete(url, { ifMatch: record?.etag as string });
    if (operation === "compact") {
      const result = await store.compact(record?.update as Uint8Array, [url]);
      expect(result.deletedUrls).toEqual([url]);
    } else await store[operation](url);
    expect(observations(store).size).toBe(0);
  });

  it.each([
    "read",
    "delete",
  ] as const)("forgets observations after a 410 on %s", async (operation) => {
    const { storage, container } = await setup(protocol);
    const request = vi.fn(storage[operation]);
    const store = new SolidUpdateStore({
      storage: { ...storage, [operation]: request },
      container,
    });
    const { url } = await store.appendUpdate(state("gone").update);
    await store.readUpdate(url);
    request.mockRejectedValueOnce(
      new StorageError("not-found", { url, method: operation, status: 410 }),
    );
    if (operation === "read") expect(await store.readUpdate(url)).toBeNull();
    else await store.deleteUpdate(url);
    expect(observations(store).size).toBe(0);
  });

  it.each([
    null,
    404,
    410,
  ])("prunes all observations after an empty or missing listing (%s)", async (status) => {
    const { storage, container } = await setup(protocol);
    const listAll = vi.fn(storage.listAll);
    const store = new SolidUpdateStore({ storage: { ...storage, listAll }, container });
    const { url } = await store.appendUpdate(state("retired").update);
    const record = await store.readStoredUpdate(url);
    await storage.delete(url, { ifMatch: record?.etag as string });
    if (status !== null) {
      listAll.mockImplementation(async function* () {
        yield* storage.listAll(container);
        throw new StorageError("not-found", { url: container, method: "GET", status });
      });
    }
    expect(await store.listUpdateUrls()).toEqual([]);
    expect(observations(store).size).toBe(0);
  });

  it("keeps observations when a partial listing fails", async () => {
    const { storage, container } = await setup(protocol);
    const listAll = vi.fn(storage.listAll);
    const store = new SolidUpdateStore({ storage: { ...storage, listAll }, container });
    await store.appendUpdate(state("first").update);
    await store.appendUpdate(state("second").update);
    await store.loadUpdates();
    const before = new Map(observations(store));
    listAll.mockImplementation(async function* () {
      for await (const entry of storage.listAll(container)) {
        yield entry;
        throw new StorageError("not-found", { url: container, method: "GET", status: 404 });
      }
    });
    await expect(store.listUpdateUrls()).rejects.toMatchObject({ code: "not-found" });
    expect(observations(store)).toEqual(before);
  });

  it("keeps observations first read during an in-flight listing", async () => {
    const { storage, container, store: writer } = await setup(protocol);
    const listAll = vi.fn(storage.listAll);
    const reader = new SolidUpdateStore({ storage: { ...storage, listAll }, container });
    const update = state("concurrent").update;
    let appended = "";
    listAll.mockImplementation(async function* () {
      yield* storage.listAll(container);
      const { url } = await writer.appendUpdate(update);
      appended = url;
      await reader.readUpdate(url);
    });
    expect(await reader.listUpdateUrls()).toEqual([]);
    expect(observations(reader).has(appended)).toBe(true);
    await expect(reader.compact(update, [appended])).resolves.toHaveProperty("url");
    expect(observations(reader).size).toBe(0);
  });
});

it("rejects truncated versioned headers", () => {
  expect(() => decodeRecord(new TextEncoder().encode("JYU1broken"), `${ROOT}x`)).toThrow(
    /truncated/,
  );
});

it("uses opaque LWS container and server resource URLs, verifying logical membership", async () => {
  const memory = createMemoryStorage({ protocol: "lws", root: ROOT });
  const { url: backingContainer } = await memory.create(ROOT, null, {
    kind: "container",
    name: "backing",
  });
  const container = `${ROOT}opaque-container`;
  const outward = new Map<string, string>();
  const inward = new Map<string, string>();
  const storage: StorageClient = {
    ...memory,
    create: async (target, body, opts) => {
      expect(target).toBe(container);
      const result = await memory.create(backingContainer, body, opts);
      const url = `${ROOT}server-id-${outward.size}`;
      outward.set(result.url, url);
      inward.set(url, result.url);
      return { ...result, url };
    },
    listAll: async function* (target) {
      expect(target).toBe(container);
      for await (const entry of memory.listAll(backingContainer)) {
        yield { ...entry, url: outward.get(entry.url) as string };
      }
    },
    read: async (url, opts) => {
      const result = await memory.read(inward.get(url) ?? url, opts);
      return { ...result, url, parent: inward.has(url) ? container : ROOT };
    },
    parentOf: async (url) => (inward.has(url) ? container : ROOT),
    delete: (url, opts) => memory.delete(inward.get(url) ?? url, opts),
  };
  const store = new SolidUpdateStore({ storage, container });
  expect(store.container).toBe(container);
  const a = await store.appendUpdate(state("opaque").update);
  const b = await store.appendUpdate(state("other").update);
  expect(a.url).toBe(`${ROOT}server-id-0`);
  expect(a.url.startsWith(container)).toBe(false);
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, store });
  await provider.whenSynced;
  expect(doc.getMap("m").toJSON()).toEqual({ opaque: "opaque", other: "other" });
  await provider.compact();
  expect(await store.listUpdateUrls()).toHaveLength(1);
  await expect(store.readUpdate(`${ROOT}unrelated`)).rejects.toThrow(/not a member/);
  await store.deleteUpdate(b.url); // Already removed by compaction.
  provider.destroy();
});

it("retains the original ETag for legacy URL-array compaction across later reads", async () => {
  const { storage, store } = await setup();
  const first = await store.appendUpdate(state("first").update);
  const original = await store.loadUpdates();
  await storage.write(first.url, state("replacement").update, {
    ...CONTENT,
    ifMatch: original[0]?.etag as string,
  });
  await store.readUpdate(first.url); // Must not upgrade the earlier merge's deletion validator.
  await expect(store.compact(original[0]?.update as Uint8Array, [first.url])).rejects.toMatchObject(
    { code: "precondition-failed" },
  );
});

it("fails on a missing pagination page instead of treating a partial listing as empty", async () => {
  const { storage, container, store } = await setup();
  await store.appendUpdate(state("entry").update);
  const broken = new SolidUpdateStore({
    container,
    storage: {
      ...storage,
      listAll: async function* (target) {
        yield* storage.listAll(target);
        throw new StorageError("not-found", { url: target, method: "GET", status: 404 });
      },
    },
  });
  await expect(broken.loadUpdates()).rejects.toMatchObject({ code: "not-found" });
});

it("refuses a foreign snapshot create result before any deletion", async () => {
  const { storage, container, store } = await setup();
  await store.appendUpdate(state("safe").update);
  const loaded = await store.loadUpdates();
  const del = vi.fn(storage.delete);
  const hostile = new SolidUpdateStore({
    container,
    storage: {
      ...storage,
      delete: del,
      create: async () => ({ created: true, etag: '"x"', url: "https://evil.example/stolen" }),
    },
  });
  await expect(hostile.compact(loaded[0]?.update as Uint8Array, loaded)).rejects.toThrow(/escapes/);
  expect(del).not.toHaveBeenCalled();
});

it("refuses to replace readable originals with a snapshot exceeding the read cap", async () => {
  const { storage, container, store } = await setup();
  await store.appendUpdate(new Uint8Array([1]));
  await store.appendUpdate(new Uint8Array([2]));
  const loaded = await store.loadUpdates();
  const create = vi.fn(storage.create);
  const del = vi.fn(storage.delete);
  const compactor = new SolidUpdateStore({
    container,
    maxUpdateBytes: 24,
    storage: { ...storage, create, delete: del },
  });
  await expect(compactor.compact(new Uint8Array(9), loaded)).rejects.toThrow(
    /snapshot exceeds max size/,
  );
  expect(create).not.toHaveBeenCalled();
  expect(del).not.toHaveBeenCalled();
  expect(await entries(storage, container)).toHaveLength(2);
});
