// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { computeFireTimes } from "../../src/apps/tasks/lib/model/reminders";
import {
  createIndexedDbFiredStore,
  createMemoryFiredStore,
  reminderKey,
} from "../../src/apps/tasks/lib/reminders/fired-store";
import {
  collectDueReminders,
  type ReminderTask,
} from "../../src/apps/tasks/lib/reminders/scheduler";

const now = new Date("2026-10-30T12:00Z");
const task = (extra: Partial<ReminderTask> = {}): ReminderTask => ({
  url: "https://pod.test/task",
  title: "Task",
  state: "open",
  due: new Date("2026-10-30T13:00Z"),
  reminders: [{ offset: "-PT1H" }],
  ...extra,
});
afterEach(() => vi.useRealTimers());

describe("reminder identity and memory store", () => {
  it("matches model keys for anonymous, named, absolute and recurring triggers", async () => {
    for (const reminder of [
      { offset: "-PT1H" },
      { time: now },
      { id: "https://pod.test/alarm", offset: "PT0S" },
    ]) {
      const fire = computeFireTimes(task().url, task().due, [reminder])[0];
      assert.isDefined(fire);
      expect(reminderKey(task().url, reminder, fire.at)).toBe(fire.key);
      expect(reminderKey(task().url, reminder, new Date(fire.at.getTime() + 1))).not.toBe(fire.key);
    }
    const store = createMemoryFiredStore();
    expect(await store.has("a")).toBe(false);
    await store.add("a");
    await store.add("a");
    expect(await store.has("a")).toBe(true);
    expect(await createMemoryFiredStore().has("a")).toBe(false);
  });
});

