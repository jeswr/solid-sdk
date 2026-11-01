// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, Pod, storage, webId } from "./pod";

async function setup(recurring = true) {
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
  const project = cache.getSnapshot().projects[0];
  if (!project) throw new Error("Missing Inbox");
  await cache.loadTasks(project);
  const item = await cache.createTask(project, {
    title: "Water plants",
    allDay: "2026-10-25",
    recurrence: recurring ? { frequency: "DAILY", interval: 2 } : undefined,
    reminders: [{ offset: "-PT1H" }],
  });
  if (!item) throw new Error("Missing task");
  return { cache, pod, store, failures, project, item };
}

describe("completion and Undo", () => {
  it("conditionally creates an occurrence and advances, then deletes the owned copy and restores scheduling", async () => {
    const { cache, pod, store, project, item } = await setup();
    const start = pod.requests.length;
    const plan = await cache.completeTask(item, now);
    if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing advance plan");
    expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-27");
    expect((await store.readTask(plan.copyUrl)).task.clonedFrom).toBe(item.task.id);
    expect(await cache.undoCompletion(item, plan)).toBe(true);
    const restored = (await store.readTask(item.url)).task;
    expect(restored.allDay).toBe("2026-10-25");
    expect(restored.reminders).toMatchObject([{ offset: "-PT1H" }]);
    expect(restored.completionOperations.has(plan.copyUrl)).toBe(true);
    expect(pod.files.has(plan.copyUrl)).toBe(false);
    expect(cache.getSnapshot().tasks[project.url]?.items).toHaveLength(1);
    const writes = pod.requests.slice(start).filter((request) => request.method !== "GET");
    expect(writes[0]?.headers.get("If-None-Match")).toBe("*");
    expect(writes.slice(1).every((request) => request.headers.has("If-Match"))).toBe(true);
  });
  it("reopens a closed task and removes endedAt, including complete forever", async () => {
    const { cache, store, item } = await setup();
    const plan = await cache.completeTask(item, now, { forever: true });
    expect(plan).toEqual({ kind: "close" });
    expect((await store.readTask(item.url)).task.state).toBe("closed");
    if (!plan) throw new Error("Missing plan");
    await cache.undoCompletion(item, plan);
    const reopened = (await store.readTask(item.url)).task;
    expect(reopened.state).toBe("open");
    expect(reopened.endedAt).toBeUndefined();
  });
  it("compensates the copy when advancing is definitively rejected", async () => {
    const { cache, store, item, pod } = await setup();
    vi.spyOn(store, "updateTask").mockRejectedValueOnce(new ModelError(412, item.url));
    expect(await cache.completeTask(item, now)).toBeUndefined();
    expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-25");
    expect(
      pod.requests.some(
        (request) => request.method === "DELETE" && request.headers.has("If-Match"),
      ),
    ).toBe(true);
  });
  it("reads back a lost original-update response without creating a second occurrence", async () => {
    const { cache, store, item } = await setup();
    const update = store.updateTask.bind(store);
    vi.spyOn(store, "updateTask").mockImplementationOnce(async (...args) => {
      await update(...args);
      throw new Error("Response lost");
    });
    const plan = await cache.completeTask(item, now);
    expect(plan?.kind).toBe("advance");
    expect(cache.getSnapshot().views).toHaveLength(2);
  });
});

