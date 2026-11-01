// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { frameCache } from "./tasks-frame-fixtures";

async function setup() {
  const result = await frameCache();
  const { store, cache, inbox } = result;
  const target = await store.createProject("Target");
  const other = await store.createProject("Other");
  const parent = await store.createTask(inbox, { title: "Parent", state: "open" });
  const child = await store.createTask(inbox, {
    title: "Child",
    state: "open",
    parent: parent.task.id,
  });
  const remoteChild = await store.createTask(other, {
    title: "Other child",
    state: "closed",
    parent: parent.task.id,
  });
  await cache.refreshProjects();
  for (const project of [inbox, target, other]) await cache.loadTasks(project, true);
  return { ...result, target, other, parent, child, remoteChild };
}

describe("detail move recovery and hierarchy", () => {
  it("validates the destination before writing and supplies missing creation provenance", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    const before = pod.mutations().length;
    expect(() => store.prepareTaskMove(parent, inbox, target, "../escape")).toThrow(
      "Invalid task identifier",
    );
    const container = target.tracker.stateStore;
    for (const invalid of [undefined, "https://pod.test/without-slash"]) {
      target.tracker.stateStore = invalid;
      expect(() => store.prepareTaskMove(parent, inbox, target, "moved")).toThrow(
        "Expected a stateStore container",
      );
    }
    expect(pod.mutations()).toHaveLength(before);
    target.tracker.stateStore = container;
    const bare = await store.updateTask(parent, (task) => {
      task.created = undefined;
    });
    const moved = await store.moveTaskToProject(bare, inbox, target, "moved");
    expect(moved.task.created).toEqual(moved.task.modified);
  });
  it("retains the destination when the source DELETE commits but its response is lost", async () => {
    const { pod, store, inbox, target, parent, child, remoteChild } = await setup();
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === parent.url) {
        pod.files.delete(parent.url);
        throw new TypeError("Response lost");
      }
    };
    const moved = await store.moveTaskToProject(parent, inbox, target, "moved");
    expect(pod.files.has(parent.url)).toBe(false);
    expect((await store.readTask(moved.url)).task.title).toBe("Parent");
    for (const item of [child, remoteChild])
      expect((await store.readTask(item.url)).task.parent).toBe(moved.task.id);
    expect(pod.requests.filter((request) => request.method === "DELETE").map((r) => r.url)).toEqual(
      [parent.url],
    );
  });

  it("remaps children across projects with conditional writes and keeps cache progress", async () => {
    const { pod, cache, store, parent, child, remoteChild, target } = await setup();
    const offset = pod.mutations().length;
    const moving = cache.moveTaskToProject(parent, target);
    const optimistic = cache.getSnapshot().views.find((view) => view.title === "Parent");
    expect(
      cache.getSnapshot().views.filter((view) => view.parentId === optimistic?.id),
    ).toHaveLength(2);
    const moved = await moving;
    expect(moved).toBeDefined();
    for (const item of [child, remoteChild]) {
      const saved = await store.readTask(item.url);
      expect(saved.task.parent).toBe(moved?.task.id);
      expect(cache.getSnapshot().views.find((view) => view.url === item.url)?.parentId).toBe(
        moved?.task.id,
      );
      const request = pod
        .mutations()
        .slice(offset)
        .find((r) => r.url === item.url);
      expect(request?.headers.get("If-Match")).toBe(item.etag);
      const cached = Object.values(cache.getSnapshot().tasks)
        .flatMap((load) => load.items)
        .find((task) => task.url === item.url);
      expect(cached?.etag).toBe(saved.etag);
    }
  });

  it("rolls back remapped children before removing the destination on a source conflict", async () => {
    const { pod, store, inbox, target, parent, child, remoteChild } = await setup();
    await store.updateTask(parent, (task) => {
      task.title = "Remote title";
    });
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    expect((await store.readTask(parent.url)).task.title).toBe("Remote title");
    for (const item of [child, remoteChild])
      expect((await store.readTask(item.url)).task.parent).toBe(parent.task.id);
    expect(
      pod.requests
        .filter((r) => r.method === "PUT" && r.url === child.url)
        .every((r) => r.headers.has("If-Match") || r.headers.get("If-None-Match") === "*"),
    ).toBe(true);
  });

  it("rolls back earlier child updates when a later child conflicts without overwriting its edits", async () => {
    const { pod, store, inbox, target, parent, child, remoteChild } = await setup();
    let edited = false;
    pod.intercept = async (request) => {
      if (!edited && request.method === "PUT" && request.url === remoteChild.url) {
        edited = true;
        pod.intercept = undefined;
        await store.updateTask(remoteChild, (task) => {
          task.title = "Concurrent edit";
        });
        return new Response(null, { status: 412 });
      }
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.files.has(parent.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    expect((await store.readTask(child.url)).task.parent).toBe(parent.task.id);
    expect((await store.readTask(remoteChild.url)).task.title).toBe("Concurrent edit");
  });

  it("continues after reconciling a lost child PUT response", async () => {
    const { pod, store, inbox, target, parent, child } = await setup();
    let failed = false;
    pod.intercept = (request) => {
      if (!failed && request.method === "PUT" && request.url === child.url) {
        failed = true;
        pod.seed(child.url, request.body);
        throw new TypeError("Response lost");
      }
    };
    const moved = await store.moveTaskToProject(parent, inbox, target, "moved");
    expect((await store.readTask(child.url)).task.parent).toBe(moved.task.id);
    expect(pod.files.has(parent.url)).toBe(false);
  });

  it("retains both parents when a concurrent child edit prevents conditional rollback", async () => {
    const { pod, store, inbox, target, parent, child } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === parent.url) {
        const current = await store.readTask(child.url);
        await store.updateTask(current, (task) => {
          task.description = "Keep this edit";
        });
        return new Response(null, { status: 503 });
      }
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toBeInstanceOf(
      AggregateError,
    );
    const current = await store.readTask(child.url);
    expect(current.task.description).toBe("Keep this edit");
    expect(current.task.parent).toBe(`${target.tracker.stateStore}moved.ttl#it`);
    expect(pod.files.has(parent.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
  });

  it.each([
    "edit",
    "delete",
  ])("rejects a child %s between discovery and remapping", async (action) => {
    const { pod, store, inbox, target, parent, child } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url.endsWith("/moved.ttl")) {
        if (action === "edit")
          await store.updateTask(child, (task) => {
            task.title = "New child title";
          });
        else await store.deleteTask(child);
      }
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.files.has(parent.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    if (action === "edit")
      expect((await store.readTask(child.url)).task.title).toBe("New child title");
    else expect(pod.files.has(child.url)).toBe(false);
  });

  it("does not overwrite or compensate a destination reserved by another writer", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    const collision = await store.createTask(
      target,
      { title: "Unrelated task", state: "open" },
      "moved",
    );
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect((await store.readTask(collision.url)).task.title).toBe("Unrelated task");
    expect(pod.files.has(parent.url)).toBe(true);
  });

  it.each([
    2, 3,
  ])("retains the destination if the source vanishes during rollback read %s, then retries forward", async (vanishAt) => {
    const { pod, store, inbox, target, parent, child } = await setup();
    const move = store.prepareTaskMove(parent, inbox, target, "moved");
    let reads = 0;
    let deleting = false;
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === parent.url) {
        deleting = true;
        return new Response(null, { status: 503 });
      }
      if (
        deleting &&
        request.method === "GET" &&
        request.url === parent.url &&
        ++reads === vanishAt
      ) {
        pod.files.delete(parent.url);
        return new Response(null, { status: 404 });
      }
    };
    await expect(move.run()).rejects.toBeInstanceOf(AggregateError);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
    pod.intercept = undefined;
    const moved = await move.run();
    expect((await store.readTask(child.url)).task.parent).toBe(moved.task.id);
  });

  it("does not compensate after an ambiguous DELETE when the source was replaced", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    pod.intercept = async (request) => {
      if (request.method === "DELETE" && request.url === parent.url) {
        pod.files.delete(parent.url);
        const id = parent.url.slice(parent.url.lastIndexOf("/") + 1, -4);
        await store.createTask(inbox, { title: "Replacement", state: "open" }, id);
        throw new TypeError("Response lost");
      }
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toThrow();
    expect((await store.readTask(parent.url)).task.title).toBe("Replacement");
    expect((await store.readTask(`${target.tracker.stateStore}moved.ttl`)).task.title).toBe(
      "Parent",
    );
  });

  it("retains a destination when creation fails after a separate source deletion", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url.endsWith("/moved.ttl")) {
        pod.files.delete(parent.url);
        pod.seed(request.url, request.body);
        return new Response(null, { status: 503 });
      }
      if (
        request.method === "GET" &&
        request.url.endsWith("/moved.ttl") &&
        !pod.files.has(parent.url)
      )
        throw new TypeError("Read unavailable");
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toThrow();
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
  });

  it("reconciles a lost destination DELETE response during compensation", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    await store.updateTask(parent, (task) => {
      task.title = "Remote title";
    });
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url.endsWith("/moved.ttl")) {
        pod.files.delete(request.url);
        throw new TypeError("Response lost");
      }
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(false);
    expect((await store.readTask(parent.url)).task.title).toBe("Remote title");
  });

  it("reconciles a lost rollback response before retrying the fixed move intent", async () => {
    const { pod, store, inbox, target, parent, child } = await setup();
    const move = store.prepareTaskMove(parent, inbox, target, "moved");
    let updates = 0;
    let disconnected = false;
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === parent.url)
        return new Response(null, { status: 503 });
      if (request.method === "PUT" && request.url === child.url && ++updates === 2) {
        pod.seed(child.url, request.body);
        disconnected = true;
        throw new TypeError("Rollback response lost");
      }
      if (disconnected && request.method === "GET" && request.url === child.url)
        throw new TypeError("Unavailable");
    };
    await expect(move.run()).rejects.toBeInstanceOf(AggregateError);
    pod.intercept = undefined;
    const moved = await move.run();
    expect((await store.readTask(child.url)).task.parent).toBe(moved.task.id);
    expect(await store.listTasks(target.tracker.stateStore as string)).toHaveLength(1);
    expect(await move.run()).toBe(moved);
  });

  it("keeps both copies if source existence cannot be reconciled", async () => {
    const { pod, store, inbox, target, parent } = await setup();
    let failed = false;
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === parent.url) {
        failed = true;
        throw new TypeError("Disconnected");
      }
      if (failed && request.method === "GET" && request.url === parent.url)
        throw new TypeError("Still disconnected");
    };
    await expect(store.moveTaskToProject(parent, inbox, target, "moved")).rejects.toThrow();
    expect(pod.files.has(parent.url)).toBe(true);
    expect(pod.files.has(`${target.tracker.stateStore}moved.ttl`)).toBe(true);
    expect(pod.requests.some((r) => r.method === "DELETE" && r.url.endsWith("moved.ttl"))).toBe(
      false,
    );
  });

  it.each([
    "create",
    "delete",
  ])("retries an ambiguous %s with the same destination and publishes its URL mapping", async (stage) => {
    const { pod, cache, store, inbox, target, parent, failures } = await setup();
    const mappings = vi.fn();
    const unsubscribe = cache.subscribeTaskMoves(mappings);
    let destination = "";
    let failed = false;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url.startsWith(target.tracker.stateStore as string)) {
        destination = request.url;
        if (stage === "create" && !failed) {
          failed = true;
          pod.seed(request.url, request.body);
          throw new TypeError("Response lost");
        }
      }
      if (stage === "delete" && request.method === "DELETE" && request.url === parent.url) {
        failed = true;
        pod.files.delete(parent.url);
        throw new TypeError("Response lost");
      }
      if (failed && request.method === "GET" && [destination, parent.url].includes(request.url))
        throw new TypeError("Reconciliation unavailable");
    };
    expect(await cache.moveTaskToProject(parent, target)).toBeUndefined();
    expect(mappings).not.toHaveBeenCalled();
    expect(failures).toHaveBeenCalledOnce();
    pod.intercept = undefined;
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() =>
      expect(mappings).toHaveBeenCalledWith({ from: parent.url, to: destination }),
    );
    expect(pod.files.has(parent.url)).toBe(false);
    expect(await store.listTasks(target.tracker.stateStore as string)).toHaveLength(1);
    expect(
      cache.getSnapshot().tasks[inbox.url]?.items.some((task) => task.url === parent.url),
    ).toBe(false);
    expect((await store.readTask(destination)).task.title).toBe("Parent");
    unsubscribe();
  });

  it("retries a definite failure after rolling the children back", async () => {
    const { pod, cache, store, target, parent, failures } = await setup();
    let failed = false;
    pod.intercept = (request) => {
      if (!failed && request.method === "DELETE" && request.url === parent.url) {
        failed = true;
        return new Response(null, { status: 503 });
      }
    };
    expect(await cache.moveTaskToProject(parent, target)).toBeUndefined();
    expect(failures.mock.calls[0]?.[0]).toBeInstanceOf(ModelError);
    const retry = failures.mock.calls[0]?.[1] as () => void;
    const mappings = vi.fn();
    cache.subscribeTaskMoves(mappings);
    retry();
    await vi.waitFor(() => expect(mappings).toHaveBeenCalledOnce());
    expect(await store.listTasks(target.tracker.stateStore as string)).toHaveLength(1);
  });

  it("makes an already successful Retry harmless after subsequent task and child edits", async () => {
    const { pod, cache, target, parent, child, inbox, failures } = await setup();
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === parent.url
        ? new Response(null, { status: 503 })
        : undefined;
    await cache.moveTaskToProject(parent, target);
    pod.intercept = undefined;
    const retry = failures.mock.calls[0]?.[1] as () => void;
    const mappings = vi.fn();
    cache.subscribeTaskMoves(mappings);
    retry();
    await vi.waitFor(() => expect(mappings).toHaveBeenCalledOnce());
    const moved = cache.getSnapshot().tasks[target.url]?.items[0];
    const updatedChild = cache
      .getSnapshot()
      .tasks[inbox.url]?.items.find((task) => task.url === child.url);
    if (!moved || !updatedChild) throw new Error("Missing moved task or child");
    await cache.updateTask(moved, (task) => {
      task.title = "Edited after the move";
    });
    await cache.updateTask(updatedChild, (task) => {
      task.description = "Edited child";
    });
    const before = pod.mutations().length;
    retry();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect(pod.mutations()).toHaveLength(before);
    expect(cache.getSnapshot().tasks[target.url]?.items[0]?.task.title).toBe(
      "Edited after the move",
    );
    expect(
      cache.getSnapshot().tasks[inbox.url]?.items.find((task) => task.url === child.url)?.task
        .description,
    ).toBe("Edited child");
    expect(mappings).toHaveBeenCalledOnce();
  });
});
