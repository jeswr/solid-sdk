// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { NS, node } from "../../src/apps/tasks/lib/model/rdf";
import type { StoredTask } from "../../src/apps/tasks/lib/model/store";
import { taskDetails } from "../../src/apps/tasks/lib/model/task";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { webId } from "./pod";
import { frameCache, frameStore } from "./tasks-frame-fixtures";

afterEach(() => vi.restoreAllMocks());

const now = new Date("2026-11-01T12:00:00Z");
const next = new Date("2026-11-02T12:00:00Z");

async function recurring(count = 2, allDay?: string) {
  const result = await frameCache();
  const original = await result.store.createTask(result.inbox, {
    title: "Repeat",
    state: "open",
    dueDate: now,
    allDay,
    recurrence: { frequency: "DAILY", count },
    reminders: [{ time: new Date("2026-11-01T11:00:00Z") }, { offset: "-PT1H" }],
  });
  await result.cache.loadTasks(result.inbox, true);
  return { ...result, original };
}
type Fixture = Awaited<ReturnType<typeof recurring>>;

async function copy(result: Fixture, id: string, due = now, endedAt = now) {
  const data = taskDetails(result.original.url, result.original.dataset);
  if (!data) throw new Error("Missing task data");
  const url = `${result.inbox.tracker.stateStore}${id}.ttl`;
  return result.store.createTask(
    result.inbox,
    {
      ...data,
      dueDate: due,
      state: "closed",
      endedAt,
      clonedFrom: result.original.task.id,
      recurrence: undefined,
      reminders: [],
      completionOperations: [url],
    },
    id,
  );
}

async function reload(result: Fixture) {
  const store = frameStore(result.pod);
  const failures = vi.fn();
  const notices = vi.fn();
  const cache = new TasksCache(store, failures, webId, notices);
  await cache.start();
  const project = cache.getSnapshot().projects.find((item) => item.url === result.inbox.url);
  if (!project) throw new Error("Missing reloaded project");
  await cache.loadTasks(project);
  const original = cache
    .getSnapshot()
    .tasks[project.url]?.items.find((item) => item.url === result.original.url);
  if (!original) throw new Error("Missing reloaded original");
  result.pod.requests.length = 0;
  return { cache, store, failures, notices, original };
}

