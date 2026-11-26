// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { computeFireTimes } from "../../src/apps/tasks/lib/model/reminders";
import {
  createIndexedDbFiredStore,
  createLocalStorageFiredStore,
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
const legacyClaimTime = new Date(now.getTime() - 3600000);
function legacyFixture(kind: "url" | "identity" | "named") {
  const identity = "2026-10-01T00:00:00.000Z|Task";
  const oldFire = new Date(legacyClaimTime.getTime() - 3600000).toISOString();
  const oldKey =
    kind === "identity"
      ? `${identity}|-PT3H@${oldFire}`
      : kind === "named"
        ? `https://pod.test/alarm@${oldFire}`
        : `${task().url}#it/reminder--PT3H@${oldFire}`;
  const times = [-1, 0, 1].map((delta) => new Date(legacyClaimTime.getTime() + delta));
  return {
    oldKey,
    times,
    task: task({
      ...(kind === "identity" ? { url: "https://pod.test/moved", identity } : {}),
      reminders: times.map((time, index) => ({
        time,
        ...(kind === "named"
          ? { id: index === 0 ? "https://pod.test/alarm" : `https://pod.test/alarm-${index}` }
          : {}),
      })),
    }),
  };
}
afterEach(() => vi.useRealTimers());

describe("reminder identity and memory store", () => {
  it("honours legacy claims when merging into a memory store", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(legacyClaimTime);
    const previous = legacyFixture("url");
    const store = createMemoryFiredStore();
    await store.claim(previous.oldKey);
    vi.setSystemTime(now);
    const result = await collectDueReminders([previous.task], now, store);
    expect(result.errors).toEqual([]);
    expect(result.due.map((event) => event.fireTime)).toEqual([previous.times[2]]);
  });

  it("keys suppression on scheduling inputs for anonymous, named and absolute triggers", async () => {
    for (const reminder of [
      { offset: "-PT1H" },
      { time: now },
      { id: "https://pod.test/alarm", offset: "PT0S" },
    ]) {
      const fire = computeFireTimes(task().url, task().due, [reminder])[0];
      assert.isDefined(fire);
      const key = reminderKey(task().url, reminder, fire.at, task().due);
      expect(
        reminderKey(task().url, { ...reminder, id: "https://other.test/id" }, fire.at, task().due),
      ).toBe(key);
      expect(
        reminderKey(task().url, reminder, new Date(fire.at.getTime() + 1), task().due),
      ).not.toBe(key);
      expect(reminderKey(task().url, reminder, fire.at, new Date(now.getTime() + 1))).not.toBe(key);
    }
    const store = createMemoryFiredStore();
    expect(await store.claim("a")).toBe(true);
    expect(await store.claim("a")).toBe(false);
    expect(await createMemoryFiredStore().claim("a")).toBe(true);
  });
});

