// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../src/apps/notes/lib/model/note";
import {
  createIndexedDbFiredStore,
  createMemoryFiredStore,
  MAX_FIRED_REMINDERS,
} from "../src/apps/notes/lib/reminders/fired-store";
import { createReminderScheduler } from "../src/apps/notes/lib/reminders/scheduler";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const NOW = Date.parse("2026-11-11T12:00:00Z");
const DAY = 86_400_000;
const due: Note = {
  url: "https://pod.example/notes/reminder.ttl",
  title: "Remember",
  body: "",
  labels: [],
  format: "text/html",
  revisions: [],
  location: "active",
  reminder: new Date(NOW).toISOString(),
};

async function history(factory: IDBFactory, seed?: [string, number][]) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("suite.notes.reminders", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return new Promise<[string, number][]>((resolve, reject) => {
    const tx = db.transaction("firedReminders", "readwrite");
    const store = tx.objectStore("firedReminders");
    if (seed) store.put(seed, "alice");
    const read = store.get("alice");
    tx.oncomplete = () => {
      db.close();
      resolve(read.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

describe("Notes atomic fired claims", () => {
  it("serializes two independent schedulers sharing IndexedDB and survives reload", async () => {
    const factory = new IDBFactory();
    const notify = vi.fn();
    const first = createReminderScheduler({
      fired: createIndexedDbFiredStore("alice", factory),
      notify,
    });
    const second = createReminderScheduler({
      fired: createIndexedDbFiredStore("alice", factory),
      notify,
    });
    await Promise.all([first.tick([due], NOW - 1), second.tick([due], NOW - 1)]);
    expect(notify).not.toHaveBeenCalled();
    await Promise.all([first.tick([due], NOW), second.tick([due], NOW)]);
    expect(notify).toHaveBeenCalledExactlyOnceWith(due);
    await second.tick([due], NOW, false);
    const reloaded = createReminderScheduler({
      fired: createIndexedDbFiredStore("alice", factory),
      notify,
    });
    await reloaded.tick([due], NOW);
    expect(notify).toHaveBeenCalledTimes(1);
    await createReminderScheduler({
      fired: createIndexedDbFiredStore("bob", factory),
      notify,
    }).tick([due], NOW);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(await history(factory)).toHaveLength(1);
  });

  it("merges distinct concurrent claims without overwriting the other tab's history", async () => {
    const factory = new IDBFactory();
    const a = createIndexedDbFiredStore("alice", factory);
    const b = createIndexedDbFiredStore("alice", factory);
    expect(await Promise.all([a.claim("one", NOW), b.claim("two", NOW)])).toEqual([true, true]);
    expect(await a.claim("two", NOW)).toBe(false);
    expect(await b.claim("one", NOW)).toBe(false);
    expect(await history(factory)).toEqual([
      ["one", NOW],
      ["two", NOW],
    ]);
  });

  it("preserves newer claims when concurrent tick times oppose transaction order", async () => {
    const factory = new IDBFactory();
    const a = createIndexedDbFiredStore("alice", factory);
    const b = createIndexedDbFiredStore("alice", factory);
    const newer = b.claim("same", NOW + 1);
    const older = a.claim("same", NOW);
    expect(await Promise.all([newer, older])).toEqual([true, false]);
    expect(await history(factory)).toEqual([["same", NOW + 1]]);
    expect(await a.claim("different", NOW)).toBe(true);
    expect(await b.claim("same", NOW)).toBe(false);
  });

  it("prunes expired claims, retains future claims and bounds each account's stored history", async () => {
    const factory = new IDBFactory();
    const store = createIndexedDbFiredStore("alice", factory);
    await store.claim("initial", NOW);
    await history(factory, [
      ...Array.from({ length: MAX_FIRED_REMINDERS + 3 }, (_, index): [string, number] => [
        `key-${index}`,
        NOW - index - 1,
      ]),
      ["expired", NOW - 30 * DAY],
      ["future", NOW + 1],
    ]);
    expect(await store.claim("new", NOW)).toBe(true);
    const records = await history(factory);
    expect(records).toHaveLength(MAX_FIRED_REMINDERS);
    expect(records.at(-1)).toEqual(["future", NOW + 1]);
    expect(records.at(-2)).toEqual(["new", NOW]);
    expect(
      records.some(([key]) => ["expired", `key-${MAX_FIRED_REMINDERS - 1}`].includes(key)),
    ).toBe(false);
    expect(await store.claim("key-0", NOW)).toBe(false);
    expect(await store.claim("key-0", NOW + 30 * DAY)).toBe(true);
  });

  it("deduplicates concurrent fallback claims and prunes/bounds memory history", async () => {
    const store = createMemoryFiredStore();
    expect(await Promise.all([store.claim("first", NOW), store.claim("first", NOW)])).toEqual([
      true,
      false,
    ]);
    for (let index = 0; index < MAX_FIRED_REMINDERS; index++)
      await store.claim(`key-${index}`, NOW);
    expect(await store.claim("first", NOW)).toBe(true);
    expect(await store.claim("first", NOW + 30 * DAY)).toBe(true);
    expect(await store.claim("first", NOW)).toBe(false);
  });

  it.each(["memory", "indexedDB"])("releases only the undelivered key in %s", async (kind) => {
    const factory = new IDBFactory();
    const store =
      kind === "memory" ? createMemoryFiredStore() : createIndexedDbFiredStore("alice", factory);
    await store.release("missing");
    expect(await store.claim("delivered", NOW)).toBe(true);
    expect(await store.claim("undelivered", NOW + 1)).toBe(true);
    expect(await store.claim("undelivered", NOW)).toBe(false);
    await store.release("undelivered");
    expect(await store.claim("undelivered", NOW)).toBe(true);
    expect(await store.claim("delivered", NOW)).toBe(false);
  });

  it("reports open errors and closes a late open after an upgrade was blocked", async () => {
    const request = {} as IDBOpenDBRequest;
    const factory = { open: () => request } as unknown as IDBFactory;
    const store = createIndexedDbFiredStore("alice", factory);
    const failed = store.claim("key", NOW);
    const error = new Error("storage unavailable");
    Object.assign(request, { error });
    request.onerror?.({} as Event);
    await expect(failed).rejects.toBe(error);
    const blocked = store.claim("key", NOW);
    request.onblocked?.({} as IDBVersionChangeEvent);
    await expect(blocked).rejects.toThrow("blocked");
    const close = vi.fn();
    Object.assign(request, { result: { close } });
    request.onsuccess?.({} as Event);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    "onabort",
    "onerror",
  ] as const)("rejects transaction %s and closes the connection", async (event) => {
    const error = new Error("transaction failed");
    const tx = {
      error,
      objectStore: () => ({ get: () => ({}) }),
    } as unknown as IDBTransaction;
    const close = vi.fn();
    const request = {
      result: { close, transaction: () => tx },
    } as unknown as IDBOpenDBRequest;
    const factory = { open: () => request } as unknown as IDBFactory;
    const claim = createIndexedDbFiredStore("alice", factory).claim("key", NOW);
    request.onsuccess?.({} as Event);
    tx[event]?.({} as Event);
    await expect(claim).rejects.toBe(error);
    expect(close).toHaveBeenCalledOnce();
  });
});
