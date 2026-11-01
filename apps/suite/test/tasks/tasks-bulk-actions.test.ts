// AUTHORED-BY Claude Opus 5.5
import { toast } from "@jeswr/suite-ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProject } from "../../src/apps/tasks/lib/model/store";
import type { TaskView } from "../../src/apps/tasks/lib/views/types";
import {
  bulkWrite,
  completeTasks,
  deleteTasks,
  labelTasks,
  moveTasksToProject,
  prioritizeTasks,
  rescheduleMany,
} from "../../src/apps/tasks/state/bulk-actions";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@jeswr/suite-ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
const success = vi.mocked(toast.success);
const error = vi.mocked(toast.error);
beforeEach(() => {
  vi.clearAllMocks();
});

const context = (cache: TasksCache) => ({
  cache,
  updateTask: cache.updateTask.bind(cache),
  moveTaskToProject: cache.moveTaskToProject.bind(cache),
  ensureLabels: cache.ensureLabels.bind(cache),
});
type Options = { action?: { onClick: () => void }; onAutoClose?: () => void };
const lastOptions = (spy: typeof success | typeof error) =>
  spy.mock.calls.at(-1)?.[1] as unknown as Options;
async function seeded(titles: string[]) {
  const result = await frameCache();
  for (const title of titles) await result.cache.createTask(result.inbox, { title });
  const views = () =>
    titles.map(
      (title) => result.cache.getSnapshot().views.find((task) => task.title === title) as TaskView,
    );
  return { ...result, views };
}

describe("bulk writes", () => {
  it("keeps at most four writes in flight and preserves input order", async () => {
    const { cache, views } = await seeded(["a", "b", "c", "d", "e", "f"]);
    let inFlight = 0;
    let peak = 0;
    const result = await bulkWrite("Touched", views(), context(cache), async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    expect(peak).toBe(4);
    expect(result.done.map((task) => task.title)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(success).toHaveBeenCalledWith("Touched 6 tasks", undefined);
  });

  it("completes the selection with one summary toast and one Undo", async () => {
    const { cache, store, views } = await seeded(["a", "b", "c"]);
    const closedAlready = { ...views()[0], state: "closed" } as TaskView;
    await completeTasks([...views(), closedAlready], context(cache));
    expect(success).toHaveBeenCalledOnce();
    expect(success.mock.calls[0]?.[0]).toBe("Completed 3 tasks");
    for (const view of views()) expect((await store.readTask(view.url)).task.state).toBe("closed");
    lastOptions(success).action?.onClick();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    for (const view of views()) expect((await store.readTask(view.url)).task.state).toBe("open");
  });

  it("summarises a partial failure and retries exactly the failed tasks", async () => {
    const { cache, pod, store, views } = await seeded(["a", "b", "c"]);
    const failing = views()[1]?.url;
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === failing
        ? new Response(null, { status: 500 })
        : undefined;
    const result = await prioritizeTasks(views(), 1, context(cache));
    expect(result.failed.map(({ item }) => item.title)).toEqual(["b"]);
    expect(error).toHaveBeenCalledWith(
      "Set P1 on 2 of 3 — 1 failed",
      expect.objectContaining({ description: "Failed: b" }),
    );
    pod.intercept = undefined;
    pod.requests.length = 0;
    lastOptions(error).action?.onClick();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Set P1 on 1 task", undefined));
    expect(pod.mutations().map((request) => request.url)).toEqual([failing]);
    for (const view of views()) expect((await store.readTask(view.url)).task.priority).toBe("high");
  });

  it("reschedules, keeping each task's wall time", async () => {
    const { cache, store, inbox } = await frameCache();
    await cache.createTask(inbox, { title: "Timed", due: new Date("2026-11-02T17:00:00Z") });
    const timed = cache.getSnapshot().views[0] as TaskView;
    await rescheduleMany([timed], "2026-11-05", context(cache));
    expect((await store.readTask(timed.url)).task.dueDate?.toISOString()).toBe(
      "2026-11-05T17:00:00.000Z",
    );
    expect(success).toHaveBeenCalledWith("Rescheduled 1 task", undefined);
  });

  it("moves only the tasks that are not already in the target project", async () => {
    const { cache, store, inbox, views } = await seeded(["a", "b"]);
    const home = (await cache.createProject("Home")) as StoredProject;
    await cache.loadTasks(home);
    await moveTasksToProject(views(), home, context(cache));
    expect(await store.listTasks(home.tracker.stateStore as string)).toHaveLength(2);
    expect(success).toHaveBeenLastCalledWith("Moved 2 tasks", undefined);
    const moved = cache.getSnapshot().views;
    await moveTasksToProject(moved, home, context(cache));
    expect(success).toHaveBeenLastCalledWith("Moved 0 tasks", undefined);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(0);
  });

  it("adds a union label, materialising the class once per tracker, and removes it", async () => {
    const { cache, store, inbox, views } = await seeded(["a", "b"]);
    await labelTasks(views(), "Bills", true, context(cache));
    const label = cache.getSnapshot().projects.find((project) => project.url === inbox.url)
      ?.tracker.labels;
    expect(label?.map((item) => item.name)).toEqual(["Bills"]);
    const id = label?.[0]?.id as string;
    for (const view of views())
      expect((await store.readTask(view.url)).task.types.has(id)).toBe(true);
    expect(success).toHaveBeenLastCalledWith("Labelled @Bills on 2 tasks", undefined);
    await labelTasks(views(), "bills", false, context(cache));
    for (const view of views())
      expect((await store.readTask(view.url)).task.types.has(id)).toBe(false);
    expect(success).toHaveBeenLastCalledWith("Removed @bills from 2 tasks", undefined);
  });

  it("fails the label write when its class cannot be created", async () => {
    const { cache, pod, inbox, views } = await seeded(["a"]);
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === inbox.url
        ? new Response(null, { status: 500 })
        : undefined;
    const result = await labelTasks(views(), "Bills", true, context(cache));
    expect(result.failed).toHaveLength(1);
    expect(error).toHaveBeenCalledWith("Labelled @Bills on 0 of 1 — 1 failed", expect.anything());
  });

  it("deletes a batch behind one delayed toast with a single Undo", async () => {
    const { cache, store, inbox, views } = await seeded(["a", "b", "c"]);
    const batch = views().slice(0, 2);
    expect(deleteTasks(batch, context(cache))).toBe(2);
    expect(success).toHaveBeenCalledWith("Deleted 2 tasks", expect.anything());
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["c"]);
    lastOptions(success).action?.onClick();
    expect(
      cache
        .getSnapshot()
        .views.map((task) => task.title)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(3);

    const first = views().slice(0, 1);
    expect(deleteTasks(first, context(cache))).toBe(1);
    expect(success).toHaveBeenLastCalledWith("Deleted 'a'", expect.anything());
    // A second request for a pending row is ignored.
    expect(deleteTasks(first, context(cache))).toBe(0);
    lastOptions(success).onAutoClose?.();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(2);
    expect(toast.dismiss).toHaveBeenCalled();
    expect(deleteTasks([{ ...batch[0], url: "missing" } as TaskView], context(cache))).toBe(0);
  });
});