describe("scheduler", () => {
  it("collects offsets and absolute triggers in order and records them before returning", async () => {
    const store = createMemoryFiredStore();
    const tasks = [
      task(),
      task({
        url: "second",
        title: "Second",
        reminders: [{ time: new Date(now.getTime() - 60000) }],
      }),
    ];
    expect(await collectDueReminders(tasks, now, store)).toEqual([
      { taskUrl: "second", title: "Second", fireTime: new Date(now.getTime() - 60000) },
      { taskUrl: task().url, title: "Task", fireTime: now },
    ]);
    expect(
      await store.has(reminderKey(task().url, task().reminders[0] as { offset: string }, now)),
    ).toBe(true);
    expect(await collectDueReminders(tasks, new Date(now.getTime() + 60000), store)).toEqual([]);
  });
  it("uses an exclusive lower and inclusive upper bound", async () => {
    const reminders = [
      { time: new Date(now.getTime() - 300001) },
      { time: new Date(now.getTime() - 300000) },
      { time: new Date(now.getTime() - 299999) },
      { time: now },
      { time: new Date(now.getTime() + 1) },
    ];
    expect(
      (await collectDueReminders([task({ reminders })], now, createMemoryFiredStore())).map(
        (r) => r.fireTime,
      ),
    ).toEqual([reminders[2]?.time, now]);
  });
  it("skips closed, undated and reminder-free tasks", async () => {
    const undated = task();
    delete undated.due;
    expect(
      await collectDueReminders(
        [task({ state: "closed" }), undated, task({ reminders: [] })],
        now,
        createMemoryFiredStore(),
      ),
    ).toEqual([]);
  });
  it("catches up missed ticks, capped at 24 hours", async () => {
    const store = createMemoryFiredStore();
    await collectDueReminders([], new Date(now.getTime() - 3 * 86400000), store);
    const reminders = [
      { time: new Date(now.getTime() - 86400001) },
      { time: new Date(now.getTime() - 86400000) },
      { time: new Date(now.getTime() - 86399999) },
      { time: new Date(now.getTime() - 3600000) },
    ];
    expect(
      (await collectDueReminders([task({ reminders })], now, store)).map((r) => r.fireTime),
    ).toEqual([reminders[2]?.time, reminders[3]?.time]);
  });
  it("catches a reminder between the last tick and the normal window", async () => {
    const store = createMemoryFiredStore();
    await collectDueReminders([], new Date(now.getTime() - 3600000), store);
    expect(
      await collectDueReminders(
        [task({ reminders: [{ time: new Date(now.getTime() - 1800000) }] })],
        now,
        store,
      ),
    ).toHaveLength(1);
  });
  it("allows a custom window, clock rollback and zero window", async () => {
    const store = createMemoryFiredStore();
    await collectDueReminders([], new Date(now.getTime() + 3600000), store);
    expect(await collectDueReminders([task()], now, store, 1)).toHaveLength(1);
    expect(await collectDueReminders([task()], now, createMemoryFiredStore(), 0)).toEqual([]);
    expect(
      await collectDueReminders(
        [task({ reminders: [{ time: new Date(now.getTime() - 600000) }] })],
        now,
        createMemoryFiredStore(),
        900000,
      ),
    ).toHaveLength(1);
  });
  it("serialises concurrent ticks and deduplicates duplicate tasks/triggers", async () => {
    const store = createMemoryFiredStore();
    const [a, b] = await Promise.all([
      collectDueReminders([task(), task()], now, store),
      collectDueReminders([task()], now, store),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });
  it("retries storage failures and does not advance the successful-tick cursor", async () => {
    const store = createMemoryFiredStore();
    const add = vi.spyOn(store, "add").mockRejectedValueOnce(new Error("write failed"));
    await expect(collectDueReminders([task()], now, store)).rejects.toThrow("write failed");
    expect(await collectDueReminders([task()], now, store)).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(2);
    vi.spyOn(store, "has").mockRejectedValueOnce(new Error("read failed"));
    await expect(collectDueReminders([task()], now, store)).rejects.toThrow("read failed");
  });
  it.each([[-1], [NaN], [Infinity]])("rejects invalid window %j", async (window) => {
    await expect(collectDueReminders([], now, createMemoryFiredStore(), window)).rejects.toThrow(
      RangeError,
    );
  });
  it("rejects invalid clocks", async () => {
    await expect(
      collectDueReminders([], new Date("bad"), createMemoryFiredStore()),
    ).rejects.toThrow(RangeError);
  });
  it.each([
    ["2026-03-29", "2026-03-29T00:00Z"],
    ["2026-03-30", "2026-03-29T23:00Z"],
    ["2026-10-25", "2026-10-24T23:00Z"],
    ["2026-10-26", "2026-10-26T00:00Z"],
  ])("uses local midnight for all-day %s across DST", async (allDay, iso) => {
    const fireTime = new Date(iso);
    expect(
      await collectDueReminders(
        [task({ due: new Date(`${allDay}T00:00Z`), allDay, reminders: [{ offset: "PT0S" }] })],
        fireTime,
        createMemoryFiredStore(),
      ),
    ).toEqual([{ taskUrl: task().url, title: "Task", fireTime }]);
  });
  it("uses elapsed offsets over DST for timed tasks", async () => {
    const fireTime = new Date("2026-03-29T00:30Z");
    expect(
      await collectDueReminders(
        [task({ due: new Date("2026-03-29T01:30Z") })],
        fireTime,
        createMemoryFiredStore(),
      ),
    ).toEqual([{ taskUrl: task().url, title: "Task", fireTime }]);
  });
});

/** Minimal async fake: requests keep a transaction alive; completion follows its final request.
 * The fake also checks that writes are inside a readwrite transaction and that keys are out-of-line.
 */
function fakeIndexedDB(existing = false, upgradeExisting = false) {
  const values = new Map<IDBValidKey, string>();
  let hasStore = existing;
  let version = existing ? 3 : 0;
  let openFailure: "error" | "blocked" | undefined;
  let resumeBlocked: (() => void) | undefined;
  let transactionFailure: "error" | "abort" | undefined;
  const databases: IDBDatabase[] = [];
  const factory = {
    open: vi.fn((name: string, nextVersion?: number) => {
      expect(name).toBe("tasks");
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        if (openFailure) {
          const mode = openFailure;
          openFailure = undefined;
          Object.assign(request, { error: new Error("open failed") });
          if (mode === "error") request.onerror?.({} as Event);
          else {
            request.onblocked?.({} as IDBVersionChangeEvent);
            resumeBlocked = () => {
              const db = { close: vi.fn() } as unknown as IDBDatabase;
              databases.push(db);
              Object.assign(request, { result: db });
              request.onsuccess?.({} as Event);
            };
          }
          return;
        }
        const db = {
          version: nextVersion ?? Math.max(version, 1),
          objectStoreNames: { contains: (name: string) => name === "firedReminders" && hasStore },
          createObjectStore: (name: string, options?: IDBObjectStoreParameters) => {
            expect(name).toBe("firedReminders");
            expect(options).toBeUndefined();
            hasStore = true;
          },
          close: vi.fn(),
          transaction: (name: string, mode: IDBTransactionMode) => {
            expect(name).toBe("firedReminders");
            expect(mode).toBe("readwrite");
            const tx = {} as IDBTransaction;
            let pending = 0;
            const schedule = (callback: () => void) => {
              pending++;
              queueMicrotask(() => {
                if (transactionFailure) {
                  const failure = transactionFailure;
                  transactionFailure = undefined;
                  Object.assign(tx, { error: new Error("transaction failed") });
                  if (failure === "error") tx.onerror?.({} as Event);
                  else tx.onabort?.({} as Event);
                  return;
                }
                callback();
                pending--;
                queueMicrotask(() => {
                  if (!pending) tx.oncomplete?.({} as Event);
                });
              });
            };
            const store = {
              put: (value: string, key: IDBValidKey) =>
                schedule(() => {
                  values.set(key, value);
                }),
              get: (key: IDBValidKey) => {
                const req = {} as IDBRequest;
                schedule(() => {
                  Object.assign(req, { result: values.get(key) });
                  req.onsuccess?.({} as Event);
                });
                return req;
              },
              openCursor: () => {
                const req = {} as IDBRequest;
                const keys = [...values.keys()];
                let index = 0;
                const advance = () =>
                  schedule(() => {
                    const key = keys[index++];
                    Object.assign(req, {
                      result:
                        key === undefined
                          ? null
                          : {
                              value: values.get(key),
                              delete: () =>
                                schedule(() => {
                                  values.delete(key);
                                }),
                              continue: advance,
                            },
                    });
                    req.onsuccess?.({} as Event);
                  });
                advance();
                return req;
              },
            };
            Object.assign(tx, { objectStore: () => store });
            return tx;
          },
        } as unknown as IDBDatabase;
        Object.assign(request, { result: db });
        databases.push(db);
        if (
          upgradeExisting ||
          version === 0 ||
          (nextVersion !== undefined && nextVersion > version)
        )
          request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        version = db.version;
        request.onsuccess?.({} as Event);
      });
      return request;
    }),
  } as unknown as IDBFactory;
  return {
    factory,
    values,
    databases,
    failOpen: (mode: "error" | "blocked") => {
      openFailure = mode;
    },
    failTransaction: (mode: "error" | "abort") => {
      transactionFailure = mode;
    },
    resumeBlocked: () => resumeBlocked?.(),
    removeStore: () => {
      hasStore = false;
    },
  };
}

