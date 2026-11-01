// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { planComplete } from "../../src/apps/tasks/lib/views/completion";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { webId } from "./pod";
import { frameCache, frameStore } from "./tasks-frame-fixtures";

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
  it("retains earlier completion evidence through a second tab's real advance", async () => {
    const result = await recurring(3);
    const { cache, store, pod, inbox, original, plan } = result;
    let committed = false;
    pod.intercept = (request) => {
      if (request.url !== original.url) return undefined;
      if (committed && request.method === "GET") return new Response(null, { status: 503 });
      if (request.method === "PUT") {
        committed = true;
        pod.seed(request.url, request.body);
        throw new TypeError("Original response lost after commit");
      }
      return undefined;
    };
    expect(await cache.advanceTask(original, plan)).toBeUndefined();
    expect(result.failures).toHaveBeenCalledOnce();
    pod.intercept = undefined;

    const otherStore = frameStore(pod);
    const otherFailures = vi.fn();
    const other = new TasksCache(otherStore, otherFailures, webId);
    await other.start();
    const project = other.getSnapshot().projects.find((project) => project.url === inbox.url);
    if (!project) throw new Error("Missing other tab's project");
    await other.loadTasks(project);
    const current = await otherStore.readTask(original.url);
    const nextPlan = planComplete(
      current,
      other.getSnapshot().views,
      new Date("2026-11-02T12:00:00Z"),
    );
    if (nextPlan.kind !== "advance") throw new Error("Expected second advance");
    expect(await other.advanceTask(current, nextPlan)).toBe(nextPlan);
    expect(otherFailures).not.toHaveBeenCalled();
    expect((await store.readTask(original.url)).task.dueDate).toEqual(
      new Date("2026-11-03T12:00:00Z"),
    );

    pod.requests.length = 0;
    await retry(result);
    expect(pod.mutations()).toEqual([]);
    const updated = await store.readTask(original.url);
    expect(updated.task.dueDate).toEqual(new Date("2026-11-03T12:00:00Z"));
    expect(updated.task.reminders[0]?.time).toEqual(new Date("2026-11-03T11:00:00Z"));
    expect([...updated.task.completionOperations].sort()).toEqual(
      [plan.copyUrl, nextPlan.copyUrl].sort(),
    );
    const copies = (await store.listTasks(inbox.tracker.stateStore as string)).filter(
      (task) => task.task.clonedFrom === original.task.id,
    );
    expect(copies.map((copy) => copy.task.dueDate?.toISOString()).sort()).toEqual([
      "2026-11-01T12:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
    ]);
    expect(copies.every((copy) => copy.task.state === "closed")).toBe(true);
    expect(cache.getSnapshot().views.find((task) => task.url === original.url)?.due).toEqual(
      updated.task.dueDate,
    );
  });

  it.each([
    false,
    true,
  ])("preserves a committed occurrence after another client reschedules (deferred read: %s)", async (deferred) => {
    const result = await recurring(3);
    const { cache, store, pod, inbox, original, plan } = result;
    let committed = false;
    let blockRead = false;
    const due = new Date("2026-12-01T12:00:00Z");
    pod.intercept = async (request) => {
      if (blockRead && request.method === "GET" && request.url === original.url)
        return new Response(null, { status: 503 });
      if (!committed && request.method === "PUT" && request.url === original.url) {
        committed = true;
        pod.seed(request.url, request.body);
        await store.updateTask(await store.readTask(original.url), (task) => {
          task.dueDate = due;
          task.title = "Edited elsewhere";
        });
        blockRead = deferred;
        throw new TypeError("Response lost after commit and remote reschedule");
      }
      return undefined;
    };
    await cache.advanceTask(original, plan);
    pod.intercept = undefined;
    if (deferred) {
      expect(result.failures).toHaveBeenCalledOnce();
      await retry(result);
    }
    const tasks = await frameStore(pod).listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    const current = tasks.find((task) => task.url === original.url);
    const copy = tasks.find((task) => task.url === plan.copyUrl);
    expect(current?.task.dueDate).toEqual(due);
    expect(current?.task.title).toBe("Edited elsewhere");
    expect(copy?.task.dueDate).toEqual(original.task.dueDate);
    expect(copy?.task.state).toBe("closed");
    expect(copy?.task.completionOperations.has(plan.copyUrl as string)).toBe(true);
    expect(current?.task.completionOperations.has(plan.copyUrl as string)).toBe(true);
    expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });

  it.each([
    "copy",
    "original",
  ])("reuses the planned occurrence after an ambiguous, uncommitted %s write", async (lost) => {
    const result = await recurring(3);
    const { cache, pod, store, original, plan, inbox } = result;
    let dropped = false;
    pod.intercept = (request) => {
      if (
        !dropped &&
        request.method === "PUT" &&
        (lost === "original" ? request.url === original.url : request.url !== original.url)
      ) {
        dropped = true;
        throw new TypeError("Write did not commit, but its outcome is unknown to the client");
      }
      return undefined;
    };
    expect(await cache.advanceTask(original, plan)).toBeUndefined();
    pod.intercept = undefined;
    await store.updateTask(await store.readTask(original.url), (task) => {
      task.dueDate = new Date("2026-12-01T12:00:00Z");
      task.title = "Keep remote title";
    });
    await retry(result);
    const tasks = await store.listTasks(inbox.tracker.stateStore as string);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.url === original.url)?.task.dueDate).toEqual(plan.next);
    expect(tasks.find((task) => task.url === original.url)?.task.title).toBe("Keep remote title");
    expect(tasks.find((task) => task.url === plan.copyUrl)?.task.dueDate).toEqual(
      original.task.dueDate,
    );
    expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  });

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

