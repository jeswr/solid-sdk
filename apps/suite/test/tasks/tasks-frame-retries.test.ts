// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { planComplete } from "../../src/apps/tasks/lib/views/completion";
import { frameCache } from "./tasks-frame-fixtures";

afterEach(() => vi.restoreAllMocks());

async function recurring(count?: number) {
  const result = await frameCache();
  const original = await result.store.createTask(result.inbox, {
    title: "Repeat",
    state: "open",
    dueDate: new Date("2026-11-01T12:00:00Z"),
    recurrence: { frequency: "DAILY", count },
    reminders: [{ time: new Date("2026-11-01T11:00:00Z") }],
  });
  await result.cache.loadTasks(result.inbox, true);
  const plan = planComplete(
    original,
    result.cache.getSnapshot().views,
    new Date("2026-11-01T12:00:00Z"),
  );
  if (plan.kind !== "advance") throw new Error("Expected recurring plan");
  return { ...result, original, plan };
}

async function retry(result: Awaited<ReturnType<typeof frameCache>>, failure = 0) {
  result.failures.mock.calls[failure]?.[1]();
  await vi.waitFor(() => expect(result.cache.getSnapshot().saving).toEqual([]));
}

describe("task creation retry identity", () => {
  it("reconciles a committed PUT with a lost response without creating a second task", async () => {
    const result = await frameCache();
    const { pod, cache, inbox, store } = result;
    const creates = vi.spyOn(store, "createTask");
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.headers.get("If-None-Match") === "*") {
        pod.seed(request.url, request.body);
        throw new TypeError("Connection lost after commit");
      }
      return undefined;
    };
    expect(await cache.createTask(inbox, { title: "Pay rent" })).toBeUndefined();
    const url = cache.getSnapshot().views[0]?.url;
    pod.intercept = undefined;
    pod.requests.length = 0;
    await retry(result);
    expect(creates).toHaveBeenCalledOnce();
    expect(pod.requests[0]).toMatchObject({ method: "GET", url });
    expect(cache.getSnapshot().views.map((task) => [task.url, task.title])).toEqual([
      [url, "Pay rent"],
    ]);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(1);
  });

  it("GETs the reservation before retrying an uncommitted create with the same UUID", async () => {
    const result = await frameCache();
    const { cache, inbox, store, pod } = result;
    const creates = vi
      .spyOn(store, "createTask")
      .mockRejectedValueOnce(new ModelError(503, inbox.url));
    await cache.createTask(inbox, { title: "Pay rent" });
    const id = creates.mock.calls[0]?.[2];
    pod.requests.length = 0;
    await retry(result);
    expect(creates.mock.calls.map((args) => args[2])).toEqual([id, id]);
    expect(pod.requests.slice(0, 2).map((request) => [request.method, request.url])).toEqual([
      ["GET", `${inbox.tracker.stateStore}${id}.ttl`],
      ["PUT", `${inbox.tracker.stateStore}${id}.ttl`],
    ]);
    expect(cache.getSnapshot().views).toHaveLength(1);
  });
});

