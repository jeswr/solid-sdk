// AUTHORED-BY Claude Opus 5.5
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reminder } from "../../src/apps/tasks/lib/model/reminders";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import {
  createLocalStorageFiredStore,
  createMemoryFiredStore,
  type FiredReminderStore,
} from "../../src/apps/tasks/lib/reminders/fired-store";
import {
  fallbackFiredStore,
  REMINDER_INTERVAL,
  type ReminderEvent,
  type ReminderSnapshot,
  type ReminderSource,
  reminderBody,
  remindersReady,
  reminderTasks,
  runReminderTick,
  startReminderScheduler,
} from "../../src/apps/tasks/lib/reminders/runner";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { Pod, storage, webId } from "./pod";

// Europe/London (vitest config) is on GMT here, so local and UTC clocks agree.
const now = new Date("2026-11-02T09:00:00Z");
const project = "https://pod.test/tasks/inbox.ttl";
const url = "https://pod.test/tasks/a.ttl";

function view(extra: Partial<TaskView> = {}): TaskView {
  return {
    url,
    id: `${url}#it`,
    projectUrl: project,
    projectTitle: "Inbox",
    title: "Call mum",
    state: "open",
    due: new Date("2026-11-02T10:00:00Z"),
    priority: 4,
    labelIds: [],
    recurring: false,
    hasReminders: true,
    ...extra,
  };
}
function stored(taskUrl: string, reminders: Reminder[] | (() => Reminder[])): StoredTask {
  return {
    url: taskUrl,
    task: {
      get reminders() {
        return typeof reminders === "function" ? reminders() : reminders;
      },
    },
  } as unknown as StoredTask;
}
function snapshot(
  views: TaskView[],
  items: StoredTask[],
  extra: Partial<ReminderSnapshot> = {},
): ReminderSnapshot {
  return {
    status: "ready",
    projects: [{ url: project }],
    tasks: { [project]: { status: "ready", items } },
    views,
    ...extra,
  };
}
async function liveCache() {
  const pod = new Pod();
  const store = new TaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    now: () => now,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
    ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
  });
  const cache = new TasksCache(store, vi.fn(), webId);
  await cache.start();
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Expected Inbox");
  await cache.loadTasks(inbox);
  return { cache, inbox, store };
}
const oneHourBefore = () => snapshot([view()], [stored(url, [{ offset: "-PT1H" }])]);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reminder task mapping", () => {
  it("waits for the project list and every project load", () => {
    expect(remindersReady(snapshot([], [], { status: "loading" }))).toBe(false);
    expect(remindersReady(snapshot([], [], { tasks: {} }))).toBe(false);
    expect(
      remindersReady(snapshot([], [], { tasks: { [project]: { status: "loading", items: [] } } })),
    ).toBe(false);
    expect(
      remindersReady(snapshot([], [], { tasks: { [project]: { status: "error", items: [] } } })),
    ).toBe(true);
    expect(remindersReady(oneHourBefore())).toBe(true);
  });
  it("maps open dated tasks with reminders, keeping all-day markers and naming untitled tasks", () => {
    const reminders = [{ offset: "-PT1H" }];
    const allDay = view({ url: "b", title: "", allDay: "2026-11-03" });
    expect(
      reminderTasks(snapshot([view(), allDay], [stored(url, reminders), stored("b", reminders)])),
    ).toEqual({
      tasks: [
        { url, title: "Call mum", due: view().due, reminders, state: "open" },
        {
          url: "b",
          title: "Untitled task",
          due: view().due,
          allDay: "2026-11-03",
          reminders,
          state: "open",
        },
      ],
      errors: [],
    });
  });
  it("skips closed, undated, reminder-free and unloaded tasks and reports unreadable reminders", () => {
    const failure = new TypeError("A reminder requires exactly one trigger.");
    const result = reminderTasks(
      snapshot(
        [
          view({ url: "closed", state: "closed" }),
          view({ url: "undated", due: undefined }),
          view({ url: "none", hasReminders: false }),
          view({ url: "missing" }),
          view({ url: "broken" }),
        ],
        ["closed", "undated", "none"]
          .map((key) => stored(key, [{ offset: "PT0S" }]))
          .concat(
            stored("broken", () => {
              throw failure;
            }),
          ),
      ),
    );
    expect(result).toEqual({ tasks: [], errors: [failure] });
  });
  it("leaves hidden (pending delete) and completed cache tasks out", async () => {
    const { cache, inbox } = await liveCache();
    const due = new Date("2026-11-02T10:00:00Z");
    const kept = await cache.createTask(inbox, {
      title: "Kept",
      due,
      reminders: [{ offset: "-PT1H" }],
    });
    const hidden = await cache.createTask(inbox, {
      title: "Hidden",
      due,
      reminders: [{ offset: "-PT1H" }],
    });
    const closed = await cache.createTask(inbox, {
      title: "Closed",
      due,
      reminders: [{ offset: "-PT1H" }],
    });
    if (!kept || !hidden || !closed) throw new Error("Expected tasks");
    expect(
      reminderTasks(cache.getSnapshot())
        .tasks.map((task) => task.title)
        .sort(),
    ).toEqual(["Closed", "Hidden", "Kept"]);
    cache.hideTask(hidden.url, true);
    await cache.updateTask(closed, (task) => {
      task.state = "closed";
    });
    expect(reminderTasks(cache.getSnapshot()).tasks.map((task) => task.title)).toEqual(["Kept"]);
    expect(remindersReady(cache.getSnapshot())).toBe(true);
  });
  it("describes the due time", () => {
    const due = new Date("2026-11-02T17:00:00Z");
    expect(reminderBody({ due }, now)).toBe("Due today 17:00");
    expect(reminderBody({ due: new Date("2026-11-03T08:00:00Z"), allDay: "2026-11-03" }, now)).toBe(
      "Due tomorrow",
    );
    expect(reminderBody({ due: new Date("2026-12-24T17:00:00Z") }, now)).toBe("Due 24 Dec 17:00");
  });
});

