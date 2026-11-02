// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { frameCache } from "./tasks-frame-fixtures";

afterEach(() => vi.restoreAllMocks());

describe("label deletion mutation ordering", () => {
  it.each([
    ["assignment", false],
    ["create", false],
    ["assignment", true],
    ["create", true],
  ] as const)("strips a queued label %s after preflight (Retry: %s)", async (mutation, retrying) => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    const project = await cache.ensureLabels(inbox, ["bills", "keep"]);
    const labelId = project?.tracker.labels.find((label) => label.name === "bills")?.id;
    const keepId = project?.tracker.labels.find((label) => label.name === "keep")?.id;
    if (!project || !labelId || !keepId) throw new Error("Missing labels");
    const blocker = await cache.createTask(project, { title: "Blocker" });
    const existing = await cache.createTask(project, { title: "Rent", labelIds: [keepId] });
    if (!blocker || !existing) throw new Error("Missing tasks");
    const listed = await store.listTasks(project.tracker.stateStore as string, { strict: true });
    if (retrying) {
      vi.spyOn(store, "readProject").mockRejectedValueOnce(new ModelError(503, project.url));
      expect(await cache.deleteLabel(project, [labelId], listed)).toBeUndefined();
      expect(failures).toHaveBeenCalledOnce();
    }

    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === blocker.url) {
        entered.resolve();
        await resume.promise;
      }
      return undefined;
    };
    const blocking = cache.updateTask(blocker, (task) => {
      task.title = "Updated blocker";
    });
    await entered.promise;
    const pending =
      mutation === "assignment"
        ? cache.updateTask(existing, (task) => task.types.add(labelId))
        : cache.createTask(project, { title: "New rent", labelIds: [labelId, keepId] });
    // The user-facing preflight finishes while the label write is still queued.
    const preflight = await store.listTasks(project.tracker.stateStore as string, { strict: true });
    expect(preflight.some((item) => item.task.types.has(labelId))).toBe(false);
    const listing = vi.spyOn(store, "listTasks");
    const start = pod.requests.length;
    let deletion: ReturnType<typeof cache.deleteLabel> | undefined;
    if (retrying) failures.mock.calls[0]?.[1]();
    else deletion = cache.deleteLabel(project, [labelId], preflight);
    try {
      expect(listing).not.toHaveBeenCalled();
      expect(pod.requests).toHaveLength(start);
    } finally {
      resume.resolve();
      await blocking;
    }
    const assigned = await pending;
    if (!assigned) throw new Error("Missing labelled task");
    if (retrying)
      await vi.waitFor(() =>
        expect(cache.getSnapshot().projects[0]?.tracker.labels.map((label) => label.id)).toEqual([
          keepId,
        ]),
      );
    else expect(await deletion).toBeDefined();

    expect(failures).toHaveBeenCalledTimes(retrying ? 1 : 0);
    expect(listing).toHaveBeenCalledExactlyOnceWith(project.tracker.stateStore, { strict: true });
    const requests = pod.requests.slice(start);
    const assignment = requests.findIndex(
      (request) => request.method === "PUT" && request.url === assigned.url,
    );
    const freshListing = requests.findIndex(
      (request) => request.method === "GET" && request.url === project.tracker.stateStore,
    );
    const taskWrites = requests.filter(
      (request) => request.method === "PUT" && request.url === assigned.url,
    );
    expect(assignment).toBeGreaterThan(-1);
    expect(freshListing).toBeGreaterThan(assignment);
    expect(taskWrites).toHaveLength(2);
    expect(taskWrites[1]?.headers.get("If-Match")).toBe(assigned.etag);
    expect((await store.readTask(assigned.url)).task.types.has(labelId)).toBe(false);
    expect((await store.readTask(assigned.url)).task.types.has(keepId)).toBe(true);
    expect((await store.readProject(project.url)).tracker.labels.map((label) => label.id)).toEqual([
      keepId,
    ]);
    expect(cache.getSnapshot().views.find((task) => task.url === assigned.url)?.labelIds).toEqual([
      keepId,
    ]);
  });

  it("holds later mutations until the fresh listing and deletion writes finish", async () => {
    const { cache, store, inbox, pod, failures } = await frameCache();
    const project = await cache.ensureLabels(inbox, ["bills"]);
    const labelId = project?.tracker.labels[0]?.id;
    if (!project || !labelId) throw new Error("Missing label");
    const item = await cache.createTask(project, { title: "Rent", labelIds: [labelId] });
    if (!item) throw new Error("Missing task");
    const listed = await store.listTasks(project.tracker.stateStore as string, { strict: true });
    const listingEntered = Promise.withResolvers<void>();
    const resumeListing = Promise.withResolvers<void>();
    const trackerEntered = Promise.withResolvers<void>();
    const resumeTracker = Promise.withResolvers<void>();
    pod.intercept = async (request) => {
      if (request.method === "GET" && request.url === project.tracker.stateStore) {
        listingEntered.resolve();
        await resumeListing.promise;
      }
      if (request.method === "PUT" && request.url === project.url) {
        trackerEntered.resolve();
        await resumeTracker.promise;
      }
      return undefined;
    };
    const start = pod.requests.length;
    const deleting = cache.deleteLabel(project, [labelId], listed);
    let editing: ReturnType<typeof cache.updateTask> | undefined;
    try {
      await vi.waitFor(() =>
        expect(pod.requests.slice(start)).toContainEqual(
          expect.objectContaining({ method: "GET", url: project.tracker.stateStore }),
        ),
      );
      await listingEntered.promise;
      editing = cache.updateTask(item, (task) => {
        task.title = "Rent paid";
      });
      expect(pod.requests.slice(start).every((request) => request.method === "GET")).toBe(true);
      resumeListing.resolve();
      await trackerEntered.promise;
      expect(
        pod.requests
          .slice(start)
          .filter((request) => request.method === "PUT")
          .map((request) => request.url),
      ).toEqual([item.url, project.url]);
    } finally {
      resumeListing.resolve();
      resumeTracker.resolve();
      await deleting;
      await editing;
    }
    expect(failures).not.toHaveBeenCalled();
    expect(
      pod.requests
        .slice(start)
        .filter((request) => request.method === "PUT")
        .map((request) => request.url),
    ).toEqual([item.url, project.url, item.url]);
    const persisted = await store.readTask(item.url);
    expect(persisted.task.title).toBe("Rent paid");
    expect(persisted.task.types.has(labelId)).toBe(false);
  });
});