describe("recurring completion retry recovery", () => {
  it.each([
    "2026-12-01T12:00:00Z",
    "2026-11-02T12:00:00Z",
  ])("replans from a remote reschedule to %s, including newer reminders", async (due) => {
    const result = await recurring();
    const { cache, store, original, plan, inbox } = result;
    const remote = await store.updateTask(original, (task) => {
      task.dueDate = new Date(due);
      task.reminders = [{ time: new Date(new Date(due).getTime() - 7_200_000) }];
    });
    expect(await cache.advanceTask(original, plan)).toBeUndefined();
    await retry(result);
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    const updated = tasks.find((task) => task.url === original.url);
    const copies = tasks.filter((task) => task.task.clonedFrom === original.task.id);
    expect(updated?.task.dueDate).toEqual(new Date(new Date(due).getTime() + 86_400_000));
    expect(updated?.task.reminders[0]?.time).toEqual(
      new Date(new Date(due).getTime() + 79_200_000),
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.task.dueDate).toEqual(remote.task.dueDate);
    expect(copies[0]?.url).toBe(plan.copyUrl);
  });

  it("returns an updated undo snapshot when an earlier queued edit changes the schedule", async () => {
    const { cache, store, original, plan } = await recurring();
    const due = new Date("2026-12-01T12:00:00Z");
    const updating = cache.updateTask(original, (task) => {
      task.dueDate = due;
    });
    const completing = cache.advanceTask(original, plan);
    await updating;
    const result = await completing;
    if (result?.kind !== "advance") throw new Error("Expected updated plan");
    expect(result.previous.dueDate).toEqual(due);
    expect(result.copy.dueDate).toEqual(due);
    expect(result.next).toEqual(new Date("2026-12-02T12:00:00Z"));
    expect((await store.readTask(original.url)).task.dueDate).toEqual(result.next);
  });

  it("closes without another copy when a refreshed recurrence rule is exhausted", async () => {
    const result = await recurring(2);
    const { cache, store, inbox, original, plan } = result;
    await store.updateTask(original, (task) => {
      task.recurrence = { frequency: "DAILY", count: 1 };
    });
    expect(await cache.advanceTask(original, plan)).toBeUndefined();
    await retry(result);
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task.state).toBe("closed");
    expect(tasks[0]?.task.dueDate).toEqual(original.task.dueDate);
  });

  it("finishes failed compensation before creating the same copy again without consuming count", async () => {
    const result = await recurring(2);
    const { cache, store, original, plan, inbox } = result;
    const creates = vi.spyOn(store, "createTask");
    const updates = vi
      .spyOn(store, "updateTask")
      .mockRejectedValueOnce(new ModelError(412, original.url));
    const deletes = vi
      .spyOn(store, "deleteTask")
      .mockRejectedValueOnce(new ModelError(503, original.url))
      .mockRejectedValueOnce(new ModelError(503, original.url));
    expect(await cache.advanceTask(original, plan)).toBeUndefined();
    expect(cache.getSnapshot().views.filter((task) => task.state === "closed")).toHaveLength(1);
    await retry(result);
    expect(result.failures).toHaveBeenCalledTimes(2);
    expect(creates).toHaveBeenCalledOnce();
    expect(updates).toHaveBeenCalledOnce();
    await retry(result, 1);
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.url === original.url)?.task.state).toBe("open");
    expect(tasks.find((task) => task.url === original.url)?.task.dueDate).toEqual(
      new Date("2026-11-02T12:00:00Z"),
    );
    expect(
      tasks.filter((task) => task.task.clonedFrom === original.task.id).map((task) => task.url),
    ).toEqual([plan.copyUrl]);
    expect(deletes.mock.calls.map(([task]) => task.url)).toEqual([
      plan.copyUrl,
      plan.copyUrl,
      plan.copyUrl,
    ]);
    expect(new Set(creates.mock.calls.map((args) => args[2])).size).toBe(1);
    expect(result.failures).toHaveBeenCalledTimes(2);
    const current = cache
      .getSnapshot()
      .tasks[inbox.url]?.items.find((task) => task.url === original.url);
    if (!current) throw new Error("Missing original");
    await cache.updateTask(current, (task) => {
      task.title = "Newer title";
    });
    await retry(result);
    expect(cache.getSnapshot().views.find((task) => task.url === original.url)?.title).toBe(
      "Newer title",
    );
    expect(creates).toHaveBeenCalledTimes(2);
  });

  it.each(["copy", "original"])("reconciles a lost %s PUT response", async (lost) => {
    const result = await recurring(2);
    const { cache, store, pod, inbox, original, plan } = result;
    let dropped = false;
    pod.intercept = (request) => {
      if (
        !dropped &&
        request.method === "PUT" &&
        (lost === "original" ? request.url === original.url : request.url !== original.url)
      ) {
        dropped = true;
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
      return undefined;
    };
    await cache.advanceTask(original, plan);
    pod.intercept = undefined;
    if (result.failures.mock.calls.length) await retry(result);
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.url === original.url)?.task.dueDate).toEqual(
      new Date("2026-11-02T12:00:00Z"),
    );
    expect(tasks.filter((task) => task.task.state === "closed").map((task) => task.url)).toEqual([
      plan.copyUrl,
    ]);
  });
});