it.each([
  "delete",
  "restore",
])("reconciles a lost Undo %s response before retrying", async (stage) => {
  const { cache, store, item, pod } = await setup();
  const plan = await cache.completeTask(item, now);
  if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing plan");
  if (stage === "delete") {
    const remove = store.deleteTask.bind(store);
    vi.spyOn(store, "deleteTask").mockImplementationOnce(async (copy) => {
      await remove(copy);
      throw new Error("Lost delete response");
    });
  } else {
    const update = store.updateTask.bind(store);
    vi.spyOn(store, "updateTask").mockImplementationOnce(async (...args) => {
      await update(...args);
      throw new Error("Lost restore response");
    });
  }
  expect(await cache.undoCompletion(item, plan)).toBe(true);
  expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-25");
  expect(pod.files.has(plan.copyUrl)).toBe(false);
});
it("retains an unfinished Undo after the copy DELETE and resumes the original restore on Retry", async () => {
  const { cache, store, item, pod, failures } = await setup();
  const plan = await cache.completeTask(item, now);
  if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing plan");
  vi.spyOn(store, "updateTask").mockRejectedValueOnce(new Error("Disconnected"));
  expect(await cache.undoCompletion(item, plan)).toBeUndefined();
  expect(pod.files.has(plan.copyUrl)).toBe(false);
  expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-27");
  failures.mock.calls.at(-1)?.[1]();
  await vi.waitFor(async () =>
    expect((await store.readTask(item.url)).task.allDay).toBe("2026-10-25"),
  );
  expect(
    pod.requests.filter((request) => request.method === "DELETE" && request.url === plan.copyUrl),
  ).toHaveLength(1);
});
it("never deletes a copy edited by another client, even after the cache reloads it", async () => {
  const { cache, store, item, pod } = await setup();
  const plan = await cache.completeTask(item, now);
  if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing plan");
  await store.updateTask(await store.readTask(plan.copyUrl), (task) => {
    task.title = "Other client's occurrence";
  });
  await cache.invalidate(plan.copyUrl);
  const offset = pod.requests.length;
  expect(await cache.undoCompletion(item, plan)).toBeUndefined();
  expect(pod.requests.slice(offset).filter((request) => request.method === "DELETE")).toHaveLength(
    0,
  );
  expect((await store.readTask(plan.copyUrl)).task.title).toBe("Other client's occurrence");
});
it("rejects a stale scheduling Undo before deleting its copy", async () => {
  const { cache, store, item, pod } = await setup();
  const plan = await cache.completeTask(item, now);
  if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing plan");
  await store.updateTask(await store.readTask(item.url), (task) => {
    task.allDay = "2026-12-12";
  });
  expect(await cache.undoCompletion(item, plan)).toBeUndefined();
  expect(pod.files.has(plan.copyUrl)).toBe(true);
  expect((await store.readTask(item.url)).task.allDay).toBe("2026-12-12");
});
it("preserves unrelated edits and previous completion markers, and a duplicate Undo cannot undo newer edits", async () => {
  const { cache, store, item } = await setup();
  await cache.updateTask(item, (task) => {
    task.completionOperations.add(`${storage}earlier.ttl`);
  });
  const plan = await cache.completeTask(
    cache.getSnapshot().tasks[cache.inboxUrl]?.items[0] ?? item,
    now,
  );
  if (!plan) throw new Error("Missing plan");
  await cache.updateTask(item, (task) => {
    task.description = "New note";
  });
  await cache.undoCompletion(item, plan);
  expect((await store.readTask(item.url)).task.description).toBe("New note");
  expect(
    (await store.readTask(item.url)).task.completionOperations.has(`${storage}earlier.ttl`),
  ).toBe(true);
  await cache.updateTask(item, (task) => {
    task.allDay = "2026-12-12";
  });
  await cache.undoCompletion(item, plan);
  expect((await store.readTask(item.url)).task.allDay).toBe("2026-12-12");
});
it("conditionally reopens an ordinary task, reconciling a lost reopen response", async () => {
  const { cache, store, item } = await setup(false);
  const plan = await cache.completeTask(item, now);
  if (!plan) throw new Error("Missing plan");
  const update = store.updateTask.bind(store);
  vi.spyOn(store, "updateTask").mockImplementationOnce(async (...args) => {
    await update(...args);
    throw new Error("Lost reopen response");
  });
  expect(await cache.undoCompletion(item, plan)).toBe(true);
  expect((await store.readTask(item.url)).task.endedAt).toBeUndefined();
});