describe("recurring completion recovery after reload", () => {
  it.each([2, 3])("recovers a lost monthly completion before Skip (COUNT=%s)", async (count) => {
    const result = await recurring(count);
    result.original = await result.store.updateTask(result.original, (task) => {
      task.allDay = "2026-11-20";
      task.recurrence = { frequency: "MONTHLY", byDay: ["Friday"], bySetPos: 3, count };
      task.reminders = [{ time: new Date("2026-11-19T18:00:00Z") }, { offset: "-PT1H" }];
    });
    await result.cache.loadTasks(result.inbox, true);
    let copyUrl: string | undefined;
    result.pod.intercept = (request) => {
      if (request.method === "PUT" && request.headers.get("If-None-Match") === "*") {
        copyUrl = request.url;
        result.pod.seed(request.url, request.body);
        throw new TypeError("Occurrence PUT committed; response lost");
      }
      return undefined;
    };
    expect(await result.cache.completeTask(result.original, now)).toBeUndefined();
    expect(result.failures).toHaveBeenCalledOnce();
    result.pod.intercept = undefined;

    const { cache, store, original, failures, notices } = await reload(result);
    const plan = await cache.skipTask(original, now);
    expect(plan).toMatchObject({
      kind: count === 2 ? "close" : "advance",
      previous: { allDay: "2026-12-18", state: "open" },
      original: { allDay: count === 2 ? "2026-12-18" : "2027-01-15" },
    });
    const updated = await store.readTask(original.url);
    expect(updated.task.allDay).toBe(count === 2 ? "2026-12-18" : "2027-01-15");
    expect(updated.task.state).toBe(count === 2 ? "closed" : "open");
    expect(updated.task.recurrence?.count).toBe(count);
    expect([...updated.task.completionOperations]).toEqual([copyUrl]);
    const history = (await store.listTasks(result.inbox.tracker.stateStore as string)).filter(
      (item) => item.task.clonedFrom === original.task.id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.url).toBe(copyUrl);
    expect(history[0]?.task.allDay).toBe("2026-11-20");
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
      ["PUT", original.url],
    ]);
    expect(result.pod.mutations().every((request) => request.headers.has("If-Match"))).toBe(true);
    expect(failures).not.toHaveBeenCalled();
    expect(notices).not.toHaveBeenCalled();

    if (!plan) throw new Error("Missing skip plan");
    await cache.undoSkip(original, plan);
    const restored = await store.readTask(original.url);
    expect(restored.task.state).toBe("open");
    expect(restored.task.allDay).toBe("2026-12-18");
    expect(restored.task.reminders).toHaveLength(2);
    expect(restored.task.reminders).toEqual(
      expect.arrayContaining([
        { time: new Date("2026-12-17T18:00:00Z"), id: expect.any(String) },
        { offset: "-PT1H", id: expect.any(String) },
      ]),
    );
    expect([...restored.task.completionOperations]).toEqual([copyUrl]);
    expect((await store.readTask(copyUrl as string)).task.allDay).toBe("2026-11-20");
  });

  it("blocks Skip with an actionable notice when persisted completion recovery fails", async () => {
    const result = await recurring(3);
    const orphan = await copy(result, "orphan");
    const { cache, store, original, failures, notices } = await reload(result);
    result.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;

    expect(await cache.skipTask(original, now)).toBeUndefined();
    expect(notices).toHaveBeenCalledWith("Couldn't check this task's history. Try again.");
    expect(failures).toHaveBeenCalledOnce();
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
    ]);
    expect((await store.readTask(original.url)).etag).toBe(original.etag);
    expect((await store.readTask(orphan.url)).etag).toBe(orphan.etag);
    expect(cache.getSnapshot().views.find((item) => item.url === original.url)?.due).toEqual(now);
  });

  it.each([
    false,
    true,
  ])("retries failed completion recovery on every Skip (refresh: %s)", async (refresh) => {
    const result = await recurring(3);
    const orphan = await copy(result, "orphan");
    const { cache, store, original, failures, notices } = await reload(result);
    result.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;

    expect(await cache.skipTask(original, now)).toBeUndefined();
    expect(notices).toHaveBeenCalledExactlyOnceWith(
      "Couldn't check this task's history. Try again.",
    );
    if (refresh) await cache.loadTasks(result.inbox, true);

    expect(await cache.skipTask(original, now)).toBeUndefined();
    expect(notices).toHaveBeenCalledTimes(2);
    expect(notices).toHaveBeenLastCalledWith("Couldn't check this task's history. Try again.");
    expect(failures).toHaveBeenCalledTimes(2);
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
      ["PUT", original.url],
    ]);
    expect((await store.readTask(original.url)).etag).toBe(original.etag);
    expect((await store.readTask(orphan.url)).etag).toBe(orphan.etag);

    result.pod.intercept = undefined;
    const skipped = new Date("2026-11-03T12:00:00Z");
    expect(await cache.skipTask(original, now)).toMatchObject({
      kind: "advance",
      previous: { dueDate: next },
      original: { dueDate: skipped },
    });
    const updated = await store.readTask(original.url);
    expect(updated.task.dueDate).toEqual(skipped);
    expect(updated.task.state).toBe("open");
    expect([...updated.task.completionOperations]).toEqual([orphan.url]);
    expect((await store.readTask(orphan.url)).etag).toBe(orphan.etag);
    expect(cache.getSnapshot().views).toHaveLength(2);
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
      ["PUT", original.url],
      ["PUT", original.url],
      ["PUT", original.url],
    ]);
    expect(result.pod.mutations().every((request) => request.headers.has("If-Match"))).toBe(true);
    expect(notices).toHaveBeenCalledTimes(2);
    expect(failures).toHaveBeenCalledTimes(2);
  });

  it("adopts a committed occurrence with a lost response, then completes the second occurrence", async () => {
    const result = await recurring();
    const { pod, inbox } = result;
    let copyUrl: string | undefined;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.headers.get("If-None-Match") === "*") {
        copyUrl = request.url;
        pod.seed(request.url, request.body);
        throw new TypeError("Occurrence PUT committed; response lost");
      }
      return undefined;
    };
    expect(await result.cache.completeTask(result.original, now)).toBeUndefined();
    expect(result.failures).toHaveBeenCalledOnce();
    pod.intercept = undefined;

    const { cache, store, failures, original } = await reload(result);
    expect(await cache.completeTask(original, now)).toMatchObject({
      kind: "advance",
      next,
      copyUrl,
    });
    expect(pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
    ]);
    expect(pod.mutations()[0]?.headers.get("If-Match")).toBe(original.etag);
    const advanced = await store.readTask(original.url);
    expect(advanced.task.state).toBe("open");
    expect(advanced.task.dueDate).toEqual(next);
    expect(advanced.task.reminders).toEqual([
      { time: new Date("2026-11-02T11:00:00Z"), id: expect.any(String) },
      { offset: "-PT1H", id: expect.any(String) },
    ]);
    expect([...advanced.task.completionOperations]).toEqual([copyUrl]);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(2);
    expect(await cache.completeTask(advanced, next)).toEqual({ kind: "close" });
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((item) => item.task.state === "closed")).toBe(true);
    expect(failures).not.toHaveBeenCalled();
  });

  it.each([
    409, 412,
  ])("accepts a %s conflict already finished by another client", async (status) => {
    const result = await recurring();
    const orphan = await copy(result, "orphan");
    const { cache, store, failures, original } = await reload(result);
    const updates = vi.spyOn(store, "updateTask");
    result.pod.intercept = async (request) => {
      if (request.method !== "PUT" || request.url !== original.url) return undefined;
      result.pod.intercept = undefined;
      await result.store.updateTask(original, (task) => {
        task.dueDate = next;
        task.title = "Advanced elsewhere";
        task.completionOperations.add(orphan.url);
      });
      return new Response(null, { status });
    };
    expect(await cache.completeTask(original, now)).toMatchObject({
      kind: "advance",
      next,
      copyUrl: orphan.url,
    });
    expect(updates).toHaveBeenCalledOnce();
    expect(failures).not.toHaveBeenCalled();
    expect(cache.getSnapshot().views.find((item) => item.url === original.url)).toMatchObject({
      title: "Advanced elsewhere",
      due: next,
    });
    expect(result.pod.mutations().every((request) => request.url === original.url)).toBe(true);
    expect(await store.readTask(orphan.url)).toMatchObject({ etag: orphan.etag });
  });

  it.each([
    409, 412,
  ])("surfaces a %s conflict without the marker and preserves the orphan", async (status) => {
    const result = await recurring();
    const orphan = await copy(result, "orphan");
    const { cache, store, failures, original } = await reload(result);
    result.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status }) : undefined;
    expect(await cache.completeTask(original, now)).toBeUndefined();
    expect(failures.mock.calls[0]?.[0]).toMatchObject({ status });
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
    ]);
    expect((await store.readTask(original.url)).task.dueDate).toEqual(now);
    expect((await store.readTask(orphan.url)).etag).toBe(orphan.etag);
    result.pod.intercept = undefined;
    failures.mock.calls[0]?.[1]();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect((await store.readTask(original.url)).task.dueDate).toEqual(next);
    expect(await store.listTasks(result.inbox.tracker.stateStore as string)).toHaveLength(2);
  });

  it("replans a conflicted recovery from the rescheduled task on Retry", async () => {
    const result = await recurring(3);
    const orphan = await copy(result, "orphan");
    const { cache, store, failures, original } = await reload(result);
    const december = new Date("2026-12-01T12:00:00Z");
    result.pod.intercept = async (request) => {
      if (request.method !== "PUT" || request.url !== original.url) return undefined;
      result.pod.intercept = undefined;
      // Another client reschedules the task before this recovery write lands.
      await result.store.updateTask(original, (task) => {
        task.dueDate = december;
        task.reminders = [];
      });
      return new Response(null, { status: 412 });
    };
    expect(await cache.completeTask(original, now)).toBeUndefined();
    expect(failures.mock.calls[0]?.[0]).toMatchObject({ status: 412 });
    failures.mock.calls[0]?.[1]();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    const updated = await store.readTask(original.url);
    expect(updated.task.dueDate).toEqual(new Date("2026-12-02T12:00:00Z"));
    expect(updated.task.reminders).toEqual([]);
    expect([...updated.task.completionOperations]).toEqual([orphan.url]);
    expect(await store.listTasks(result.inbox.tracker.stateStore as string)).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])("prefers the current occurrence among several orphans (all-day: %s)", async (allDay) => {
    const result = await recurring(2, allDay ? "2026-11-01" : undefined);
    let matching = await copy(result, "matching");
    if (allDay) {
      // The date marker identifies the occurrence even if the stored instant differs by zone.
      matching = await result.store.updateTask(matching, (task) => {
        node(task.id, task.dataset).setDate(`${NS.WF}dateDue`, new Date("2026-11-01T01:00:00Z"));
      });
    }
    const newer = await copy(result, "newer", new Date("2026-10-31T12:00:00Z"), next);
    if (allDay)
      await result.store.updateTask(newer, (task) => {
        task.allDay = "2026-10-31";
      });
    const { cache, store, original } = await reload(result);
    expect(await cache.completeTask(original, now)).toMatchObject({
      kind: "advance",
      copyUrl: matching.url,
    });
    const updated = await store.readTask(original.url);
    expect([...updated.task.completionOperations]).toEqual([matching.url]);
    expect(updated.task.allDay).toBe(allDay ? "2026-11-02" : undefined);
    expect(await store.listTasks(result.inbox.tracker.stateStore as string)).toHaveLength(3);
  });

  it("adopts the most recently ended orphan when no due date matches", async () => {
    const result = await recurring();
    await copy(result, "older", next, now);
    const latest = await copy(result, "latest", next, next);
    const { cache, store, original } = await reload(result);
    expect(await cache.completeTask(original, now)).toMatchObject({
      kind: "advance",
      copyUrl: latest.url,
    });
    expect([...(await store.readTask(original.url)).task.completionOperations]).toEqual([
      latest.url,
    ]);
  });

  it("records the orphan marker even when the recovered plan closes the original", async () => {
    const result = await recurring(1);
    const orphan = await copy(result, "orphan");
    result.original = await result.store.updateTask(result.original, (task) => {
      task.completionOperations.add("https://pod.test/earlier-operation.ttl");
    });
    const { cache, store, original } = await reload(result);
    expect(await cache.completeTask(original, now)).toEqual({ kind: "close", copyUrl: orphan.url });
    const updated = await store.readTask(original.url);
    expect(updated.task.state).toBe("closed");
    expect(updated.task.endedAt).toEqual(now);
    expect([...updated.task.completionOperations].sort()).toEqual(
      ["https://pod.test/earlier-operation.ttl", orphan.url].sort(),
    );
    expect((await store.readTask(orphan.url)).etag).toBe(orphan.etag);
  });

  it("keeps normal completion unchanged when a copy's marker is already on the original", async () => {
    const result = await recurring();
    const { cache, store, original } = await reload(result);
    const first = await cache.completeTask(original, now);
    expect(first?.kind).toBe("advance");
    const advanced: StoredTask = await store.readTask(original.url);
    expect(advanced.task.dueDate).toEqual(next);
    result.pod.requests.length = 0;
    expect(await cache.completeTask(advanced, next)).toEqual({ kind: "close" });
    expect(result.pod.mutations().map((request) => [request.method, request.url])).toEqual([
      ["PUT", original.url],
    ]);
    expect(await store.listTasks(result.inbox.tracker.stateStore as string)).toHaveLength(2);
  });
});
