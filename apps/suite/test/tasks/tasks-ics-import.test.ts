// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { duplicateTaskData } from "../../src/apps/tasks/lib/detail/task-data";
import { taskDetails } from "../../src/apps/tasks/lib/model/task";
import { parseVTodo, serializeVTodo, type VTodoCalendar } from "../../src/apps/tasks/lib/vtodo";
import {
  calendarImport,
  exportCalendar,
  previewCalendar,
} from "../../src/apps/tasks/state/calendar-exchange";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const stamp = new Date("2026-06-01T10:00:00Z");
const sample: VTodoCalendar = {
  productId: "test",
  tasks: [
    {
      uid: "child",
      parentUid: "parent",
      title: "Child",
      stamp,
      state: "closed",
      status: "COMPLETED",
      endedAt: stamp,
      due: { kind: "date", value: "2026-06-03" },
      categories: ["home"],
    },
    {
      uid: "parent",
      title: "Parent",
      stamp,
      state: "open",
      description: "",
      priority: "high",
      due: { kind: "utc", value: new Date("2026-06-02T14:30:00Z") },
      categories: ["HOME"],
    },
  ],
};
const calendar = () => parseVTodo(serializeVTodo(sample));

describe("calendar exchange through conditional cache writes", () => {
  it("keeps the imported UID on the original when duplicating or completing a recurrence", async () => {
    const { cache, inbox } = await frameCache();
    const original = await cache.createTask(inbox, {
      title: "Repeat",
      calendarUid: "original-calendar-uid",
      due: stamp,
      recurrence: { frequency: "DAILY" },
    });
    if (!original) throw new Error("Missing original");
    expect(duplicateTaskData(original, webId).calendarUid).toBeUndefined();
    await cache.completeTask(original, stamp);
    const rows = cache.getSnapshot().tasks[inbox.url]?.items ?? [];
    expect(rows.find((row) => row.task.state === "open")?.task.calendarUid).toBe(
      "original-calendar-uid",
    );
    expect(rows.find((row) => row.task.state === "closed")?.task.calendarUid).toBeUndefined();
  });
  it("creates parents first, persists every field and identity, and skips re-imports after a fresh cache load", async () => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    expect(previewCalendar(calendar(), [])).toEqual({
      count: 2,
      completed: 1,
      skipped: 0,
      withoutRepeating: 0,
    });
    const requests = pod.requests.length;
    expect(await calendarImport(cache, inbox, calendar())()).toEqual({
      added: 2,
      skipped: 0,
      failed: 0,
    });
    const items = await store.listTasks(inbox.tracker.stateStore as string);
    const parent = items.find((item) => item.task.title === "Parent");
    const child = items.find((item) => item.task.title === "Child");
    expect(parent?.task.calendarUid).toBe("parent");
    expect(parent?.task.description).toBe("");
    expect(parent?.task.priority).toBe("high");
    expect(parent?.task.dueDate).toEqual(new Date("2026-06-02T14:30:00Z"));
    expect(child?.task).toMatchObject({
      parent: parent?.task.id,
      state: "closed",
      endedAt: stamp,
      allDay: "2026-06-03",
      dueDate: new Date("2026-06-03T00:00:00"),
    });
    expect(
      taskDetails(child?.url as string, child?.dataset as NonNullable<typeof child>["dataset"])
        ?.calendarUid,
    ).toBe("child");
    expect(
      pod.requests
        .slice(requests)
        .filter((request) => request.method === "PUT")
        .map((request) => request.url),
    ).toEqual([inbox.url, parent?.url, child?.url]);
    for (const request of pod.requests
      .slice(requests)
      .filter((request) => request.method === "PUT"))
      expect(request.headers.has("If-Match") || request.headers.get("If-None-Match") === "*").toBe(
        true,
      );
    const reopened = new TasksCache(store, failures, webId);
    await reopened.start();
    expect(await calendarImport(reopened, inbox, calendar())()).toEqual({
      added: 0,
      skipped: 2,
      failed: 0,
    });
    const exported = parseVTodo(await exportCalendar(reopened, inbox));
    expect(exported.tasks.map((task) => task.uid).sort()).toEqual(
      items.map((item) => item.task.id).sort(),
    );
    expect(exported.tasks.every((task) => task.categories?.[0] === "HOME")).toBe(true);
    expect(await calendarImport(reopened, inbox, exported)()).toEqual({
      added: 0,
      skipped: 2,
      failed: 0,
    });
    expect(failures).not.toHaveBeenCalled();
  });

  it("keeps import deduplication within the chosen project", async () => {
    const { cache, inbox } = await frameCache();
    await calendarImport(cache, inbox, calendar())();
    const other = await cache.createProject("Other");
    if (!other) throw new Error("Missing project");
    expect(await calendarImport(cache, other, calendar())()).toEqual({
      added: 2,
      skipped: 0,
      failed: 0,
    });
    expect(cache.getSnapshot().views.filter((task) => task.projectUrl === inbox.url)).toHaveLength(
      2,
    );
    expect(cache.getSnapshot().views.filter((task) => task.projectUrl === other.url)).toHaveLength(
      2,
    );
  });

  it.each([
    false,
    true,
  ])("retries a failed parent with response lost = %s, without orphaning children or duplicating tasks", async (landed) => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    let failed = false;
    const creates = vi.spyOn(store, "createTask");
    pod.intercept = (request) => {
      if (!failed && request.method === "PUT" && request.url !== inbox.url) {
        failed = true;
        if (landed) pod.seed(request.url, request.body);
        throw new TypeError("Lost response");
      }
    };
    const operation = calendarImport(cache, inbox, calendar());
    expect(await operation()).toMatchObject({ failed: 2 });
    expect(creates.mock.calls.every(([, data]) => data.title === "Parent")).toBe(true);
    const result = await operation();
    expect(result).toEqual({ added: 2, skipped: 0, failed: 0 });
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(2);
    const items = await store.listTasks(inbox.tracker.stateStore as string);
    expect(items.find((item) => item.task.title === "Child")?.task.parent).toBe(
      items.find((item) => item.task.title === "Parent")?.task.id,
    );
    expect(failures).toHaveBeenCalledOnce();
    const retry = failures.mock.calls[0]?.[1];
    retry?.();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(2);
  });

  it("warns about unsupported recurrence, imports it without repeating, and validates parents before writing", async () => {
    const { cache, inbox, pod } = await frameCache();
    const count = pod.mutations().length;
    const unsupported: VTodoCalendar = {
      productId: "tests",
      tasks: [
        {
          uid: "utc-dst",
          title: "UTC daily",
          state: "open",
          stamp,
          start: { kind: "utc", value: new Date("2026-10-24T09:00:00Z") },
          rrule: "FREQ=DAILY",
        },
      ],
    };
    expect(previewCalendar(unsupported, [])).toMatchObject({ withoutRepeating: 1 });
    expect(pod.mutations()).toHaveLength(count);
    expect(await calendarImport(cache, inbox, unsupported)()).toEqual({
      added: 1,
      skipped: 0,
      failed: 0,
    });
    const item = cache.getSnapshot().tasks[inbox.url]?.items[0];
    expect(item?.task.recurrence).toBeUndefined();
    expect(item?.task.dueDate).toEqual(new Date("2026-10-24T09:00:00Z"));
    expect(item?.task.description).toContain("RRULE:FREQ=DAILY");
    if (!item) throw new Error("Missing imported task");
    await cache.completeTask(item, new Date("2026-10-24T09:00:00Z"));
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.state).toBe("closed");
    expect(
      previewCalendar(unsupported, cache.getSnapshot().tasks[inbox.url]?.items ?? []),
    ).toMatchObject({ withoutRepeating: 0, skipped: 1 });
    const before = pod.mutations().length;
    await expect(
      calendarImport(cache, inbox, {
        ...sample,
        tasks: [sample.tasks[0] as VTodoCalendar["tasks"][number]],
      })(),
    ).rejects.toMatchObject({ code: "unresolved-parent" });
    expect(pod.mutations()).toHaveLength(before);
  });

  it("keeps a DTSTART-only weekly anchor through persistence and completion", async () => {
    const { cache, inbox, store, failures } = await frameCache();
    const weekly: VTodoCalendar = {
      productId: "tests",
      tasks: [
        {
          uid: "weekly",
          title: "Monday",
          state: "open",
          stamp,
          start: { kind: "date", value: "2026-06-01" },
          rrule: "FREQ=WEEKLY",
        },
      ],
    };
    expect(previewCalendar(weekly, [])).toMatchObject({ withoutRepeating: 0 });
    await calendarImport(cache, inbox, weekly)();
    const reopened = new TasksCache(store, failures, webId);
    await reopened.start();
    await reopened.loadTasks(inbox);
    const original = reopened.getSnapshot().tasks[inbox.url]?.items[0];
    if (!original) throw new Error("Missing imported task");
    expect(original.task.allDay).toBe("2026-06-01");
    await reopened.completeTask(original, new Date("2026-06-03T12:00:00Z"));
    expect(
      reopened.getSnapshot().tasks[inbox.url]?.items.find((row) => row.task.state === "open")?.task
        .allDay,
    ).toBe("2026-06-08");
  });

  it("preserves pending and completed deadlines after two recurring completions", async () => {
    const { cache, inbox } = await frameCache();
    const original = await cache.createTask(inbox, {
      title: "Three times",
      allDay: "2026-06-01",
      recurrence: { frequency: "DAILY", count: 3 },
    });
    if (!original) throw new Error("Missing original");
    await cache.completeTask(original, stamp);
    const advanced = cache
      .getSnapshot()
      .tasks[inbox.url]?.items.find((row) => row.task.id === original.task.id);
    if (!advanced) throw new Error("Missing advanced task");
    await cache.completeTask(advanced, stamp);
    const exported = parseVTodo(await exportCalendar(cache, inbox));
    const pending = exported.tasks.find((task) => task.state === "open");
    expect(pending?.due).toEqual({ kind: "date", value: "2026-06-03" });
    expect(pending?.start).toBeUndefined();
    expect(pending?.rrule).toBeUndefined();
    expect(pending?.description).toBe("Every day (3 times)");
    expect(
      exported.tasks
        .filter((task) => task.state === "closed")
        .map((task) => task.due)
        .sort((a, b) => String(a?.value).localeCompare(String(b?.value))),
    ).toEqual([
      { kind: "date", value: "2026-06-01" },
      { kind: "date", value: "2026-06-02" },
    ]);
    const other = await cache.createProject("Imported");
    if (!other) throw new Error("Missing project");
    await calendarImport(cache, other, exported)();
    const imported = cache
      .getSnapshot()
      .tasks[other.url]?.items.find((row) => row.task.state === "open");
    if (!imported) throw new Error("Missing imported series");
    expect(imported.task.dueDate).toEqual(new Date("2026-06-03T00:00:00"));
    expect(imported.task.recurrence).toBeUndefined();
    await cache.completeTask(imported, stamp);
    expect(
      cache.getSnapshot().tasks[other.url]?.items.filter((row) => row.task.state === "open"),
    ).toHaveLength(0);
  });

  it("reserves the same UID conditionally across two overlapping imports in separate caches", async () => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    const other = new TasksCache(store, failures, webId);
    await other.start();
    await other.loadTasks(inbox);
    let arrivals = 0;
    let release = () => {};
    const bothCreating = new Promise<void>((resolve) => {
      release = resolve;
    });
    const urls: string[] = [];
    pod.intercept = async (request) => {
      if (request.method !== "PUT" || !request.url.startsWith(inbox.tracker.stateStore as string))
        return;
      urls.push(request.url);
      expect(request.headers.get("If-None-Match")).toBe("*");
      const arrival = ++arrivals;
      if (arrival === 2) release();
      await bothCreating;
      // A real server evaluates the conditional create atomically for a given URL.
      if (arrival === 2 && urls[0] === request.url)
        await vi.waitFor(() => expect(pod.files.has(request.url)).toBe(true));
    };
    const single: VTodoCalendar = {
      productId: "tests",
      tasks: [{ uid: "same/uid?#🌿", title: "Concurrent", stamp, state: "open" }],
    };
    const results = await Promise.all([
      calendarImport(cache, inbox, single)(),
      calendarImport(other, inbox, single)(),
    ]);
    expect(new Set(urls).size).toBe(1);
    expect(results.sort((a, b) => b.added - a.added)).toEqual([
      { added: 1, skipped: 0, failed: 0 },
      { added: 0, skipped: 1, failed: 0 },
    ]);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(1);
    expect(failures).not.toHaveBeenCalled();
  });

  it("keeps a conflicting resource with a different UID intact, including on retry", async () => {
    const { cache, store, inbox } = await frameCache();
    const id = `calendar-${createHash("sha256").update("incoming").digest("hex")}`;
    const existing = await store.createTask(
      inbox,
      {
        title: "Existing",
        state: "open",
        calendarUid: "different",
      },
      id,
    );
    const operation = calendarImport(cache, inbox, {
      productId: "tests",
      tasks: [{ uid: "incoming", title: "Incoming", state: "open", stamp }],
    });
    expect(await operation()).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect(await operation()).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect((await store.readTask(existing.url)).task.title).toBe("Existing");
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(1);
  });

  it("bounds scheduling to four concurrent create calls and shares overlapping runs", async () => {
    const { cache, store, inbox } = await frameCache();
    const create = cache.prepareTaskCreate.bind(cache);
    let active = 0;
    let peak = 0;
    vi.spyOn(cache, "prepareTaskCreate").mockImplementation((...args) => {
      const run = create(...args);
      return async () => {
        active++;
        peak = Math.max(peak, active);
        try {
          return await run();
        } finally {
          active--;
        }
      };
    });
    const bulk: VTodoCalendar = {
      productId: "tests",
      tasks: Array.from({ length: 9 }, (_, i) => ({
        uid: `uid-${i}`,
        title: `Task ${i}`,
        stamp,
        state: "open",
      })),
    };
    const run = calendarImport(cache, inbox, bulk);
    const first = run();
    expect(run()).toBe(first);
    expect(await first).toEqual({ added: 9, skipped: 0, failed: 0 });
    expect(peak).toBe(4);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(9);
  });
});
