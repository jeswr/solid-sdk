// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { completeTask } from "../../src/apps/tasks/state/actions";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import type { TasksContextValue } from "../../src/apps/tasks/state/tasks-context";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@jeswr/suite-ui", () => ({ toast: { success: vi.fn() } }));
function context(cache: TasksCache): TasksContextValue {
  return {
    ...cache.getSnapshot(),
    cache,
    updateTask: cache.updateTask.bind(cache),
  } as TasksContextValue;
}

describe("recurring completion action", () => {
  it.each([
    2, 3,
  ])("resumes a lost occurrence PUT on the next complete action (count: %s)", async (count) => {
    const { cache, store, pod, inbox, failures } = await frameCache();
    const original = await store.createTask(inbox, {
      title: "Repeat",
      state: "open",
      dueDate: new Date("2026-11-01T12:00:00Z"),
      recurrence: { frequency: "DAILY", count },
      reminders: [{ time: new Date("2026-11-01T11:00:00Z") }],
    });
    await cache.loadTasks(inbox, true);
    const view = cache.getSnapshot().views.find((task) => task.url === original.url);
    if (!view) throw new Error("Missing original");
    let copyUrl: string | undefined;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.headers.get("If-None-Match") === "*") {
        copyUrl = request.url;
        pod.seed(request.url, request.body);
        throw new TypeError("Occurrence response lost after commit");
      }
      return undefined;
    };
    expect(await completeTask(view, context(cache))).toBeUndefined();
    expect(failures).toHaveBeenCalledOnce();
    expect(cache.getSnapshot().views.filter((task) => task.state === "closed")).toHaveLength(1);
    const current = cache.getSnapshot().views.find((task) => task.url === original.url);
    if (!current) throw new Error("Missing reconciled original");
    expect(current.state).toBe("open");
    pod.intercept = undefined;
    pod.requests.length = 0;
    const [resumed, repeated] = await Promise.all([
      completeTask(current, context(cache)),
      completeTask(current, context(cache)),
    ]);
    expect(repeated).toBe(resumed);
    expect(resumed).toMatchObject({ kind: "advance", copyUrl });
    expect(pod.requests[0]).toMatchObject({ method: "GET", url: original.url });
    expect(pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
    ]);
    const updated = await store.readTask(original.url);
    expect(updated.task.state).toBe("open");
    expect(updated.task.dueDate).toEqual(new Date("2026-11-02T12:00:00Z"));
    expect(updated.task.reminders[0]?.time).toEqual(new Date("2026-11-02T11:00:00Z"));
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(2);

    // A resolved operation releases the task for its next occurrence.
    const next = cache.getSnapshot().views.find((task) => task.url === original.url);
    if (!next) throw new Error("Missing advanced original");
    const completed = await completeTask(next, context(cache));
    expect(completed?.kind).toBe(count === 2 ? "close" : "advance");
    expect((await store.readTask(original.url)).task.dueDate).toEqual(
      new Date(count === 2 ? "2026-11-02T12:00:00Z" : "2026-11-03T12:00:00Z"),
    );
  });

  it("creates a conditional closed copy, advances due and reminders, retains the plan and emits its toast", async () => {
    const { cache, store, pod, inbox } = await frameCache();
    const original = await store.createTask(inbox, {
      title: "Water plants",
      state: "open",
      dueDate: new Date("2026-11-01T00:00:00Z"),
      allDay: "2026-11-01",
      recurrence: { frequency: "DAILY", interval: 2 },
      reminders: [{ time: new Date("2026-10-31T09:00:00Z") }, { offset: "-PT1H" }],
    });
    await cache.loadTasks(inbox, true);
    const view = cache.getSnapshot().views[0];
    if (!view) throw new Error("Missing view");
    pod.requests.length = 0;
    const plan = await completeTask(view, context(cache));
    expect(plan?.kind).toBe("advance");
    const updated = await store.readTask(original.url);
    expect(updated.task.state).toBe("open");
    expect(updated.task.allDay).toBe("2026-11-03");
    expect(
      updated.task.reminders.map(({ time, offset }) => ({ ...(time ? { time } : { offset }) })),
    ).toEqual([{ time: new Date("2026-11-02T09:00:00Z") }, { offset: "-PT1H" }]);
    const copies = (await store.listTasks(inbox.tracker.stateStore as string)).filter(
      (item) => item.url !== original.url,
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.task.state).toBe("closed");
    expect(copies[0]?.task.clonedFrom).toBe(original.task.id);
    expect(copies[0]?.task.recurrence).toBeUndefined();
    expect(copies[0]?.task.endedAt).toBeInstanceOf(Date);
    expect(
      pod
        .mutations()
        .map((request) => [
          request.method,
          request.headers.get("If-None-Match"),
          request.headers.get("If-Match"),
        ]),
    ).toEqual([
      ["PUT", "*", null],
      ["PUT", null, original.etag],
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      "Completed · next: Tue 3 Nov",
      expect.objectContaining({
        duration: 8000,
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("removes the copy if advancing fails and retries both writes together", async () => {
    const { cache, store, inbox, failures } = await frameCache();
    const original = await store.createTask(inbox, {
      title: "Repeat",
      state: "open",
      dueDate: new Date("2026-11-01T12:00:00Z"),
      recurrence: { frequency: "DAILY", interval: 1 },
    });
    await cache.loadTasks(inbox, true);
    const view = cache.getSnapshot().views[0];
    if (!view) throw new Error("Missing view");
    vi.spyOn(store, "updateTask").mockRejectedValueOnce(new ModelError(412, original.url));
    expect(await completeTask(view, context(cache))).toBeUndefined();
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(1);
    expect((await store.readTask(original.url)).task.dueDate).toEqual(original.task.dueDate);
    failures.mock.calls[0]?.[1]();
    await vi.waitFor(() =>
      expect(cache.getSnapshot().views.filter((item) => item.state === "closed")).toHaveLength(1),
    );
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect((await store.readTask(original.url)).task.dueDate).toEqual(
      new Date("2026-11-02T12:00:00Z"),
    );
  });

  it("closes the original when recurrence is exhausted", async () => {
    const { cache, store, inbox } = await frameCache();
    const original = await store.createTask(inbox, {
      title: "Last",
      state: "open",
      dueDate: new Date("2026-11-01T12:00:00Z"),
      recurrence: { frequency: "DAILY", interval: 1, count: 1 },
    });
    await cache.loadTasks(inbox, true);
    const view = cache.getSnapshot().views[0];
    if (!view) throw new Error("Missing view");
    expect(await completeTask(view, context(cache))).toEqual({ kind: "close" });
    expect((await store.readTask(original.url)).task.state).toBe("closed");
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(1);
  });
});

it("the completion toast's Undo reopens the original and removes endedAt", async () => {
  const { cache, inbox, store } = await frameCache();
  const created = await cache.createTask(inbox, { title: "Done once" });
  const view = cache.getSnapshot().views[0];
  if (!created || !view) throw new Error("Missing task");
  await completeTask(view, context(cache));
  const action = vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error("Missing Undo action");
  action.onClick({} as never);
  await vi.waitFor(async () => {
    const task = (await store.readTask(created.url)).task;
    expect(task.state).toBe("open");
    expect(task.endedAt).toBeUndefined();
  });
});
