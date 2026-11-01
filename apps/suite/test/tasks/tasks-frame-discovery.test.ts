// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { RdfIO } from "../../src/apps/tasks/lib/model/io";
import { NS, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import { TypeIndex } from "../../src/apps/tasks/lib/model/type-index";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, Pod, storage, webId } from "./pod";

describe("registered project container isolation", () => {
  it.each([
    403, 503,
  ])("keeps Inbox and healthy registrations usable after a container returns %s", async (status) => {
    const pod = new Pod();
    const store = new TaskStore({
      storage,
      webId,
      fetch: pod.fetch,
      ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
      ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
    });
    const inbox = await store.bootstrapInbox();
    await store.createTask(inbox, { title: "Inbox task", state: "open" });
    const containers = [`${storage}issues/broken/`, `${storage}issues/healthy/`];
    const projectUrls: string[] = [];
    for (const [index, container] of containers.entries()) {
      await pod.emptyContainer(container);
      const url = `${container}project.ttl`;
      projectUrls.push(url);
      const project = createTracker(
        url,
        index === 0 ? "Recovered" : "Healthy",
        container,
        [webId],
        now,
      );
      pod.seed(url, await serialize(project.dataset));
    }
    await new TypeIndex(
      new RdfIO(pod.fetch),
      storage,
      webId,
      pod.ensurePrivateIndexAccess,
    ).register(
      containers.map((location) => ({
        forClass: `${NS.WF}Tracker`,
        location,
        kind: "instanceContainer",
      })),
    );
    const failedContainer = containers[0] as string;
    pod.intercept = (request) =>
      request.method === "GET" && request.url === failedContainer
        ? new Response(null, { status })
        : undefined;
    const errors = vi.fn();
    expect((await store.listProjects(errors)).map((project) => project.url)).toEqual([
      inbox.url,
      projectUrls[1],
    ]);
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      failedContainer,
      expect.objectContaining({ status }),
    );
    // Callers without an isolation callback still receive the failure.
    await expect(store.listProjects()).rejects.toMatchObject({ status, url: failedContainer });

    const failures = vi.fn();
    const cache = new TasksCache(store, failures, webId);
    await cache.start();
    expect(cache.getSnapshot().status).toBe("ready");
    expect(cache.getSnapshot().tasks[failedContainer]).toMatchObject({
      status: "error",
      error: { status },
    });
    await cache.loadTasks(inbox);
    expect(cache.getSnapshot().views.map((task) => task.title)).toEqual(["Inbox task"]);
    expect(cache.getSnapshot().projects.map((project) => project.tracker.title)).toEqual([
      "Inbox",
      "Healthy",
    ]);
    expect(failures).not.toHaveBeenCalled();

    pod.intercept = undefined;
    await cache.retryProject(failedContainer);
    expect(cache.getSnapshot().tasks[failedContainer]).toBeUndefined();
    expect(new Set(cache.getSnapshot().projects.map((project) => project.tracker.title))).toEqual(
      new Set(["Inbox", "Healthy", "Recovered"]),
    );
  });
});