describe("IndexedDB fired store", () => {
  it("persists across store reload and scheduler reload", async () => {
    const fake = fakeIndexedDB();
    const a = createIndexedDbFiredStore(fake.factory);
    expect(await a.has("missing")).toBe(false);
    expect(await collectDueReminders([task()], now, a)).toHaveLength(1);
    const b = createIndexedDbFiredStore(fake.factory);
    expect(await collectDueReminders([task()], now, b)).toEqual([]);
    expect(fake.values.size).toBe(1);
    expect([...fake.values.values()][0]).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
  it("prunes only entries older than 30 days, on both reads and writes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const fake = fakeIndexedDB();
    fake.values.set("expired", new Date(now.getTime() - 30 * 86400000 - 1).toISOString());
    fake.values.set("boundary", new Date(now.getTime() - 30 * 86400000).toISOString());
    const store = createIndexedDbFiredStore(fake.factory);
    expect(await store.has("expired")).toBe(false);
    expect(await store.has("boundary")).toBe(true);
    expect(fake.values.has("expired")).toBe(false);
    vi.setSystemTime(new Date(now.getTime() + 1));
    await store.add("fresh");
    expect(fake.values.has("boundary")).toBe(false);
    expect(fake.values.get("fresh")).toBe(new Date(now.getTime() + 1).toISOString());
  });
  it("adds the object store to an existing tasks database without deleting other stores", async () => {
    const fake = fakeIndexedDB(true);
    fake.removeStore();
    await createIndexedDbFiredStore(fake.factory).add("key");
    expect(fake.factory.open).toHaveBeenCalledWith("tasks", 4);
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    expect(fake.values.has("key")).toBe(true);
  });
  it("preserves a reminder store already present during an upgrade", async () => {
    const fake = fakeIndexedDB(true, true);
    fake.values.set("previous", now.toISOString());
    const store = createIndexedDbFiredStore(fake.factory);
    expect(await store.has("previous")).toBe(true);
  });
  it("closes on version changes and reopens lazily", async () => {
    const fake = fakeIndexedDB();
    const store = createIndexedDbFiredStore(fake.factory);
    await store.add("key");
    fake.databases[0]?.onversionchange?.({} as IDBVersionChangeEvent);
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    expect(await store.has("key")).toBe(true);
    expect(fake.factory.open).toHaveBeenCalledTimes(2);
  });
  it.each(["error", "blocked"] as const)("reports open %s and permits retry", async (mode) => {
    const fake = fakeIndexedDB();
    fake.failOpen(mode);
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.has("key")).rejects.toThrow(mode === "error" ? "open failed" : "blocked");
    await store.add("key");
    expect(await store.has("key")).toBe(true);
  });
  it("closes a late successful open after a blocked upgrade", async () => {
    const fake = fakeIndexedDB();
    fake.failOpen("blocked");
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.has("key")).rejects.toThrow("blocked");
    fake.resumeBlocked();
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    await store.add("key");
    expect(await store.has("key")).toBe(true);
  });
  it.each(["error", "abort"] as const)("reports transaction %s", async (mode) => {
    const fake = fakeIndexedDB();
    fake.failTransaction(mode);
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.add("key")).rejects.toThrow("transaction failed");
    await store.add("key");
    expect(await store.has("key")).toBe(true);
  });
});
