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
    expect(toast.success).toHaveBeenCalledWith("Completed · next: Tue 3 Nov");
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
