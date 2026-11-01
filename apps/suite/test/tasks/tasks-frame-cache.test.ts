// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { frameCache } from "./tasks-frame-fixtures";

describe("Tasks refresh isolation and project creation retry", () => {
  it.each([
    "tracker",
    "projects",
  ])("reloads a changed stateStore after a %s notification", async (notification) => {
    const { cache, store, pod, inbox } = await frameCache();
    await cache.createTask(inbox, { title: "Old container" });
    const container = `${store.projects}replacement/`;
    await pod.emptyContainer(container);
    const refreshed = await store.updateProject(inbox, (tracker) => {
      tracker.stateStore = container;
    });
    await store.createTask(refreshed, { title: "New container", state: "open" }, "new");
    await cache.invalidate(notification === "tracker" ? inbox.url : store.projects);
    expect(cache.getSnapshot().projects[0]?.tracker.stateStore).toBe(container);
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["New container"]);
    // A callback holding the previous tracker must also resolve its current container.
    await cache.loadTasks(inbox, true);
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["New container"]);
  });

  it.each([
    "success",
    "failure",
  ])("fences an old-container %s while stateStore refreshes", async (outcome) => {
    const { cache, store, pod, inbox } = await frameCache();
    const task = await cache.createTask(inbox, { title: "Old container" });
    if (!task) throw new Error("Missing task");
    let resolve!: (tasks: NonNullable<typeof task>[]) => void;
    let reject!: (error: unknown) => void;
    vi.spyOn(store, "listTasks").mockReturnValueOnce(
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    const reading = cache.loadTasks(inbox, true);
    const container = `${store.projects}replacement/`;
    await pod.emptyContainer(container);
    const refreshed = await store.updateProject(inbox, (tracker) => {
      tracker.stateStore = container;
    });
    await store.createTask(refreshed, { title: "New container", state: "open" }, "new");
    await cache.refreshProjects();
    expect(cache.getSnapshot().views).toEqual([]);
    if (outcome === "success") resolve([task]);
    else reject(new ModelError(403, inbox.tracker.stateStore as string));
    await reading;
    await vi.waitFor(() =>
      expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["New container"]),
    );
    expect(cache.getSnapshot().tasks[inbox.url]?.status).toBe("ready");
  });

  it.each([
    401, 403,
  ])("clears private tasks when their tracker returns %s while other projects refresh", async (status) => {
    const { cache, store, pod, inbox } = await frameCache();
    const home = await cache.createProject("Home");
    if (!home) throw new Error("Missing Home");
    await cache.loadTasks(home);
    const secret = await cache.createTask(home, { title: "Secret" });
    const visible = await cache.createTask(inbox, { title: "Public" });
    if (!secret || !visible) throw new Error("Missing tasks");
    await store.updateTask(visible, (task) => {
      task.title = "Refreshed";
    });
    expect(cache.getSnapshot().views.map((task) => task.title)).toContain("Secret");
    pod.intercept = (request) =>
      request.url === home.url && request.method === "GET"
        ? new Response(null, { status })
        : undefined;
    await cache.invalidate(store.projects);
    expect(cache.getSnapshot().status).toBe("ready");
    expect(cache.getSnapshot().tasks[home.url]).toMatchObject({
      status: "error",
      items: [],
      error: { status },
    });
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["Refreshed"]);
    await cache.loadTasks(home, true);
    expect(cache.getSnapshot().views.map((task) => task.title)).not.toContain("Secret");
    pod.intercept = undefined;
    await cache.loadTasks(home, true);
    expect(cache.getSnapshot().views.map((task) => task.title)).toContain("Secret");
  });

  it("fences an older successful task load when tracker access is revoked", async () => {
    const { cache, store, pod, inbox } = await frameCache();
    const secret = await cache.createTask(inbox, { title: "Secret" });
    if (!secret) throw new Error("Missing task");
    let resolve!: (tasks: NonNullable<typeof secret>[]) => void;
    vi.spyOn(store, "listTasks").mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const reading = cache.loadTasks(inbox, true);
    pod.intercept = (request) =>
      request.url === inbox.url && request.method === "GET"
        ? new Response(null, { status: 403 })
        : undefined;
    await cache.refreshProjects();
    resolve([secret]);
    await reading;
    expect(cache.getSnapshot().views).toEqual([]);
    expect(cache.getSnapshot().tasks[inbox.url]?.items).toEqual([]);
  });

  it("skips malformed recurrence projections per task and records a project warning", async () => {
    const { cache, store, pod, inbox } = await frameCache();
    const bad = await store.createTask(inbox, { title: "Malformed", state: "open" }, "bad");
    await store.createTask(inbox, { title: "Valid", state: "open" }, "good");
    const dataset = await pod.dataset(bad.url);
    const rule = `${bad.url}#recurrence`;
    node(bad.task.id, dataset).iris(`${NS.SCHEDULING}recurrence`).add(rule);
    node(rule, dataset).setText(`${NS.SCHEDULING}frequency`, "FORTNIGHTISH");
    pod.seed(bad.url, await serialize(dataset));
    await cache.loadTasks(inbox, true);
    expect(cache.getSnapshot().tasks[inbox.url]).toMatchObject({
      status: "ready",
      warningCount: 1,
    });
    expect(cache.getSnapshot().tasks[inbox.url]?.items.map((item) => item.task.title)).toEqual([
      "Valid",
    ]);
    expect(cache.getSnapshot().views.map((item) => item.title)).toEqual(["Valid"]);
    await cache.updateTask(cache.getSnapshot().tasks[inbox.url]?.items[0] ?? bad, (task) => {
      task.title = "Still valid";
    });
    expect(cache.getSnapshot().views.map((item) => item.title)).toEqual(["Still valid"]);
  });

  it("retries position assignment on the created project without allocating a second slug", async () => {
    const { cache, store, failures } = await frameCache();
    const creates = vi.spyOn(store, "createProject");
    const updates = vi
      .spyOn(store, "updateProject")
      .mockRejectedValueOnce(new ModelError(503, store.projects));
    expect(await cache.createProject("Home")).toBeUndefined();
    expect(creates).toHaveBeenCalledTimes(1);
    failures.mock.calls[0]?.[1]();
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        cache.getSnapshot().projects.find((project) => project.tracker.title === "Home")?.tracker
          .position,
      ).toBe(1),
    );
    expect(creates).toHaveBeenCalledTimes(1);
    expect(
      (await store.listProjects())
        .filter((project) => project.tracker.title === "Home")
        .map((project) => project.url),
    ).toEqual([`${store.projects}home.ttl`]);
  });
});
