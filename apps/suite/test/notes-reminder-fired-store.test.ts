// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../src/apps/notes/lib/model/note";
import {
  CLAIM_TTL,
  createBrowserFiredStore,
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
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterEach(() => vi.useRealTimers());
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
  return new Promise<[string, { state: string; time: number }][]>((resolve, reject) => {
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
      ["one", expect.objectContaining({ state: "pending", time: NOW })],
      ["two", expect.objectContaining({ state: "pending", time: NOW })],
    ]);
  });

  it("preserves newer claims when concurrent tick times oppose transaction order", async () => {
    const factory = new IDBFactory();
    const a = createIndexedDbFiredStore("alice", factory);
    const b = createIndexedDbFiredStore("alice", factory);
    const newer = b.claim("same", NOW + 1);
    const older = a.claim("same", NOW);
    expect(await Promise.all([newer, older])).toEqual([true, false]);
    expect(await history(factory)).toEqual([
      ["same", expect.objectContaining({ state: "pending", time: NOW + 1 })],
    ]);
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
    expect(records.at(-1)).toEqual(["future", { state: "delivered", time: NOW + 1 }]);
    expect(records.at(-2)).toEqual([
      "new",
      expect.objectContaining({ state: "pending", time: NOW }),
    ]);
    expect(
      records.some(([key]) => ["expired", `key-${MAX_FIRED_REMINDERS - 1}`].includes(key)),
    ).toBe(false);
    expect(await store.claim("key-0", NOW)).toBe(false);
    expect(await history(factory)).toHaveLength(MAX_FIRED_REMINDERS);
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
    await store.deliver("delivered", NOW);
    await store.release("delivered");
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

it("retries a rejected claimant in independent page memory after cancellation releases the owner", async () => {
  const factory = new IDBFactory();
  const durable = createIndexedDbFiredStore("alice", factory);
  let committed!: () => void;
  let resume!: () => void;
  const claimed = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const first = createBrowserFiredStore("alice", createMemoryFiredStore(), {
    ...durable,
    async claim(key, now, owner) {
      const result = await durable.claim(key, now, owner);
      committed();
      await gate;
      return result;
    },
  });
  const second = createBrowserFiredStore(
    "alice",
    createMemoryFiredStore(),
    createIndexedDbFiredStore("alice", factory),
  );
  const notify = vi.fn();
  const cancelled = createReminderScheduler({ fired: first, notify: () => false }).tick([due], NOW);
  await claimed;
  const scheduler = createReminderScheduler({ fired: second, notify });
  await scheduler.tick([due], NOW);
  expect(notify).not.toHaveBeenCalled();
  resume();
  await cancelled;
  await scheduler.tick([due], NOW);
  await scheduler.tick([due], NOW);
  expect(notify).toHaveBeenCalledExactlyOnceWith(due);
  expect(await history(factory)).toEqual([[expect.any(String), { state: "delivered", time: NOW }]]);
});

it.each([
  "memory",
  "indexedDB",
])("expires pending %s claims without letting a stale owner release or complete its successor", async (kind) => {
  const factory = new IDBFactory();
  const first =
    kind === "memory" ? createMemoryFiredStore() : createIndexedDbFiredStore("alice", factory);
  const second = kind === "memory" ? first : createIndexedDbFiredStore("alice", factory);
  expect(await first.claim("key", NOW, "old")).toBe(true);
  expect(await second.claim("key", NOW + CLAIM_TTL - 1, "new")).toBe(false);
  expect(await second.claim("key", NOW + CLAIM_TTL, "new")).toBe(true);
  await first.release("key", "old");
  await first.deliver("key", NOW + CLAIM_TTL, "old");
  expect(await first.claim("key", NOW + CLAIM_TTL, "third")).toBe(false);
  await second.deliver("key", NOW + CLAIM_TTL, "new");
  await first.release("key", "old");
  expect(await first.claim("key", NOW + 2 * CLAIM_TTL, "third")).toBe(false);
});

it("revalidates independent page reservations when an abandoned durable claim expires", async () => {
  const factory = new IDBFactory();
  const abandoned = createIndexedDbFiredStore("alice", factory);
  const key = JSON.stringify([due.url, due.reminder]);
  await abandoned.claim(key, NOW, "abandoned");
  const fired = createBrowserFiredStore(
    "alice",
    createMemoryFiredStore(),
    createIndexedDbFiredStore("alice", factory),
  );
  const notify = vi.fn();
  const scheduler = createReminderScheduler({ fired, notify });
  await scheduler.tick([due], NOW);
  expect(notify).not.toHaveBeenCalled();
  vi.setSystemTime(NOW + CLAIM_TTL);
  await scheduler.tick([due], NOW + CLAIM_TTL);
  await abandoned.release(key, "abandoned");
  await scheduler.tick([due], NOW + 2 * CLAIM_TTL);
  expect(notify).toHaveBeenCalledExactlyOnceWith(due);
});

it.each(["memory", "indexedDB"])("records overdue identities as delivered in %s", async (kind) => {
  const store =
    kind === "memory"
      ? createMemoryFiredStore()
      : createIndexedDbFiredStore("alice", new IDBFactory());
  await store.markDelivered("identified", NOW);
  expect(await store.claim("identified", NOW)).toBe(false);
  expect(await store.owns("identified", NOW)).toBe(false);
  expect(await store.owns("missing", NOW)).toBe(false);
  await store.claim("pending", NOW, "owner");
  expect(await store.owns("pending", NOW, "other")).toBe(false);
  expect(await store.owns("pending", NOW, "owner")).toBe(true);
  expect(await store.owns("pending", NOW + CLAIM_TTL, "owner")).toBe(false);
  await store.claim("default", NOW);
  expect(await store.owns("default", NOW)).toBe(true);
});

it("records an overdue identity in independent durable and page stores", async () => {
  const factory = new IDBFactory();
  const memory = createMemoryFiredStore();
  const fired = createBrowserFiredStore(
    "alice",
    memory,
    createIndexedDbFiredStore("alice", factory),
  );
  await fired.markDelivered("identified", NOW);
  expect(await memory.claim("identified", NOW)).toBe(false);
  expect(await createIndexedDbFiredStore("alice", factory).claim("identified", NOW)).toBe(false);
});

it("keeps fallback deliveries deduplicated when durable completion and cancellation fail", async () => {
  const memory = createMemoryFiredStore();
  const failure = new Error("storage unavailable");
  const durable = {
    claim: vi.fn().mockRejectedValue(failure),
    deliver: vi.fn().mockRejectedValue(failure),
    release: vi.fn().mockRejectedValue(failure),
    owns: vi.fn().mockRejectedValue(failure),
    markDelivered: vi.fn().mockRejectedValue(failure),
  };
  const fired = createBrowserFiredStore("fallback", memory, durable);
  expect(await fired.claim("cancelled", NOW, "owner")).toBe(true);
  expect(await fired.owns("cancelled", NOW, "owner")).toBe(true);
  await fired.release("cancelled", "owner");
  expect(await fired.claim("cancelled", NOW, "retry")).toBe(true);
  await fired.deliver("cancelled", NOW, "retry");
  expect(await fired.claim("cancelled", NOW + CLAIM_TTL, "third")).toBe(false);
  await fired.markDelivered("identified", NOW);
  expect(await memory.claim("identified", NOW, "another")).toBe(false);
});

it("records page history when IndexedDB is absent", async () => {
  const memory = createMemoryFiredStore();
  const fired = createBrowserFiredStore("memory-only", memory, memory);
  await fired.markDelivered("identified", NOW);
  expect(await fired.claim("identified", NOW, "another")).toBe(false);
  expect(await fired.owns("identified", NOW, "another")).toBe(false);
  await fired.claim("pending", NOW, "owner");
  expect(await fired.owns("pending", NOW, "owner")).toBe(true);
  await fired.release("pending", "owner");
});

it("skips an expired owner when its claim result resumes after another page delivered", async () => {
  const factory = new IDBFactory();
  const durable = createIndexedDbFiredStore("alice", factory);
  let resume!: () => void;
  let committed!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const claimed = new Promise<void>((resolve) => {
    committed = resolve;
  });
  const first = createBrowserFiredStore("alice", createMemoryFiredStore(), {
    ...durable,
    async claim(key, now, owner) {
      const result = await durable.claim(key, now, owner);
      committed();
      await gate;
      return result;
    },
  });
  const second = createBrowserFiredStore(
    "alice",
    createMemoryFiredStore(),
    createIndexedDbFiredStore("alice", factory),
  );
  const notifyA = vi.fn();
  const notifyB = vi.fn();
  const a = createReminderScheduler({ fired: first, notify: notifyA }).tick([due], NOW);
  await claimed;
  vi.setSystemTime(NOW + CLAIM_TTL);
  await createReminderScheduler({ fired: second, notify: notifyB }).tick([due], Date.now());
  resume();
  await a;
  expect(notifyA).not.toHaveBeenCalled();
  expect(notifyB).toHaveBeenCalledExactlyOnceWith(due);
});

it("checks durable ownership and the clock again after a delayed lease validation", async () => {
  const factory = new IDBFactory();
  const durable = createIndexedDbFiredStore("alice", factory);
  const memory = createMemoryFiredStore();
  const fired = createBrowserFiredStore("alice", memory, durable);
  await fired.claim("key", NOW, "a");
  await durable.release("key", "a");
  await durable.claim("key", NOW, "b");
  expect(await fired.owns("key", NOW, "a")).toBe(false);
  const notify = vi.fn();
  await createReminderScheduler({
    fired: {
      ...fired,
      async owns() {
        vi.setSystemTime(NOW + CLAIM_TTL);
        return true;
      },
    },
    notify,
  }).tick([due], NOW);
  expect(notify).not.toHaveBeenCalled();
});
