// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { planComplete } from "../../src/apps/tasks/lib/views/completion";
import { frameCache } from "./tasks-frame-fixtures";

async function setup() {
  const result = await frameCache();
  const { store, cache, inbox } = result;
  const target = await store.createProject("Target");
  const other = await store.createProject("Other");
  const original = await store.createTask(inbox, {
    title: "Recurring task",
    state: "open",
    dueDate: new Date("2026-11-03T09:00:00Z"),
    recurrence: { frequency: "DAILY", count: 3 },
  });
  const copies = await Promise.all(
    [inbox, other].map((project, index) =>
      store.createTask(project, {
        title: `Occurrence ${index}`,
        state: "closed",
        clonedFrom: original.task.id,
        ...(index === 0 ? { parent: original.task.id } : {}),
        endedAt: new Date("2026-11-01T09:00:00Z"),
      }),
    ),
  );
  const openCopy = await store.createTask(target, {
    title: "Reopened copy",
    state: "open",
    clonedFrom: original.task.id,
  });
  await cache.refreshProjects();
  for (const project of [inbox, target, other]) await cache.loadTasks(project, true);
  return { ...result, target, original, copies, openCopy };
}

describe("moving recurring tasks with completed occurrences", () => {
  it("remaps occurrence links across projects and keeps optimistic and confirmed counts", async () => {
    const { pod, cache, store, original, copies, target, openCopy } = await setup();
    const offset = pod.mutations().length;
    const moving = cache.moveTaskToProject(original, target);
    const optimistic = cache.getSnapshot().views.find((view) => view.title === "Recurring task");
    for (const copy of [...copies, openCopy])
      expect(cache.getSnapshot().views.find((view) => view.url === copy.url)?.derivedFrom).toBe(
        optimistic?.id,
      );
    const moved = await moving;
    if (!moved) throw new Error("Missing moved task");
    for (const [index, copy] of [...copies, openCopy].entries()) {
      const saved = await store.readTask(copy.url);
      expect(saved.task.clonedFrom).toBe(moved.task.id);
      expect(saved.task.parent).toBe(index === 0 ? moved.task.id : undefined);
      expect(saved.task.state).toBe(copy.task.state);
      expect(saved.task.endedAt).toEqual(copy.task.endedAt);
      expect(cache.getSnapshot().views.find((view) => view.url === copy.url)?.derivedFrom).toBe(
        moved.task.id,
      );
      const cached = Object.values(cache.getSnapshot().tasks)
        .flatMap((load) => load.items)
        .find((task) => task.url === copy.url);
      expect(cached?.etag).toBe(saved.etag);
      expect(
        pod
          .mutations()
          .slice(offset)
          .find((request) => request.url === copy.url)
          ?.headers.get("If-Match"),
      ).toBe(copy.etag);
    }
    expect(planComplete(moved, cache.getSnapshot().views, new Date())).toEqual({ kind: "close" });
    expect(await cache.completeTask(moved)).toEqual({ kind: "close" });
    expect((await store.readTask(moved.url)).task.state).toBe("closed");
  });

  it("keeps a reopened occurrence linked through moving and recompleting the original", async () => {
    const { pod, cache, store, original, copies, target } = await setup();
    const copy = copies[1];
    if (!copy) throw new Error("Missing occurrence");
    const reopened = await cache.updateTask(copy, (task) => {
      task.state = "open";
      task.endedAt = undefined;
    });
    if (!reopened) throw new Error("Missing reopened occurrence");
    const moving = cache.moveTaskToProject(original, target);
    const optimistic = cache.getSnapshot().views.find((view) => view.title === "Recurring task");
    expect(cache.getSnapshot().views.find((view) => view.url === copy.url)?.derivedFrom).toBe(
      optimistic?.id,
    );
    const moved = await moving;
    if (!moved) throw new Error("Missing moved task");
    expect(pod.files.has(original.url)).toBe(false);
    expect((await store.readTask(copy.url)).task).toMatchObject({
      state: "open",
      clonedFrom: moved.task.id,
      endedAt: undefined,
    });
    const cached = Object.values(cache.getSnapshot().tasks)
      .flatMap((load) => load.items)
      .find((item) => item.url === copy.url);
    if (!cached) throw new Error("Missing cached occurrence");
    expect(await cache.completeTask(cached)).toEqual({ kind: "close" });
    expect((await store.readTask(copy.url)).task.clonedFrom).toBe(moved.task.id);
    // Both closed occurrences now count towards the moved original's finite recurrence.
    expect(await cache.completeTask(moved)).toEqual({ kind: "close" });
    expect((await store.readTask(moved.url)).task.state).toBe("closed");
  });

  it("conditionally rolls back occurrences on source rejection and retries the full move", async () => {
    const { pod, cache, store, original, copies, target, failures } = await setup();
    let failed = false;
    pod.intercept = (request) => {
      if (!failed && request.method === "DELETE" && request.url === original.url) {
        failed = true;
        return new Response(null, { status: 503 });
      }
    };
    expect(await cache.moveTaskToProject(original, target)).toBeUndefined();
    for (const [index, copy] of copies.entries()) {
      const saved = await store.readTask(copy.url);
      expect(saved.task.clonedFrom).toBe(original.task.id);
      expect(saved.task.parent).toBe(index === 0 ? original.task.id : undefined);
      expect(cache.getSnapshot().views.find((view) => view.url === copy.url)?.derivedFrom).toBe(
        original.task.id,
      );
      const writes = pod
        .mutations()
        .filter((request) => request.method === "PUT" && request.url === copy.url);
      expect(writes).toHaveLength(3); // Create, remap, compensate with the remap's validator.
      expect(writes[2]?.headers.get("If-Match")).not.toBe(copy.etag);
    }
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    const moved = cache
      .getSnapshot()
      .tasks[target.url]?.items.find((task) => task.task.title === "Recurring task");
    if (!moved) throw new Error("Missing moved task");
    for (const copy of copies)
      expect((await store.readTask(copy.url)).task.clonedFrom).toBe(moved.task.id);
    expect(planComplete(moved, cache.getSnapshot().views, new Date())).toEqual({ kind: "close" });
    expect(failures).toHaveBeenCalledOnce();
  });

  it("rolls back earlier references when an occurrence is edited during the move", async () => {
    const { pod, store, inbox, original, copies, target } = await setup();
    const edited = copies[1];
    if (!edited) throw new Error("Missing occurrence");
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === edited.url) {
        pod.intercept = undefined;
        await store.updateTask(edited, (task) => {
          task.description = "Concurrent edit";
        });
      }
    };
    await expect(store.moveTaskToProject(original, inbox, target, "moved")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.files.has(original.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    for (const copy of copies)
      expect((await store.readTask(copy.url)).task.clonedFrom).toBe(original.task.id);
    expect((await store.readTask(edited.url)).task.description).toBe("Concurrent edit");
  });

  it("reconciles a lost occurrence PUT response before deleting the source", async () => {
    const { pod, store, inbox, original, copies, target } = await setup();
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === copies[1]?.url) {
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
    };
    const moved = await store.moveTaskToProject(original, inbox, target, "moved");
    expect(pod.files.has(original.url)).toBe(false);
    for (const copy of copies)
      expect((await store.readTask(copy.url)).task.clonedFrom).toBe(moved.task.id);
  });

  it("retains both originals when a concurrent occurrence edit prevents rollback", async () => {
    const { pod, store, inbox, original, copies, target } = await setup();
    const edited = copies[1];
    if (!edited) throw new Error("Missing occurrence");
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === original.url) {
        await store.updateTask(await store.readTask(edited.url), (task) => {
          task.description = "Keep this edit";
        });
        return new Response(null, { status: 503 });
      }
    };
    await expect(store.moveTaskToProject(original, inbox, target, "moved")).rejects.toBeInstanceOf(
      AggregateError,
    );
    const saved = await store.readTask(edited.url);
    expect(saved.task.description).toBe("Keep this edit");
    expect(saved.task.clonedFrom).toBe(`${target.tracker.stateStore}moved.ttl#it`);
    expect(pod.files.has(original.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
  });
});
