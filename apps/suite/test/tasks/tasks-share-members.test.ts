// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

const bob = "https://bob.example/profile#me";

describe("sharing membership mutation queue", () => {
  it("adds once, clears freshly listed assignments on removal, and reports only the affected tasks", async () => {
    const { cache, inbox, store, failures } = await frameCache();
    await cache.syncProjectMember(inbox, bob, true);
    await cache.syncProjectMember(inbox, bob, true);
    expect((await store.readProject(inbox.url)).tracker.groupMembers).toEqual([webId, bob]);
    const notice = vi.fn();
    const other = new TasksCache(store, failures, webId, notice);
    await other.start();
    await other.loadTasks(inbox);
    const first = await other.createTask(inbox, { title: "Assigned", assignee: bob });
    const second = await other.createTask(inbox, { title: "Keep", assignee: webId });
    if (!first || !second) throw new Error("Missing task");
    const listing = vi.spyOn(store, "listTasks");
    await other.syncProjectMember(inbox, bob, false);
    expect(listing).toHaveBeenCalledWith(inbox.tracker.stateStore, { strict: true });
    expect((await store.readTask(first.url)).task.assignee).toBeUndefined();
    expect((await store.readTask(second.url)).task.assignee).toBe(webId);
    expect((await store.readProject(inbox.url)).tracker.groupMembers).toEqual([webId]);
    expect(notice).toHaveBeenCalledExactlyOnceWith("Unassigned 1 tasks");
    await other.syncProjectMember(inbox, bob, false);
    expect(notice).toHaveBeenCalledOnce();
    expect(failures).not.toHaveBeenCalled();
  });
  it("reconciles a committed unassign whose response is lost", async () => {
    const { cache, inbox, store } = await frameCache();
    await cache.syncProjectMember(inbox, bob, true);
    const task = await cache.createTask(inbox, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    const original = store.updateTask.bind(store);
    vi.spyOn(store, "updateTask").mockImplementationOnce(async (item, change) => {
      await original(item, change);
      throw new ModelError(0, item.url);
    });
    expect(await cache.syncProjectMember(inbox, bob, false)).toBeDefined();
    expect((await store.readTask(task.url)).task.assignee).toBeUndefined();
    expect((await store.readProject(inbox.url)).tracker.groupMembers).not.toContain(bob);
  });
  it("retries after a lost membership response and after a strict listing failure", async () => {
    const { cache, inbox, store, failures } = await frameCache();
    const original = store.updateProject.bind(store);
    vi.spyOn(store, "updateProject").mockImplementationOnce(async (project, change) => {
      await original(project, change);
      throw new ModelError(0, project.url);
    });
    expect(await cache.syncProjectMember(inbox, bob, true)).toBeUndefined();
    expect(await cache.syncProjectMember(inbox, bob, true)).toBeDefined();
    const task = await cache.createTask(inbox, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    vi.spyOn(store, "listTasks").mockRejectedValueOnce(new ModelError(503, inbox.url));
    expect(await cache.syncProjectMember(inbox, bob, false)).toBeUndefined();
    expect((await store.readProject(inbox.url)).tracker.groupMembers).toContain(bob);
    failures.mock.calls.at(-1)?.[1]();
    await vi.waitFor(() =>
      expect(cache.getSnapshot().projects[0]?.tracker.groupMembers).not.toContain(bob),
    );
  });
  it("waits for queued assignments before the strict fresh removal listing", async () => {
    const { cache, inbox, store, pod } = await frameCache();
    await cache.syncProjectMember(inbox, bob, true);
    const task = await cache.createTask(inbox, { title: "Pending assignment" });
    if (!task) throw new Error("Missing task");
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === task.url) {
        entered.resolve();
        await resume.promise;
      }
      return undefined;
    };
    const assign = cache.updateTask(task, (task) => {
      task.assignee = bob;
    });
    await entered.promise;
    const listing = vi.spyOn(store, "listTasks");
    const removal = cache.syncProjectMember(inbox, bob, false);
    expect(listing).not.toHaveBeenCalled();
    resume.resolve();
    await assign;
    await removal;
    expect((await store.readTask(task.url)).task.assignee).toBeUndefined();
  });
  it("removes a folder ACL before deleting its folder, with a fresh validator", async () => {
    const { store, pod } = await frameCache();
    const home = await store.createProject("Home");
    const folder = home.tracker.stateStore as string;
    const data = await pod.dataset(folder);
    node(`${folder}.acl`, data).types.add(`${NS.LDP}Resource`);
    pod.seed(`${folder}.acl`, await serialize(data));
    pod.requests.length = 0;
    await store.deleteProject(home);
    const deletes = pod.requests.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual([`${folder}.acl`, folder, home.url]);
    expect(deletes.every((request) => request.headers.has("If-Match"))).toBe(true);
  });
});

describe("opened shared trackers", () => {
  it("loads extra trackers, isolates forbidden reads, and retains own projects", async () => {
    const { cache, store, pod, inbox } = await frameCache();
    const url = "https://bob.example/projects/home.ttl";
    const data = createTracker(
      url,
      "Shared Home",
      "https://bob.example/projects/home/",
      [bob, webId],
      now,
    );
    pod.seed(url, await serialize(data.dataset));
    await pod.emptyContainer(data.tracker.stateStore as string);
    expect(cache.isOwnProject(inbox.url)).toBe(true);
    const opened = await cache.openProject(url);
    expect(opened?.tracker.title).toBe("Shared Home");
    expect(cache.isOwnProject(url)).toBe(false);
    expect(await cache.openProject(url)).toBe(opened);
    await cache.setSharedProjects([{ url, title: "Shared Home" }]);
    expect(cache.getSnapshot().projects.map((project) => project.url)).toContain(url);
    pod.intercept = (request) =>
      request.url === url ? new Response(null, { status: 403 }) : undefined;
    await cache.refreshProjects();
    expect(cache.getSnapshot().tasks[url]).toMatchObject({
      status: "error",
      items: [],
      error: { status: 403 },
    });
    expect(cache.getSnapshot().projects.map((project) => project.url)).toContain(inbox.url);
    const cold = new TasksCache(store, vi.fn(), webId);
    await cold.setSharedProjects([{ url, title: "Shared Home" }]);
    expect(cold.getSnapshot().status).toBe("ready");
    expect(cold.getSnapshot().tasks[url]?.status).toBe("error");
    expect(await cold.openProject(url)).toBeUndefined();
  });
});