describe("localStorage fired store", () => {
  function local() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
  }
  it.each([
    "url",
    "identity",
    "named",
  ] as const)("honours persisted legacy %s claims through their recorded time after upgrade", async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const previous = legacyFixture(kind);
    const storage = local();
    storage.setItem(
      "tasks.firedReminders",
      JSON.stringify({ [previous.oldKey]: legacyClaimTime.getTime() }),
    );
    const result = await collectDueReminders(
      [previous.task, task({ url: "https://pod.test/unrelated" })],
      now,
      createLocalStorageFiredStore(storage),
    );
    expect(result.errors).toEqual([]);
    expect(result.due.map((event) => event.fireTime)).toEqual([previous.times[2], now]);
    expect(
      await collectDueReminders([previous.task], now, createLocalStorageFiredStore(storage)),
    ).toEqual({ due: [], errors: [] });
  });
  it("retains claims across reloads and prunes only records older than 30 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const storage = local();
    const first = createLocalStorageFiredStore(storage);
    expect(await first.claim("key")).toBe(true);
    const next = createLocalStorageFiredStore(storage);
    expect(await next.claim("key")).toBe(false);
    vi.setSystemTime(now.getTime() + 30 * 86400000);
    await next.prune?.();
    expect(await next.claim("key")).toBe(false);
    vi.setSystemTime(now.getTime() + 30 * 86400000 + 1);
    await next.prune?.();
    expect(await next.claim("key")).toBe(true);
  });
  it("ignores invalid stored entries and tolerates non-object records", async () => {
    const storage = local();
    for (const record of ["null", '"old"', '{"bad":"wrong","valid":1}']) {
      storage.setItem("tasks.firedReminders", record);
      const store = createLocalStorageFiredStore(storage);
      expect(await store.claim("bad")).toBe(true);
    }
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
    expect(await collectDueReminders(tasks, now, store)).toEqual({
      due: [
        { taskUrl: "second", title: "Second", fireTime: new Date(now.getTime() - 60000) },
        { taskUrl: task().url, title: "Task", fireTime: now },
      ],
      errors: [],
    });
    expect(
      await store.claim(
        reminderKey(task().url, task().reminders[0] as { offset: string }, now, task().due),
      ),
    ).toBe(false);
    expect(await collectDueReminders(tasks, new Date(now.getTime() + 60000), store)).toEqual({
      due: [],
      errors: [],
    });
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
      (
        await collectDueReminders([task({ reminders })], now, createMemoryFiredStore(), 300000)
      ).due.map((r) => r.fireTime),
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
    ).toEqual({ due: [], errors: [] });
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
      (await collectDueReminders([task({ reminders })], now, store)).due.map((r) => r.fireTime),
    ).toEqual([reminders[2]?.time, reminders[3]?.time]);
  });
  it("catches a reminder between the last tick and the normal window", async () => {
    const store = createMemoryFiredStore();
    await collectDueReminders([], new Date(now.getTime() - 3600000), store);
    expect(
      (
        await collectDueReminders(
          [task({ reminders: [{ time: new Date(now.getTime() - 1800000) }] })],
          now,
          store,
        )
      ).due,
    ).toHaveLength(1);
  });
  it("allows a custom window, clock rollback and zero window", async () => {
    const store = createMemoryFiredStore();
    await collectDueReminders([], new Date(now.getTime() + 3600000), store);
    expect((await collectDueReminders([task()], now, store, 1)).due).toHaveLength(1);
    expect(await collectDueReminders([task()], now, createMemoryFiredStore(), 0)).toEqual({
      due: [],
      errors: [],
    });
    expect(
      (
        await collectDueReminders(
          [task({ reminders: [{ time: new Date(now.getTime() - 600000) }] })],
          now,
          createMemoryFiredStore(),
          900000,
        )
      ).due,
    ).toHaveLength(1);
  });
  it("atomically deduplicates concurrent ticks and duplicate tasks/triggers", async () => {
    const store = createMemoryFiredStore();
    const [a, b] = await Promise.all([
      collectDueReminders([task(), task()], now, store),
      collectDueReminders([task()], now, store),
    ]);
    expect(a.due).toHaveLength(1);
    expect(b).toEqual({ due: [], errors: [] });
  });
  it("returns claimed events when the second reminder's storage claim fails, then retries it", async () => {
    const store = createMemoryFiredStore();
    const claim = store.claim.bind(store);
    const error = new Error("claim failed");
    vi.spyOn(store, "claim").mockImplementationOnce(claim).mockRejectedValueOnce(error);
    const reminders = [{ time: new Date(now.getTime() - 60000) }, { time: now }];
    const first = await collectDueReminders([task({ reminders })], now, store);
    expect(first.due.map((event) => event.fireTime)).toEqual([reminders[0]?.time]);
    expect(first.errors).toEqual([error]);
    const retry = await collectDueReminders([task({ reminders })], now, store);
    expect(retry.due.map((event) => event.fireTime)).toEqual([now]);
    expect(retry.errors).toEqual([]);
  });
  it("isolates an invalid second reminder and continues with later reminders and tasks", async () => {
    const result = await collectDueReminders(
      [
        task({
          reminders: [{ time: now }, { offset: "invalid" }, { time: new Date(now.getTime() - 1) }],
        }),
        task({ url: "other" }),
      ],
      now,
      createMemoryFiredStore(),
    );
    expect(result.due.map((event) => event.taskUrl)).toEqual([task().url, task().url, "other"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(TypeError);
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
    ).toEqual({ due: [{ taskUrl: task().url, title: "Task", fireTime }], errors: [] });
  });
  it("uses elapsed offsets over DST for timed tasks", async () => {
    const fireTime = new Date("2026-03-29T00:30Z");
    expect(
      await collectDueReminders(
        [task({ due: new Date("2026-03-29T01:30Z") })],
        fireTime,
        createMemoryFiredStore(),
      ),
    ).toEqual({ due: [{ taskUrl: task().url, title: "Task", fireTime }], errors: [] });
  });
});

/** Minimal async fake: requests keep a transaction alive; completion follows its final request.
 * The fake also checks that writes are inside a readwrite transaction and that keys are out-of-line.
 * Readwrite transactions serialize across connections sharing this factory, as in IndexedDB.
 */
