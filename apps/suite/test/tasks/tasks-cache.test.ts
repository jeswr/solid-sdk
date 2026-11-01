// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import {
  changeProject,
  changeTask,
  moveItem,
  optimisticValue,
  sortedProjects,
} from "../../src/apps/tasks/state/mutations";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, Pod, storage, webId } from "./pod";

async function setup() {
  const pod = new Pod();
  const store = new TaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    now: () => now,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
    ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
  });
  const failures = vi.fn();
  const cache = new TasksCache(store, failures, webId);
  await cache.start();
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Expected Inbox");
  await cache.loadTasks(inbox);
  return { pod, store, cache, failures, inbox };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
describe("Tasks cache and pure optimistic helpers", () => {
  it("bootstraps once, publishes local rows immediately and retains conditional validators", async () => {
    const { cache, pod, inbox } = await setup();
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    const writes = pod.mutations().length;
    await cache.start();
    expect(pod.mutations()).toHaveLength(writes);
    const creating = cache.createTask(inbox, {
      title: "Pay rent",
      position: 3,
      allDay: "2026-11-01",
    });
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("Pay rent");
    const optimisticUrl = cache.getSnapshot().tasks[inbox.url]?.items[0]?.url;
    const task = await creating;
    if (!task) throw new Error("Expected task");
    expect(task.url).toBe(optimisticUrl);
    expect(cache.getSnapshot().tasks[inbox.url]?.items).toHaveLength(1);
    expect(task.etag).toBeTruthy();
    expect(task.task.allDay).toBe("2026-11-01");
    const copy = changeTask(task, (task) => {
      task.title = "Different";
    });
    expect(task.task.title).toBe("Pay rent");
    expect(copy.task.title).toBe("Different");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it("rebases later edits after an earlier failure and uses the latest ETag", async () => {
    const { cache, store, failures, inbox } = await setup();
    const task = await cache.createTask(inbox, { title: "Original" });
    if (!task) throw new Error("Expected task");
    const first = deferred<never>();
    const entered = deferred<void>();
    vi.spyOn(store, "updateTask").mockImplementationOnce(() => {
      entered.resolve();
      return first.promise;
    });
    const title = cache.updateTask(task, (task) => {
      task.title = "Failed title";
    });
    const priority = cache.updateTask(task, (task) => {
      task.priority = "high";
    });
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.priority).toBe("high");
    await entered.promise;
    first.reject(new Error("Write failed"));
    expect(await title).toBeUndefined();
    await priority;
    const visible = cache.getSnapshot().tasks[inbox.url]?.items[0];
    expect(visible?.task.title).toBe("Original");
    expect(visible?.task.priority).toBe("high");
    expect((await store.readTask(task.url)).task.priority).toBe("high");
    expect(failures).toHaveBeenCalledOnce();
    const a = cache.updateTask(visible ?? task, (task) => {
      task.title = "Second";
    });
    const b = cache.updateTask(visible ?? task, (task) => {
      task.title = "Third";
    });
    await Promise.all([a, b]);
    expect((await store.readTask(task.url)).task.title).toBe("Third");
    expect(failures).toHaveBeenCalledOnce();
  });
  it("does not resurrect either of two failed optimistic writes, and retries against refreshed state", async () => {
    const { cache, store, inbox, failures } = await setup();
    const task = await cache.createTask(inbox, { title: "Baseline" });
    if (!task) throw new Error("Expected task");
    vi.spyOn(store, "updateTask")
      .mockRejectedValueOnce(new ModelError(412, task.url))
      .mockRejectedValueOnce(new Error("Again"));
    await Promise.all([
      cache.updateTask(task, (task) => {
        task.title = "one";
      }),
      cache.updateTask(task, (task) => {
        task.title = "two";
      }),
    ]);
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("Baseline");
    expect(failures.mock.calls[0]?.[0]).toMatchObject({ status: 412 });
    failures.mock.calls[1]?.[1]();
    await vi.waitFor(() =>
      expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("two"),
    );
  });
  it("loads independently, clears forbidden cached data and prefix-invalidates remote changes", async () => {
    const { cache, store, inbox, pod } = await setup();
    const home = await cache.createProject("Home");
    if (!home) throw new Error("Expected project");
    await cache.loadTasks(home);
    const task = await cache.createTask(inbox, { title: "Initial" });
    if (!task) throw new Error("Expected task");
    await store.updateTask(task, (task) => {
      task.title = "Remote";
    });
    await cache.invalidate(task.url);
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("Remote");
    pod.intercept = (request) =>
      request.url === home.tracker.stateStore && request.method === "GET"
        ? new Response(null, { status: 403 })
        : undefined;
    await cache.loadTasks(home, true);
    expect(cache.getSnapshot().tasks[home.url]).toMatchObject({ status: "error", items: [] });
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("Remote");
  });
  it("ignores a stale list response racing a local mutation and reloads it", async () => {
    const { cache, store, inbox } = await setup();
    const task = await cache.createTask(inbox, { title: "Before" });
    if (!task) throw new Error("Expected task");
    const read = deferred<(typeof task)[]>();
    vi.spyOn(store, "listTasks").mockReturnValueOnce(read.promise);
    const loading = cache.loadTasks(inbox, true);
    await cache.updateTask(task, (task) => {
      task.title = "After";
    });
    read.resolve([task]);
    await loading;
    await vi.waitFor(() => expect(cache.getSnapshot().tasks[inbox.url]?.status).toBe("ready"));
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.title).toBe("After");
  });
  it("supports sections, project ordering, archive and delete through conditional writes", async () => {
    const { cache, inbox } = await setup();
    const home = await cache.createProject("Home");
    const work = await cache.createProject("Work");
    if (!home || !work) throw new Error("Expected projects");
    await cache.loadTasks(home);
    await cache.addSection(home, "Doing");
    await cache.addSection(home, "Later");
    let current = cache.getSnapshot().projects.find((project) => project.url === home.url) ?? home;
    const section = current.tracker.sections[0];
    if (!section) throw new Error("Expected section");
    await cache.renameSection(current, section.id, "In progress");
    await cache.moveSection(current, section.id, "down");
    const task = await cache.createTask(current, { title: "Section task", sectionId: section.id });
    if (!task) throw new Error("Expected task");
    await cache.deleteSection(current, section.id);
    expect(cache.getSnapshot().tasks[home.url]?.items[0]?.task.types.has(section.id)).toBe(false);
    await cache.deleteTask(task);
    expect(cache.getSnapshot().tasks[home.url]?.items).toEqual([]);
    await cache.moveProject(work, "up");
    expect(cache.getSnapshot().projects.map((project) => project.url)).toEqual([
      inbox.url,
      work.url,
      home.url,
    ]);
    await cache.renameProject(home, "House");
    current = cache.getSnapshot().projects.find((project) => project.url === home.url) ?? home;
    expect(current.tracker.title).toBe("House");
    const archived = changeProject(current, (tracker) => {
      tracker.archivedAt = now;
    });
    expect(sortedProjects([archived, work, inbox], inbox.url)).toEqual([inbox, work]);
    await cache.archiveProject(home);
    expect(cache.getSnapshot().projects.map((project) => project.url)).not.toContain(home.url);
    await cache.deleteProject(work);
    expect(cache.getSnapshot().projects).toHaveLength(1);
  });
  it("retains a cached empty list during refresh and re-reads when a notification arrives mid-read", async () => {
    const { cache, store, inbox } = await setup();
    const pending = deferred<Awaited<ReturnType<TaskStore["listTasks"]>>>();
    const reads = vi.spyOn(store, "listTasks").mockReturnValueOnce(pending.promise);
    const first = cache.loadTasks(inbox, true);
    expect(cache.getSnapshot().tasks[inbox.url]?.status).toBe("ready");
    void cache.loadTasks(inbox, true);
    pending.resolve([]);
    await first;
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  });

  it("uses cached container membership when a cross-app task has no tracker predicate", async () => {
    const { cache, store, inbox } = await setup();
    const created = await cache.createTask(inbox, { title: "From another app" });
    if (!created) throw new Error("Expected task");
    const task = await store.updateTask(created, (task) => {
      task.project = undefined;
    });
    await cache.invalidate(task.url);
    const completed = await cache.updateTask(task, (task) => {
      task.state = "closed";
    });
    expect(completed?.task.state).toBe("closed");
    await cache.deleteTask(completed ?? task);
    expect(
      await cache.updateTask(task, (task) => {
        task.title = "Stale";
      }),
    ).toBeUndefined();
    expect(await cache.deleteTask(task)).toBeUndefined();
  });

  it("ensures labels before task creation and persists every composer property", async () => {
    const { cache, store, inbox, pod } = await setup();
    const home = await cache.createProject("Home");
    if (!home) throw new Error("Expected Home");
    await cache.updateProject(home, (tracker) => {
      tracker.defineCategory("Label", "Bills", undefined, "var(--warning)");
    });
    const labelled = await cache.ensureLabels(inbox, ["Bills", "BILLS", "shopping"]);
    if (!labelled) throw new Error("Expected labels");
    expect(labelled.tracker.labels).toHaveLength(2);
    expect(labelled.tracker.labels.find((label) => label.name === "Bills")?.color).toBe(
      "var(--warning)",
    );
    const writeCount = pod.mutations().length;
    await cache.ensureLabels(inbox, ["bills"]);
    expect(pod.mutations()).toHaveLength(writeCount);
    const labelId = labelled.tracker.labels[0]?.id;
    if (!labelId) throw new Error("Expected label id");
    const parent = await cache.createTask(labelled, {
      title: "Parent",
      due: now,
      labelIds: [labelId],
      priority: "medium",
      recurrence: { frequency: "DAILY", interval: 2 },
      reminders: [{ offset: "-PT1H" }],
    });
    if (!parent) throw new Error("Expected parent");
    const [child, sibling] = await Promise.all([
      cache.createTask(labelled, { title: "Child", parent: parent.task.id }),
      cache.createTask(labelled, { title: "Sibling" }),
    ]);
    const stored = (await store.readTask(parent.url)).task;
    expect(stored.priority).toBe("medium");
    expect(stored.recurrence?.interval).toBe(2);
    expect(stored.reminders).toMatchObject([{ offset: "-PT1H" }]);
    expect(stored.types.has(labelId)).toBe(true);
    expect(child?.task.parent).toBe(parent.task.id);
    expect(parent.task.rank).toBe(1);
    expect(child?.task.rank).toBe(1);
    expect(sibling?.task.rank).toBe(2);
    const persisted = await store.readProject(inbox.url);
    expect(persisted.tracker.labels).toHaveLength(2);
  });
  it("appends after cross-app tasks with no position by persisting the shared renumber plan", async () => {
    const { cache, store, inbox } = await setup();
    const first = await cache.createTask(inbox, { title: "Ranked", position: 8 });
    if (!first) throw new Error("Expected ranked task");
    const foreign = await store.createTask(inbox, { title: "From another app", state: "open" });
    await cache.invalidate(foreign.url);
    const added = await cache.createTask(inbox, { title: "Last" });
    expect((await store.readTask(first.url)).task.rank).toBe(1);
    expect((await store.readTask(foreign.url)).task.rank).toBe(2);
    expect(added?.task.rank).toBe(3);
  });
  it("serializes simultaneous label ensures and rolls failed definitions back", async () => {
    const { cache, store, inbox, failures } = await setup();
    await Promise.all([
      cache.ensureLabels(inbox, ["new"]),
      cache.ensureLabels(inbox, ["NEW", "other"]),
    ]);
    expect(
      cache
        .getSnapshot()
        .projects[0]?.tracker.labels.map((label) => label.name)
        .sort(),
    ).toEqual(["new", "other"]);
    vi.spyOn(store, "updateProject").mockRejectedValueOnce(new Error("No write"));
    expect(await cache.ensureLabels(inbox, ["failed"])).toBeUndefined();
    expect(
      cache.getSnapshot().projects[0]?.tracker.labels.some((label) => label.name === "failed"),
    ).toBe(false);
    expect(failures).toHaveBeenCalledOnce();
  });

  it("moves only within bounds and recomputes overlays from the confirmed baseline", () => {
    expect(moveItem([1, 2], 0, "up")).toEqual([1, 2]);
    expect(moveItem([1, 2], 1, "down")).toEqual([1, 2]);
    expect(moveItem([1, 2], -1, "down")).toEqual([1, 2]);
    expect(moveItem([1, 2], 0, "down")).toEqual([2, 1]);
    expect(
      optimisticValue({ title: "Original", priority: 4 }, [(state) => ({ ...state, priority: 1 })]),
    ).toEqual({ title: "Original", priority: 1 });
  });
});