describe("project creation retry reservation", () => {
  it("does not replace or reallocate a reservation taken over by another creator", async () => {
    const result = await frameCache();
    const { cache, pod, store } = result;
    const url = `${store.projects}home.ttl`;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === url) {
        pod.seed(url, request.body);
        throw new TypeError("Reservation response lost");
      }
      return undefined;
    };
    expect(await cache.createProject("Home")).toBeUndefined();
    pod.intercept = undefined;
    const dataset = await pod.dataset(url);
    node(`${url}#this`, dataset).setText(`${NS.SCHEDULING}initializationOwner`, "another-creator");
    pod.seed(url, await serialize(dataset));
    pod.requests.length = 0;
    await retry(result);
    expect(result.failures).toHaveBeenCalledTimes(2);
    expect(pod.mutations()).toEqual([]);
    expect((await store.readProject(url)).tracker.title).toBe("Home");
    expect(pod.files.has(`${store.projects}home-2.ttl`)).toBe(false);
  });

  it.each([
    "reservation",
    "finalization",
    "position",
  ])("reuses the actual tracker after a lost %s PUT response", async (phase) => {
    const result = await frameCache();
    const { cache, store, pod } = result;
    const url = `${store.projects}home.ttl`;
    let writes = 0;
    const target = { reservation: 1, finalization: 2, position: 3 }[phase];
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === url && ++writes === target) {
        pod.seed(request.url, request.body);
        throw new TypeError("Project PUT committed; response lost");
      }
      return undefined;
    };
    await cache.createProject("Home");
    pod.intercept = undefined;
    if (result.failures.mock.calls.length) await retry(result);
    expect(
      (await store.listProjects())
        .filter((item) => item.tracker.title === "Home")
        .map((item) => item.url),
    ).toEqual([url]);
    expect(cache.getSnapshot().projects.find((item) => item.url === url)?.tracker.position).toBe(1);
    expect(pod.files.has(`${store.projects}home/`)).toBe(true);
    expect(pod.requests.some((request) => request.url.includes("home-2"))).toBe(false);
    const reservations = pod.requests.filter(
      (request) =>
        request.url === url &&
        request.method === "PUT" &&
        request.headers.get("If-None-Match") === "*",
    );
    expect(reservations).toHaveLength(1);
  });
});

describe("section move retry intent", () => {
  it.each([
    true,
    false,
  ])("keeps the original absolute positions (committed: %s)", async (committed) => {
    const result = await frameCache();
    const { cache, store, pod, inbox } = result;
    for (const name of ["A", "B", "C"]) await cache.addSection(inbox, name);
    const project = cache.getSnapshot().projects[0];
    const section = project?.tracker.sections[0];
    if (!project || !section) throw new Error("Missing section");
    const originalEtag = project.etag;
    pod.intercept = (request) => {
      if (request.method !== "PUT" || request.url !== inbox.url) return undefined;
      if (committed) pod.seed(request.url, request.body);
      throw new TypeError("Section PUT response lost");
    };
    expect(await cache.moveSection(project, section.id, "down")).toBeUndefined();
    pod.intercept = undefined;
    pod.requests.length = 0;
    await retry(result);
    expect(
      (await store.readProject(inbox.url)).tracker.sections.map((item) => [
        item.name,
        item.position,
      ]),
    ).toEqual([
      ["B", 1],
      ["A", 2],
      ["C", 3],
    ]);
    const writes = pod.requests.filter((request) => request.method === "PUT");
    expect(writes).toHaveLength(committed ? 0 : 1);
    if (!committed) expect(writes[0]?.headers.get("If-Match")).toBe(originalEtag);
  });
});
