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
    await store.compact(loaded[0]?.update as Uint8Array, loaded);
    expect(await entries(storage, container)).toHaveLength(2);
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

it("rejects truncated versioned headers", () => {
  expect(() => decodeRecord(new TextEncoder().encode("JYU1broken"), `${ROOT}x`)).toThrow(
    /truncated/,
  );
});
