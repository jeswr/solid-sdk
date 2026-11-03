// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import {
  NS,
  node,
  requireProjectFolder,
  Store,
  serialize,
} from "../../src/apps/tasks/lib/model/rdf";
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
  it("keeps a member removable after a fresh listing contains an invalid task document", async () => {
    const { cache, inbox, store, pod, failures } = await frameCache();
    await cache.syncProjectMember(inbox, bob, true);
    const stray = `${inbox.tracker.stateStore}stray.ttl`;
    pod.seed(stray, await serialize(new Store()));
    const task = await cache.createTask(inbox, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    expect(await cache.syncProjectMember(inbox, bob, false)).toBeUndefined();
    expect(failures.mock.calls.at(-1)?.[0].cause).toMatchObject({
      message: "Expected a wf:Task.",
    });
    expect((await store.readProject(inbox.url)).tracker.groupMembers).toContain(bob);
    pod.files.delete(stray);
    expect(await cache.syncProjectMember(inbox, bob, false)).toBeDefined();
    expect((await store.readTask(task.url)).task.assignee).toBeUndefined();
    expect((await store.readProject(inbox.url)).tracker.groupMembers).not.toContain(bob);
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
    pod.seed(`${home.url}.acl`, await serialize(data));
    pod.requests.length = 0;
    await store.deleteProject(home);
    const deletes = pod.requests.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual([
      `${folder}.acl`,
      folder,
      `${home.url}.acl`,
      home.url,
    ]);
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

describe("sharing regressions", () => {
  it("rejects a tampered stateStore before membership writes and project deletion", async () => {
    const { cache, store, pod, inbox, failures } = await frameCache();
    const other = await store.createProject("Other");
    const tampered = await store.updateProject(inbox, (tracker) => {
      tracker.stateStore = other.tracker.stateStore;
    });
    const listing = vi.spyOn(store, "listTasks");
    expect(await cache.syncProjectMember(tampered, bob, false)).toBeUndefined();
    expect(failures.mock.calls.at(-1)?.[0].cause).toMatchObject({ status: 400 });
    expect(listing).not.toHaveBeenCalledWith(other.tracker.stateStore, { strict: true });
    pod.requests.length = 0;
    await expect(store.deleteProject(tampered)).rejects.toMatchObject({ status: 400 });
    await expect(store.deleteProject(inbox)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.filter((request) => ["PUT", "DELETE"].includes(request.method))).toEqual(
      [],
    );
  });
  it("rejects an owned tracker nested below the projects container", async () => {
    const { cache, store, pod, failures } = await frameCache();
    const url = `${store.projects}nested/home.ttl`;
    const data = createTracker(url, "Nested", url.replace(/\.ttl$/, "/"), [webId], now);
    pod.seed(url, await serialize(data.dataset));
    const project = await store.readProject(url);
    expect(await cache.syncProjectMember(project, bob, true)).toBeUndefined();
    expect(failures.mock.calls.at(-1)?.[0].cause).toMatchObject({ status: 400 });
    await expect(store.deleteProject(project)).rejects.toMatchObject({ status: 400 });
  });
  it("restores unchanged assignments on any re-add; no re-add leaves them unassigned", async () => {
    const { store, failures, inbox, pod } = await frameCache();
    const notice = vi.fn();
    const cache = new TasksCache(store, failures, webId, notice);
    await cache.start();
    await cache.syncProjectMember(inbox, bob, true);
    const first = await cache.createTask(inbox, { title: "Restore", assignee: bob });
    const second = await cache.createTask(inbox, { title: "Edited", assignee: bob });
    const third = await cache.createTask(inbox, { title: "Reassigned", assignee: bob });
    if (!first || !second || !third) throw new Error("Missing tasks");
    await cache.syncProjectMember(inbox, bob, false);
    const unassigned = await store.readTask(first.url);
    expect(unassigned.task.assignee).toBeUndefined();
    expect(notice).not.toHaveBeenCalledWith(expect.stringContaining("Restored"));
    await store.updateTask(await store.readTask(second.url), (task) => {
      task.title = "Changed elsewhere";
    });
    await store.updateTask(await store.readTask(third.url), (task) => {
      task.assignee = webId;
    });
    pod.requests.length = 0;
    await cache.syncProjectMember(inbox, bob, true);
    expect((await store.readTask(first.url)).task.assignee).toBe(bob);
    expect((await store.readTask(second.url)).task.assignee).toBeUndefined();
    expect((await store.readTask(third.url)).task.assignee).toBe(webId);
    expect(
      pod.requests
        .find((request) => request.method === "PUT" && request.url === first.url)
        ?.headers.get("If-Match"),
    ).toBe(unassigned.etag);
    expect(notice).toHaveBeenLastCalledWith("Restored 1 assignments");
    await cache.syncProjectMember(inbox, bob, true);
    expect(notice.mock.calls.filter(([message]) => message.startsWith("Restored"))).toHaveLength(1);
  });
  it("skips a concurrent assignment restoration conflict", async () => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    await cache.syncProjectMember(inbox, bob, true);
    const item = await cache.createTask(inbox, { title: "Race", assignee: bob });
    if (!item) throw new Error("Missing task");
    await cache.syncProjectMember(inbox, bob, false);
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === item.url
        ? new Response(null, { status: 412 })
        : undefined;
    expect(await cache.syncProjectMember(inbox, bob, true)).toBeDefined();
    expect((await store.readTask(item.url)).task.assignee).toBeUndefined();
    expect(failures).not.toHaveBeenCalled();
  });
  it.each([
    "http://bob.example/home.ttl",
    "https://a%zz/home.ttl",
  ])("rejects unsafe shared links before reading %s", async (url) => {
    const { cache, pod } = await frameCache();
    pod.requests.length = 0;
    expect(await cache.openProject(url)).toBeUndefined();
    await cache.setSharedProjects([{ url, title: "Unsafe" }]);
    expect(pod.requests.some((request) => request.url === url)).toBe(false);
  });
  it.each([
    "https://elsewhere.example/home/",
    "https://bob.example/drive/",
  ])("refuses shared stateStore %s and does not remember failed reads", async (folder) => {
    const { cache, pod } = await frameCache();
    const url = "https://bob.example/home.ttl";
    const data = createTracker(url, "Unsafe", folder, [bob], now);
    pod.seed(url, await serialize(data.dataset));
    expect(await cache.openProject(url)).toBeUndefined();
    expect(cache.hasSharedProject(url)).toBe(false);
    pod.requests.length = 0;
    await cache.refreshProjects();
    expect(pod.requests.some((request) => request.url === url || request.url === folder)).toBe(
      false,
    );
  });
  it("forgets removed projects and stops refreshing them", async () => {
    const { cache, pod } = await frameCache();
    const url = "https://bob.example/home.ttl";
    const data = createTracker(url, "Shared", url.replace(/\.ttl$/, "/"), [bob], now);
    pod.seed(url, await serialize(data.dataset));
    expect(await cache.openProject(url)).toBeDefined();
    await cache.setSharedProjects([]);
    pod.requests.length = 0;
    await cache.refreshProjects();
    await cache.invalidate(url);
    expect(cache.getSnapshot().projects.some((project) => project.url === url)).toBe(false);
    expect(pod.requests.some((request) => request.url === url)).toBe(false);
  });
  it("reports partial sharing success once with a retry that repairs membership", async () => {
    const { cache, store, inbox, failures } = await frameCache();
    vi.spyOn(store, "updateProject").mockRejectedValueOnce(new ModelError(503, inbox.url));
    expect(await cache.syncProjectMember(inbox, bob, true)).toBeUndefined();
    expect(failures).toHaveBeenCalledOnce();
    expect(failures.mock.calls[0]?.[0].message).toBe(
      "Access was saved, but the project's member list wasn't updated.",
    );
    failures.mock.calls[0]?.[1]();
    await vi.waitFor(() =>
      expect(cache.getSnapshot().projects[0]?.tracker.groupMembers).toContain(bob),
    );
  });
});

it.each([
  "https://BOB.example/home.ttl",
  "https://bob.example/home.ttl?q=1",
  "https://bob.example/home.ttl#this",
  "https://bob.example/home",
  "https://bob.example/.ttl",
  "https://bob.example/encoded%2fhome.ttl",
  "https://bob.example/encoded%5chome.ttl",
  "https://bob.example/home.tt%6c",
])("refuses ambiguous project folder derivation for %s", (url) => {
  expect(() => requireProjectFolder(url, url.replace(/\.ttl$/, "/"))).toThrow(ModelError);
});
it("rejects missing stateStore even on a valid tracker", () => {
  expect(() => requireProjectFolder("https://bob.example/home.ttl", undefined)).toThrow(ModelError);
});