describe("reminder tick", () => {
  it("delivers valid triggers alongside invalid ones and accepts retries without schedule metadata", async () => {
    const data = snapshot([view()], [stored(url, [{ offset: "-PT1H" }, { offset: "invalid" }])]);
    const store = createMemoryFiredStore();
    const notify = vi.fn().mockRejectedValueOnce(new Error("Delivery failed"));
    const first = await runReminderTick(data, now, store, notify);
    expect(first.errors).toHaveLength(2);
    const retry = { ...first.undelivered[0] } as ReminderEvent;
    delete retry.schedules;
    expect((await runReminderTick(data, now, store, notify, { retry: [retry] })).delivered).toEqual(
      [retry],
    );
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("delivers and retries an overdue reminder after an unrelated task edit", async () => {
    const data = oneHourBefore();
    const store = createMemoryFiredStore();
    const notify = vi.fn().mockRejectedValueOnce(new Error("Delivery failed"));
    await runReminderTick(data, new Date(now.getTime() - 300_000), store, notify);
    const item = data.tasks[project]?.items[0] as StoredTask;
    Object.assign(item.task, { modified: new Date(now.getTime() + 60_000), priority: 1 });
    const later = new Date(now.getTime() + 300_000);
    const first = await runReminderTick(data, later, store, notify);
    expect(first.undelivered).toHaveLength(1);
    Object.assign(item.task, { modified: new Date(later.getTime() + 60_000), title: "Renamed" });
    const retry = await runReminderTick(data, new Date(later.getTime() + 300_000), store, notify, {
      retry: first.undelivered,
    });
    expect(retry.delivered).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("delivers each due reminder once across ticks", async () => {
    const store = createMemoryFiredStore();
    const notify = vi.fn();
    const first = await runReminderTick(oneHourBefore(), now, store, notify);
    const event: ReminderEvent = {
      taskUrl: url,
      title: "Call mum",
      fireTime: now,
      tag: `${url}@2026-11-02T09:00:00.000Z`,
      body: "Due today 10:00",
      schedules: [JSON.stringify([url, "-PT1H", "2026-11-02T10:00:00.000Z"])],
    };
    expect(first).toEqual({ delivered: [event], errors: [], undelivered: [] });
    expect(notify).toHaveBeenCalledExactlyOnceWith(event);
    expect(
      await runReminderTick(oneHourBefore(), new Date(now.getTime() + 300_000), store, notify),
    ).toEqual({ delivered: [], errors: [], undelivered: [] });
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("applies offsets to all-day tasks from local midnight", async () => {
    const notify = vi.fn();
    const allDay = snapshot(
      [view({ due: new Date("2026-11-03T12:00:00Z"), allDay: "2026-11-03" })],
      [stored(url, [{ offset: "-PT15H" }])],
    );
    const early = await runReminderTick(allDay, now, createMemoryFiredStore(), notify);
    expect(early.delivered.map((event) => event.fireTime)).toEqual([
      new Date("2026-11-02T09:00:00Z"),
    ]);
    expect(early.delivered[0]?.body).toBe("Due tomorrow");
    expect(
      (await runReminderTick(allDay, new Date(now.getTime() - 1), createMemoryFiredStore(), notify))
        .delivered,
    ).toEqual([]);
  });
  it("reports invalid reminders, failed claims and failed deliveries without throwing", async () => {
    const broken = snapshot(
      [view(), view({ url: "b", title: "Second" }), view({ url: "c", title: "Third" })],
      [
        stored(url, [{ offset: "P1M" }]),
        stored("b", [{ offset: "PT0S" }]),
        stored("c", [{ offset: "-PT1H" }]),
      ],
    );
    const failure = new Error("Notification failed");
    const notify = vi.fn((event: ReminderEvent) => {
      if (event.title === "Third") throw failure;
    });
    const claimFailure = new Error("claim failed");
    const store: FiredReminderStore = {
      claim: async (key) => {
        if (key.startsWith("b/")) throw claimFailure;
        return true;
      },
    };
    const result = await runReminderTick(broken, new Date("2026-11-02T10:00:00Z"), store, notify);
    expect(result.delivered).toEqual([]);
    expect(result.errors).toEqual([expect.any(TypeError), claimFailure, failure]);
    expect(result.undelivered.map((event) => event.title)).toEqual(["Third"]);
  });
  it("does not fire again after the task moves to another project", async () => {
    const { cache, inbox, store } = await liveCache();
    const target = await store.createProject("Target");
    await cache.refreshProjects();
    await cache.loadTasks(target);
    const task = await cache.createTask(inbox, {
      title: "Call mum",
      due: new Date("2026-11-02T10:00:00Z"),
      reminders: [{ offset: "-PT1H" }],
    });
    if (!task) throw new Error("Expected task");
    const fired = createMemoryFiredStore();
    const notify = vi.fn();
    expect((await runReminderTick(cache.getSnapshot(), now, fired, notify)).delivered).toHaveLength(
      1,
    );
    const moved = await cache.moveTaskToProject(task, target);
    expect(moved?.url).not.toBe(task.url);
    expect(reminderTasks(cache.getSnapshot()).tasks.map((item) => item.url)).toEqual([moved?.url]);
    const later = new Date(now.getTime() + 3600_000);
    expect(await runReminderTick(cache.getSnapshot(), later, fired, notify)).toEqual({
      delivered: [],
      errors: [],
      undelivered: [],
    });
    expect(notify).toHaveBeenCalledOnce();
    // A different task with the same reminder still fires.
    await cache.createTask(target, {
      title: "Call dad",
      due: new Date("2026-11-02T10:00:00Z"),
      reminders: [{ offset: "-PT1H" }],
    });
    expect(
      (await runReminderTick(cache.getSnapshot(), later, fired, notify)).delivered.map(
        (event) => event.title,
      ),
    ).toEqual(["Call dad"]);
  });
  it("retries a failed delivery on the next tick while the task is still due", async () => {
    const store = createMemoryFiredStore();
    const notify = vi.fn().mockRejectedValueOnce(new Error("toast failed"));
    const first = await runReminderTick(oneHourBefore(), now, store, notify);
    expect(first.delivered).toEqual([]);
    expect(first.undelivered).toHaveLength(1);
    const second = await runReminderTick(oneHourBefore(), now, store, notify, {
      retry: first.undelivered,
    });
    expect(second.delivered).toEqual(first.undelivered);
    expect(second.undelivered).toEqual([]);
    // Retries are dropped once the task is gone or the event leaves the 24-hour window.
    const gone = await runReminderTick(snapshot([], []), now, store, notify, {
      retry: first.undelivered,
    });
    const stale = await runReminderTick(
      oneHourBefore(),
      new Date(now.getTime() + 86400000),
      store,
      notify,
      { retry: first.undelivered },
    );
    expect([gone.delivered, stale.delivered]).toEqual([[], []]);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("stops delivering once inactive, keeping the rest undelivered", async () => {
    const two = snapshot([view()], [stored(url, [{ offset: "-PT1H" }, { offset: "-PT2H" }])]);
    let active = true;
    const notify = vi.fn(() => {
      active = false;
    });
    const result = await runReminderTick(two, now, createMemoryFiredStore(), notify, {
      active: () => active,
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(result.delivered).toHaveLength(1);
    expect(result.undelivered).toHaveLength(1);
  });
  it("reports an invalid clock", async () => {
    const result = await runReminderTick(
      oneHourBefore(),
      new Date(Number.NaN),
      createMemoryFiredStore(),
      vi.fn(),
    );
    expect(result).toEqual({ delivered: [], errors: [expect.any(RangeError)], undelivered: [] });
  });
  it("suppresses unchanged schedules and rearms only when scheduling inputs change", async () => {
    const store = createMemoryFiredStore();
    const notify = vi.fn();
    const later = new Date(now.getTime() + 300_000);
    const data = snapshot(
      [view()],
      [stored(url, [{ id: "https://pod.test/reminder", time: now }])],
    );
    expect((await runReminderTick(data, later, store, notify)).delivered).toHaveLength(1);
    Object.assign(data.tasks[project]?.items[0]?.task ?? {}, { modified: later });
    expect((await runReminderTick(data, later, store, notify)).delivered).toEqual([]);
    const renamedNode = snapshot([view()], [stored(url, [{ time: now }])]);
    expect((await runReminderTick(renamedNode, later, store, notify)).delivered).toEqual([]);
    const changed = snapshot(
      [view({ due: new Date("2026-11-02T11:00:00Z") })],
      [stored(url, [{ time: now }])],
    );
    expect(
      (await runReminderTick(changed, later, store, notify)).delivered.map(
        (event) => event.fireTime,
      ),
    ).toEqual([now]);
    expect((await runReminderTick(changed, later, store, notify)).delivered).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("retries only the current schedule when an absolute reminder keeps its fire time after a due change", async () => {
    const store = createMemoryFiredStore();
    const notify = vi.fn().mockRejectedValueOnce(new Error("Delivery failed"));
    const original = snapshot([view()], [stored(url, [{ time: now }])]);
    const first = await runReminderTick(original, now, store, notify);
    const changed = snapshot(
      [view({ due: new Date("2026-11-02T11:00:00Z") })],
      [stored(url, [{ time: now }])],
    );
    const next = await runReminderTick(changed, now, store, notify, { retry: first.undelivered });
    expect(next.delivered.map((event) => event.body)).toEqual(["Due today 11:00"]);
    expect(next.undelivered).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("drops undelivered events when rescheduling or editing the reminder changes its fire time", async () => {
    const store = createMemoryFiredStore();
    const notify = vi.fn().mockRejectedValueOnce(new Error("Delivery failed"));
    const { undelivered } = await runReminderTick(oneHourBefore(), now, store, notify);
    for (const changed of [
      snapshot(
        [view({ due: new Date("2026-11-03T10:00:00Z") })],
        [stored(url, [{ offset: "-PT1H" }])],
      ),
      snapshot([view()], [stored(url, [{ offset: "-PT30M" }])]),
    ]) {
      expect(await runReminderTick(changed, now, store, notify, { retry: undelivered })).toEqual({
        delivered: [],
        errors: [],
        undelivered: [],
      });
    }
    expect(notify).toHaveBeenCalledOnce();
  });
  it("leaves later reminders unclaimed if stopped during an earlier claim", async () => {
    let active = true;
    const memory = createMemoryFiredStore();
    const claim = vi.fn(async (key: string) => {
      active = false;
      return memory.claim(key);
    });
    const data = snapshot([view()], [stored(url, [{ offset: "-PT1H" }, { offset: "-PT2H" }])]);
    await runReminderTick(data, now, { claim }, vi.fn(), { active: () => active });
    expect(claim).toHaveBeenCalledOnce();
    expect((await runReminderTick(data, now, memory, vi.fn())).delivered).toHaveLength(1);
  });
  it("does not claim or prune when already inactive, and continues after a prune failure", async () => {
    const failure = new Error("Prune failed");
    const store = {
      claim: vi.fn(async () => true),
      prune: vi.fn(async () => {
        throw failure;
      }),
    };
    expect(
      await runReminderTick(oneHourBefore(), now, store, vi.fn(), { active: () => false }),
    ).toEqual({ delivered: [], errors: [], undelivered: [] });
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.prune).not.toHaveBeenCalled();
    const result = await runReminderTick(oneHourBefore(), now, store, vi.fn());
    expect(result.errors).toEqual([failure]);
    expect(result.delivered).toHaveLength(1);
  });
  it("drops retries with newly invalid reminder data or a fire time in the future", async () => {
    const store = createMemoryFiredStore();
    const { undelivered } = await runReminderTick(oneHourBefore(), now, store, async () => {
      throw new Error("Delivery failed");
    });
    const invalid = snapshot([view()], [stored(url, [{ offset: "invalid" }])]);
    const result = await runReminderTick(invalid, now, store, vi.fn(), { retry: undelivered });
    expect(result.delivered).toEqual([]);
    expect(result.undelivered).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(
      (
        await runReminderTick(oneHourBefore(), new Date(now.getTime() - 1), store, vi.fn(), {
          retry: undelivered,
        })
      ).delivered,
    ).toEqual([]);
  });
});

describe("fallback fired store", () => {
  it.each([
    false,
    true,
  ])("preserves legacy fallback claim times across upgrade and reload (primary unavailable: %s)", async (unavailable) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const claimedAt = new Date(now.getTime() - 3600000);
    const legacyKey = `${url}#it/reminder--PT1H@${claimedAt.toISOString()}`;
    const values = new Map([
      ["tasks.firedReminders", JSON.stringify({ [legacyKey]: claimedAt.getTime() })],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const primary = createMemoryFiredStore();
    if (unavailable) vi.spyOn(primary, "claim").mockRejectedValue(new Error("Unavailable"));
    const makeStore = () =>
      fallbackFiredStore(primary, vi.fn(), createLocalStorageFiredStore(storage));
    const later = new Date(claimedAt.getTime() + 1);
    const data = snapshot([view()], [stored(url, [{ time: claimedAt }, { time: later }])]);
    const result = await runReminderTick(data, now, makeStore(), vi.fn());
    expect(result.errors).toEqual([]);
    expect(result.delivered.map((event) => event.fireTime)).toEqual([later]);
    expect((await runReminderTick(data, now, makeStore(), vi.fn())).delivered).toEqual([]);
  });

  it("honours an existing fallback claim even when that store cannot enumerate keys", async () => {
    const primary = createMemoryFiredStore();
    const store = fallbackFiredStore(primary, vi.fn(), { claim: async () => false });
    expect(await store.claim("existing")).toBe(false);
    expect(await primary.claim("existing")).toBe(false);
  });

  it("keeps using the primary if enumerating or mirroring fallback claims fails", async () => {
    const failure = new Error("Fallback blocked");
    const fallback = {
      keys: vi.fn().mockRejectedValue(failure),
      claim: vi.fn().mockRejectedValue(failure),
    };
    const report = vi.fn();
    const store = fallbackFiredStore(createMemoryFiredStore(), report, fallback);
    expect(await store.claim("new")).toBe(true);
    expect(await store.claim("new")).toBe(false);
    fallback.keys.mockResolvedValue([]);
    expect(await store.keys?.()).toEqual(["new"]);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it("enumerates fallback claims when primary enumeration fails or is unsupported", async () => {
    const failure = new Error("Primary blocked");
    const fallback = createMemoryFiredStore();
    await fallback.claim("saved");
    const report = vi.fn();
    const store = fallbackFiredStore(
      {
        claim: async () => true,
        keys: async () => {
          throw failure;
        },
      },
      report,
      fallback,
    );
    expect(await store.keys?.()).toEqual(["saved"]);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    const simple = fallbackFiredStore({ claim: async () => true }, report, {
      claim: async () => true,
    });
    expect(await simple.keys?.()).toEqual([]);
  });

  it("preserves a single primary winner when tabs share a durable fallback", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const primary = createMemoryFiredStore();
    const first = fallbackFiredStore(primary, vi.fn(), createLocalStorageFiredStore(storage));
    const other = fallbackFiredStore(primary, vi.fn(), createLocalStorageFiredStore(storage));
    expect(
      (await Promise.all([first.claim("same"), other.claim("same")])).filter(Boolean),
    ).toHaveLength(1);
  });

  it("merges outage claims before accepting claims after recovery and reload", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } as Storage;
    const primary = createMemoryFiredStore();
    const claim = vi.spyOn(primary, "claim").mockRejectedValue(new Error("Unavailable"));
    const fallback = () => fallbackFiredStore(createLocalStorageFiredStore(storage), vi.fn());
    const first = fallbackFiredStore(primary, vi.fn(), fallback());
    expect(await first.claim("during-outage")).toBe(true);
    claim.mockRestore();
    const reloaded = fallbackFiredStore(primary, vi.fn(), fallback());
    expect(await reloaded.claim("after-recovery")).toBe(true);
    // The entire fallback must reach the primary before any fresh claim is accepted.
    expect(await primary.claim("during-outage")).toBe(false);
    expect(await reloaded.claim("during-outage")).toBe(false);
    const another = fallbackFiredStore(primary, vi.fn(), fallback());
    expect(await another.claim("during-outage")).toBe(false);
  });

  it("reports an outage once, prunes the fallback, and retries keys when both stores fail", async () => {
    const failure = new Error("Storage unavailable");
    const primary = {
      claim: vi.fn().mockRejectedValue(failure),
      prune: vi.fn().mockRejectedValue(failure),
    };
    const fallback = {
      claim: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(true),
      prune: vi.fn(async () => {}),
    };
    const onError = vi.fn();
    const store = fallbackFiredStore(primary, onError, fallback);
    await expect(store.claim("retry")).rejects.toBe(failure);
    expect(await store.claim("retry")).toBe(true);
    await store.prune?.();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(primary.prune).toHaveBeenCalledOnce();
    expect(fallback.prune).toHaveBeenCalledOnce();
  });
  it("remembers claims across an IndexedDB outage and recovery", async () => {
    const primary = createMemoryFiredStore();
    const claim = vi.spyOn(primary, "claim");
    const store = fallbackFiredStore(primary, vi.fn());
    claim.mockRejectedValueOnce(new Error("Unavailable"));
    expect(await store.claim("during-outage")).toBe(true);
    expect(await store.claim("during-outage")).toBe(false);
    expect(await store.claim("before-outage")).toBe(true);
    claim.mockRejectedValueOnce(new Error("Unavailable again"));
    expect(await store.claim("before-outage")).toBe(false);
  });
  it("uses the durable store, then a memory store when it fails", async () => {
    const onError = vi.fn();
    const failure = new Error("IndexedDB unavailable");
    let fail = false;
    const primary: FiredReminderStore = {
      claim: async (key) => {
        if (fail) throw failure;
        return key === "new";
      },
    };
    const store = fallbackFiredStore(primary, onError);
    expect(await store.claim("new")).toBe(true);
    expect(await store.claim("old")).toBe(false);
    fail = true;
    expect(await store.claim("x")).toBe(true);
    expect(await store.claim("x")).toBe(false);
    // The fallback is reported once, not on every claim.
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });
});

class Source implements ReminderSource {
  listeners = new Set<() => void>();
  constructor(public value: ReminderSnapshot) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(value: ReminderSnapshot) {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}
function visibility(state: DocumentVisibilityState = "visible") {
  const target = new EventTarget();
  return Object.assign(target, { visibilityState: state }) as EventTarget & {
    visibilityState: DocumentVisibilityState;
  };
}

describe("reminder scheduler", () => {
  it("ticks once tasks load, every five minutes and on becoming visible, then stops", async () => {
    vi.useFakeTimers({ now });
    const source = new Source(snapshot([], [], { status: "loading" }));
    const notify = vi.fn();
    const doc = visibility("hidden");
    const store = createMemoryFiredStore();
    const claim = vi.spyOn(store, "claim");
    const scheduler = startReminderScheduler({ source, store, notify, document: doc });
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).not.toHaveBeenCalled();
    source.set(oneHourBefore());
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ title: "Call mum", fireTime: now });
    // Later snapshots do not re-run the load tick.
    source.set(oneHourBefore());
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1);
    // A reminder at due time is collected by the 5-minute tick that reaches it.
    source.set(snapshot([view()], [stored(url, [{ offset: "-PT1H" }, { offset: "-PT55M" }])]));
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL - 1);
    expect(notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]?.[0]).toMatchObject({
      fireTime: new Date(now.getTime() + REMINDER_INTERVAL),
    });
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    const ticks = claim.mock.calls.length;
    expect(ticks).toBe(3);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(claim.mock.calls.length).toBe(ticks + 2);
    scheduler.stop();
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(REMINDER_INTERVAL * 3);
    expect(claim.mock.calls.length).toBe(ticks + 2);
    expect(source.listeners.size).toBe(0);
    expect(await scheduler.tick()).toBeUndefined();
  });
  it("ticks immediately when tasks are already loaded and serializes forced ticks", async () => {
    const notify = vi.fn();
    const scheduler = startReminderScheduler({
      source: new Source(oneHourBefore()),
      store: createMemoryFiredStore(),
      notify,
      now: () => now,
      intervalMs: 1000,
    });
    const [first, second] = await Promise.all([scheduler.tick(), scheduler.tick()]);
    // The load tick delivered it; the forced ticks find it already claimed.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ delivered: [], errors: [], undelivered: [] });
    expect(second).toEqual({ delivered: [], errors: [], undelivered: [] });
    scheduler.stop();
  });
  it("skips claiming while it cannot deliver, then delivers when it can", async () => {
    let canDeliver = false;
    const store = createMemoryFiredStore();
    const claim = vi.spyOn(store, "claim");
    const notify = vi.fn();
    const scheduler = startReminderScheduler({
      source: new Source(oneHourBefore()),
      store,
      notify,
      now: () => now,
      canDeliver: () => canDeliver,
    });
    expect(await scheduler.tick()).toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
    canDeliver = true;
    expect((await scheduler.tick())?.delivered).toHaveLength(1);
    expect(notify).toHaveBeenCalledOnce();
    scheduler.stop();
  });
  it("retries failed deliveries and delivers nothing after stopping mid-tick", async () => {
    const notify = vi.fn().mockRejectedValueOnce(new Error("toast failed"));
    const source = new Source(snapshot([], [], { status: "loading" }));
    const scheduler = startReminderScheduler({
      source,
      store: createMemoryFiredStore(),
      notify,
      now: () => now,
      onError: vi.fn(),
    });
    source.value = oneHourBefore();
    expect((await scheduler.tick())?.undelivered).toHaveLength(1);
    expect((await scheduler.tick())?.delivered).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(2);
    scheduler.stop();
    // An account switch stops the old scheduler while its tick is still claiming.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = vi.fn();
    const store: FiredReminderStore = {
      claim: async () => {
        await gate;
        return true;
      },
    };
    const switching = startReminderScheduler({
      source: new Source(oneHourBefore()),
      store,
      notify: late,
      now: () => now,
    });
    const pending = switching.tick();
    await Promise.resolve();
    switching.stop();
    release();
    await pending;
    expect(late).not.toHaveBeenCalled();
  });
  it("skips ticks while loading and reports errors, even from a throwing reporter", async () => {
    const source = new Source(snapshot([], [], { status: "loading" }));
    const reported: unknown[][] = [];
    const scheduler = startReminderScheduler({
      source,
      store: createMemoryFiredStore(),
      notify: vi.fn(),
      now: () => new Date(Number.NaN),
      onError: (errors) => {
        reported.push(errors);
        throw new Error("reporter failed");
      },
    });
    expect(await scheduler.tick()).toBeUndefined();
    source.value = oneHourBefore();
    await expect(scheduler.tick()).rejects.toThrow("reporter failed");
    await expect(scheduler.tick()).rejects.toThrow("reporter failed");
    expect(reported).toHaveLength(2);
    scheduler.stop();
    const quiet = startReminderScheduler({
      source,
      store: createMemoryFiredStore(),
      notify: vi.fn(),
      now: () => new Date(Number.NaN),
    });
    expect((await quiet.tick())?.errors).toEqual([expect.any(RangeError)]);
    quiet.stop();
  });
});