function fakeIndexedDB(existing = false, upgradeExisting = false) {
  const values = new Map<IDBValidKey, string>();
  let hasStore = existing;
  let version = existing ? 3 : 0;
  let openFailure: "error" | "blocked" | undefined;
  let resumeBlocked: (() => void) | undefined;
  let transactionFailure: "error" | "abort" | undefined;
  const databases: IDBDatabase[] = [];
  let transactionTail = Promise.resolve();
  const transactions = vi.fn();
  const scans = vi.fn();
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
            transactions();
            expect(name).toBe("firedReminders");
            expect(mode).toBe("readwrite");
            const tx = {} as IDBTransaction;
            let release!: () => void;
            const ready = transactionTail;
            transactionTail = new Promise<void>((resolve) => {
              release = resolve;
            });
            let finished = false;
            let pending = 0;
            const schedule = (callback: () => void) => {
              pending++;
              void ready.then(() => {
                if (transactionFailure) {
                  const failure = transactionFailure;
                  transactionFailure = undefined;
                  finished = true;
                  release();
                  Object.assign(tx, { error: new Error("transaction failed") });
                  if (failure === "error") tx.onerror?.({} as Event);
                  else tx.onabort?.({} as Event);
                  return;
                }
                callback();
                pending--;
                queueMicrotask(() => {
                  if (!pending && !finished) {
                    finished = true;
                    tx.oncomplete?.({} as Event);
                    release();
                  }
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
                scans();
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
                              key,
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
    transactions,
    scans,
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
  it.each([
    true,
    false,
  ])("checks persisted legacy claims before a direct claim without pruning (already fired: %s)", async (fired) => {
    const fake = fakeIndexedDB(true);
    const previous = legacyFixture("url");
    fake.values.set(previous.oldKey, legacyClaimTime.toISOString());
    fake.values.set(1, now.toISOString());
    fake.values.set("unrelated", now.toISOString());
    const store = createIndexedDbFiredStore(fake.factory);
    const at = new Date(legacyClaimTime.getTime() + (fired ? 0 : 1));
    const key = reminderKey(previous.task.url, { time: at }, at, previous.task.due);
    const legacy = { prefixes: [`${previous.task.url}#`], fireTime: at };
    expect(await store.claim(key, legacy)).toBe(!fired);
    expect(await store.claim(key, legacy)).toBe(false);
    expect(await store.claim(`${key}-other`, legacy)).toBe(!fired);
    expect(fake.scans).toHaveBeenCalledTimes(1);
  });

  it.each([
    "url",
    "identity",
    "named",
  ] as const)("honours persisted legacy %s claims through their recorded time after upgrade", async (kind) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const previous = legacyFixture(kind);
    const fake = fakeIndexedDB(true);
    fake.values.set(previous.oldKey, legacyClaimTime.toISOString());
    const result = await collectDueReminders(
      [previous.task, task({ url: "https://pod.test/unrelated" })],
      now,
      createIndexedDbFiredStore(fake.factory),
    );
    expect(result.errors).toEqual([]);
    expect(result.due.map((event) => event.fireTime)).toEqual([previous.times[2], now]);
    expect(
      await collectDueReminders([previous.task], now, createIndexedDbFiredStore(fake.factory)),
    ).toEqual({ due: [], errors: [] });
  });

  it("atomically claims reminders across concurrent store instances", async () => {
    const fake = fakeIndexedDB();
    const a = createIndexedDbFiredStore(fake.factory);
    const b = createIndexedDbFiredStore(fake.factory);
    const results = await Promise.all([
      collectDueReminders([task()], now, a),
      collectDueReminders([task()], now, b),
    ]);
    expect(results.flatMap((result) => result.due)).toEqual([
      { taskUrl: task().url, title: "Task", fireTime: now },
    ]);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
  });
  it("catches an unfired reminder six minutes after reload and deduplicates another reload", async () => {
    const fake = fakeIndexedDB();
    const tasks = [task({ reminders: [{ time: new Date(now.getTime() - 6 * 60000) }] })];
    const first = await collectDueReminders(tasks, now, createIndexedDbFiredStore(fake.factory));
    expect(first.due).toHaveLength(1);
    expect(first.errors).toEqual([]);
    expect(await collectDueReminders(tasks, now, createIndexedDbFiredStore(fake.factory))).toEqual({
      due: [],
      errors: [],
    });
  });
  it("persists across store reload and scheduler reload", async () => {
    const fake = fakeIndexedDB();
    const a = createIndexedDbFiredStore(fake.factory);
    expect(await a.claim("missing")).toBe(true);
    expect((await collectDueReminders([task()], now, a)).due).toHaveLength(1);
    const b = createIndexedDbFiredStore(fake.factory);
    expect(await collectDueReminders([task()], now, b)).toEqual({ due: [], errors: [] });
    expect(fake.values.size).toBe(2);
    expect([...fake.values.values()][0]).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
  it("prunes only entries older than 30 days, once per tick", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const fake = fakeIndexedDB();
    fake.values.set("expired", new Date(now.getTime() - 30 * 86400000 - 1).toISOString());
    fake.values.set("boundary", new Date(now.getTime() - 30 * 86400000).toISOString());
    const store = createIndexedDbFiredStore(fake.factory);
    await store.prune?.();
    expect(await store.claim("expired")).toBe(true);
    expect(await store.claim("boundary")).toBe(false);
    expect(fake.values.get("expired")).toBe(now.toISOString());
    vi.setSystemTime(new Date(now.getTime() + 1));
    await store.prune?.();
    await store.claim("fresh");
    expect(fake.values.has("boundary")).toBe(false);
    expect(fake.values.get("fresh")).toBe(new Date(now.getTime() + 1).toISOString());
  });
  it("caches known fired keys and scans retention once per tick instead of per reminder", async () => {
    const fake = fakeIndexedDB();
    const store = createIndexedDbFiredStore(fake.factory);
    const tasks = [task({ reminders: [{ time: now }, { time: new Date(now.getTime() - 1) }] })];
    expect((await collectDueReminders(tasks, now, store)).due).toHaveLength(2);
    expect(fake.scans).toHaveBeenCalledTimes(1);
    expect(fake.transactions).toHaveBeenCalledTimes(3);
    expect((await collectDueReminders(tasks, now, store)).due).toEqual([]);
    expect(fake.scans).toHaveBeenCalledTimes(2);
    expect(fake.transactions).toHaveBeenCalledTimes(4);
  });
  it("expires cached keys at retention and retries failed pruning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const fake = fakeIndexedDB();
    const store = createIndexedDbFiredStore(fake.factory);
    await store.claim("key");
    vi.setSystemTime(now.getTime() + 30 * 86400000 + 1);
    fake.failTransaction("error");
    await expect(store.prune?.()).rejects.toThrow("transaction failed");
    await store.prune?.();
    expect(await store.claim("key")).toBe(true);
  });
  it("adds the object store to an existing tasks database without deleting other stores", async () => {
    const fake = fakeIndexedDB(true);
    fake.removeStore();
    await createIndexedDbFiredStore(fake.factory).claim("key");
    expect(fake.factory.open).toHaveBeenCalledWith("tasks", 4);
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    expect(fake.values.has("key")).toBe(true);
  });
  it("preserves a reminder store already present during an upgrade", async () => {
    const fake = fakeIndexedDB(true, true);
    fake.values.set("previous", now.toISOString());
    const store = createIndexedDbFiredStore(fake.factory);
    expect(await store.claim("previous")).toBe(false);
  });
  it("closes every connection after its claim or prune, holding none between ticks", async () => {
    const fake = fakeIndexedDB();
    const store = createIndexedDbFiredStore(fake.factory);
    await store.claim("key");
    await store.prune?.();
    await store.claim("next");
    expect(fake.factory.open).toHaveBeenCalledTimes(3);
    for (const db of fake.databases) expect(db.close).toHaveBeenCalledOnce();
  });
  it("closes on version changes and reopens lazily", async () => {
    const fake = fakeIndexedDB();
    const store = createIndexedDbFiredStore(fake.factory);
    await store.claim("key");
    fake.databases[0]?.onversionchange?.({} as IDBVersionChangeEvent);
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    expect(await store.claim("key")).toBe(false);
    await store.claim("next");
    expect(fake.factory.open).toHaveBeenCalledTimes(2);
  });
  it.each(["error", "blocked"] as const)("reports open %s and permits retry", async (mode) => {
    const fake = fakeIndexedDB();
    fake.failOpen(mode);
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.claim("key")).rejects.toThrow(mode === "error" ? "open failed" : "blocked");
    await store.claim("key");
    expect(await store.claim("key")).toBe(false);
  });
  it("closes a late successful open after a blocked upgrade", async () => {
    const fake = fakeIndexedDB();
    fake.failOpen("blocked");
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.claim("key")).rejects.toThrow("blocked");
    fake.resumeBlocked();
    expect(fake.databases[0]?.close).toHaveBeenCalled();
    await store.claim("key");
    expect(await store.claim("key")).toBe(false);
  });
  it.each(["error", "abort"] as const)("reports transaction %s", async (mode) => {
    const fake = fakeIndexedDB();
    fake.failTransaction(mode);
    const store = createIndexedDbFiredStore(fake.factory);
    await expect(store.claim("key")).rejects.toThrow("transaction failed");
    await store.claim("key");
    expect(await store.claim("key")).toBe(false);
  });
});
