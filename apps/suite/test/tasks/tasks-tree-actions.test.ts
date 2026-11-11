// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import type { StoredProject, StoredTask } from "../../src/apps/tasks/lib/model/store";
import { changeTaskDepth } from "../../src/apps/tasks/state/tree-actions";
import { frameCache } from "./tasks-frame-fixtures";

async function setup() {
  const result = await frameCache();
  const first = (await result.cache.createTask(result.inbox, { title: "First" })) as StoredTask;
  const second = (await result.cache.createTask(result.inbox, { title: "Second" })) as StoredTask;
  const view = () => {
    const task = result.cache.getSnapshot().views.find((task) => task.url === second.url);
    if (!task) throw new Error("Missing Second");
    return task;
  };
  return { ...result, first, second, view };
}

describe("conditional tree writes", () => {
  it("announces boundaries without writes", async () => {
    const { cache, pod, view } = await setup();
    pod.requests.length = 0;
    const announce = vi.fn();
    await changeTaskDepth(cache, view(), true, announce);
    expect(pod.mutations()).toEqual([]);
    expect(announce).toHaveBeenLastCalledWith("Couldn't outdent 'Second'.");
  });

  it("promotes into the former parent's section in the same single conditional write", async () => {
    const { cache, store, pod, inbox, first, second, view } = await setup();
    await cache.addSection(inbox, "Doing");
    const project = cache.getSnapshot().projects[0] as StoredProject;
    const section = project.tracker.sections[0]?.id as string;
    await cache.updateTask(first, (task) => {
      task.types.add(section);
    });
    await cache.updateTask(second, (task) => {
      task.parent = first.task.id;
    });
    const before = await store.readTask(second.url);
    pod.requests.length = 0;
    await changeTaskDepth(cache, view(), true, vi.fn());
    const after = await store.readTask(second.url);
    expect(after.task.parent).toBeUndefined();
    expect(after.task.types.has(section)).toBe(true);
    expect(pod.mutations()).toHaveLength(1);
    expect(pod.mutations()[0]?.headers.get("If-Match")).toBe(before.etag);
  });

  it("does not repeat a relative indent when a lost response already changed the pod", async () => {
    const { cache, store, pod, failures, first, second, view } = await setup();
    let readBack = false;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === second.url) {
        pod.seed(request.url, request.body);
        readBack = true;
        return new Response(null, { status: 502 });
      }
      if (readBack && request.method === "GET" && request.url === second.url) {
        readBack = false;
        throw new TypeError("Read unavailable");
      }
    };
    const announce = vi.fn();
    await changeTaskDepth(cache, view(), false, announce);
    expect(failures).toHaveBeenCalledOnce();
    pod.intercept = undefined;
    pod.requests.length = 0;
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() => expect(announce).toHaveBeenLastCalledWith("Indented 'Second'."));
    expect(pod.mutations()).toEqual([]);
    expect((await store.readTask(second.url)).task.parent).toBe(first.task.id);
  });

  it("rejects a stale retry after another writer changes the parent", async () => {
    const { cache, store, pod, failures, inbox, second, view } = await setup();
    const third = (await cache.createTask(inbox, { title: "Third" })) as StoredTask;
    pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 503 }) : undefined;
    const announce = vi.fn();
    await changeTaskDepth(cache, view(), false, announce);
    pod.intercept = undefined;
    await store.updateTask(await store.readTask(second.url), (task) => {
      task.parent = third.task.id;
    });
    await cache.loadTasks(inbox, true);
    pod.requests.length = 0;
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() => expect(announce).toHaveBeenLastCalledWith("Couldn't indent 'Second'."));
    expect(pod.mutations()).toEqual([]);
    expect((await store.readTask(second.url)).task.parent).toBe(third.task.id);
  });
});
