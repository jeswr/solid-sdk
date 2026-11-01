// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { Pod } from "./pod";
import { frameStore } from "./tasks-frame-fixtures";

describe("project deletion boundaries and recovery", () => {
  it("never reads or deletes forged members outside the exact task container", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const work = await store.createProject("Work");
    const task = await store.createTask(work, { title: "Private Work task", state: "open" });
    const container = home.tracker.stateStore as string;
    const invalid = [
      task.url,
      `${container}nested/task.ttl`,
      `${container}query.ttl?q=1`,
      `${container}fragment.ttl#it`,
      `${container}metadata.acl`,
      `${container}bad%2Ftask.ttl`,
      `${container}bad%5Ctask.ttl`,
      `${container}.ttl`,
      "https://evil.test/task.ttl",
      "mailto:someone@example.org",
      `${container}broken%xx.ttl`,
      `${container}empty-query.ttl?`,
      `${container}empty-fragment.ttl#`,
      `https://user:password@pod.test${new URL(container).pathname}task.ttl`,
    ];
    const dataset = await pod.dataset(container);
    for (const url of invalid) node(container, dataset).iris(`${NS.LDP}contains`).add(url);
    pod.seed(container, await serialize(dataset));
    pod.requests.length = 0;
    await store.deleteProject(home);
    expect(pod.requests.filter((request) => invalid.includes(request.url))).toEqual([]);
    expect(pod.files.has(task.url)).toBe(true);
    expect(pod.files.has(work.url)).toBe(true);
  });

  it("rejects stale tracker revisions before any destructive request", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Keep", state: "open" });
    await store.updateProject(home, (tracker) => {
      tracker.title = "Renamed elsewhere";
    });
    pod.requests.length = 0;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
  });

  it("conditionally reserves even when a tracker changes between read and reservation", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Keep", state: "open" });
    pod.requests.length = 0;
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === home.url
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
  });

  it.each([
    "member",
    "container",
    "tracker",
  ])("resumes a failed %s deletion with a new store and the old caller revision", async (failure) => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const first = await store.createTask(home, { title: "First", state: "open" }, "first");
    const second = await store.createTask(home, { title: "Second", state: "open" }, "second");
    const failingUrl =
      failure === "member"
        ? second.url
        : failure === "container"
          ? home.tracker.stateStore
          : home.url;
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === failingUrl
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(first.url)).toBe(false);
    expect(
      pod.requests
        .find((request) => request.method === "PUT" && request.body.includes("pending"))
        ?.headers.get("If-Match"),
    ).toBe(home.etag);
    const pending = await store.readProject(home.url);
    await expect(
      store.updateProject(pending, (tracker) => {
        tracker.title = "New";
      }),
    ).rejects.toMatchObject({ status: 412 });
    pod.intercept = undefined;
    await frameStore(pod).deleteProject(home);
    await frameStore(pod).deleteProject(home);
    expect(
      [home.url, first.url, second.url, home.tracker.stateStore].some((url) =>
        pod.files.has(url as string),
      ),
    ).toBe(false);
  });

  it("treats concurrent 404s on already removed tasks and containers as success", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Gone", state: "open" });
    pod.intercept = (request) => {
      if (
        request.method === "DELETE" &&
        [task.url, home.tracker.stateStore].includes(request.url)
      ) {
        pod.files.delete(request.url);
        return new Response(null, { status: 404 });
      }
    };
    await store.deleteProject(home);
    expect(pod.files.has(home.url)).toBe(false);
  });

  it("refuses recovery when a pending tracker's stateStore has changed", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const work = await store.createProject("Work");
    const task = await store.createTask(home, { title: "Interrupted", state: "open" });
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === task.url
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 503 });
    pod.intercept = undefined;
    const dataset = await pod.dataset(home.url);
    const stateStores = node(home.tracker.id, dataset).iris(`${NS.WF}stateStore`);
    stateStores.clear();
    stateStores.add(work.tracker.stateStore as string);
    pod.seed(home.url, await serialize(dataset));
    pod.requests.length = 0;
    await expect(frameStore(pod).deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
    expect(pod.files.has(work.url)).toBe(true);
  });
});
