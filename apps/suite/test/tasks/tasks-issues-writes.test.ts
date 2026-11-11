// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { addIssueComment, issueComments } from "../../src/apps/tasks/lib/issues/model";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { webId } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

describe("Issues conditional writes through Tasks", () => {
  it.each([
    "this",
    "issue-42",
  ])("completes and undoes a legacy #%s issue without losing comments or unknown data", async (fragment) => {
    const { store, pod, project } = await issuesFixture();
    const url = `${containerUrl}legacy.ttl`;
    pod.seed(
      url,
      `<#${fragment}> a <${NS.WF}Task>, <${NS.WF}Open>; <${NS.DCT}title> "Legacy"; <${NS.WF}tracker> <${trackerUrl}#this>; <https://example.org/extra> "Keep".`,
    );
    let item = await store.readTask(url);
    item = await store.updateTask(item, (task) =>
      addIssueComment(task, "Reply", webId, "reply", new Date()),
    );
    const cache = new TasksCache(store, vi.fn(), webId);
    await cache.start();
    await cache.loadTasks(project);
    const inbox = cache
      .getSnapshot()
      .projects.find((candidate) => candidate.url === cache.inboxUrl);
    if (!inbox) throw new Error("Missing inbox");
    const beforeMove = pod.mutations().length;
    expect(await cache.moveTaskToProject(item, inbox)).toBeUndefined();
    expect(pod.mutations()).toHaveLength(beforeMove);
    expect(cache.getSnapshot().views.find((view) => view.url === url)?.projectUrl).toBe(
      project.url,
    );
    const plan = await cache.completeTask(item);
    expect(plan?.kind).toBe("close");
    const closed = await store.readTask(url);
    expect(closed.task.id).toBe(`${url}#${fragment}`);
    expect(closed.task.state).toBe("closed");
    expect(closed.task.endedAt).toBeInstanceOf(Date);
    expect(closed.task.types.has(`${NS.WF}Open`)).toBe(false);
    expect(closed.task.types.has(`${trackerUrl}#status-done`)).toBe(true);
    expect(issueComments(closed.task)[0]?.content).toBe("Reply");
    expect(node(closed.task.id, closed.dataset).text("https://example.org/extra")).toBe("Keep");
    expect(node(`${url}#it`, closed.dataset).types.size).toBe(0);
    if (!plan) throw new Error("Missing completion");
    expect(await cache.undoCompletion(item, plan)).toBe(true);
    const reopened = await store.readTask(url);
    expect(reopened.task.state).toBe("open");
    expect(reopened.task.endedAt).toBeUndefined();
    expect(reopened.task.types.has(`${trackerUrl}#status-todo`)).toBe(true);
    expect(issueComments(reopened.task)[0]?.content).toBe("Reply");
  });
  it("creates with If-None-Match and edits, closes, reopens and comments with If-Match", async () => {
    const { store, pod, project } = await issuesFixture();
    const cache = new TasksCache(store, vi.fn(), webId);
    await cache.start();
    await cache.loadTasks(project);
    const created = await cache.createTask(project, {
      title: "Created in Tasks",
      priority: "high",
    });
    expect(created).toBeDefined();
    if (!created) throw new Error("Missing issue");
    expect(created.url.startsWith(containerUrl)).toBe(true);
    expect(created.task.types.has(`${trackerUrl}#priority-high`)).toBe(true);
    const updated = await cache.updateTask(created, (task) => {
      task.title = "Edited issue";
      task.description = "Shared body";
      task.assignee = webId;
      task.priority = "medium";
      task.dueDate = new Date("2026-11-20T12:00:00Z");
      task.types.add(`${trackerUrl}#label-bug`);
      addIssueComment(task, "Reply", webId, "reply", new Date("2026-11-01Z"));
      task.state = "closed";
    });
    expect(updated?.task.state).toBe("closed");
    expect(updated?.task.types.has(`${trackerUrl}#status-done`)).toBe(true);
    const reopened = await cache.updateTask(created, (task) => {
      task.state = "open";
    });
    expect(reopened?.task.endedAt).toBeUndefined();
    expect(reopened?.task.types.has(`${trackerUrl}#status-todo`)).toBe(true);
    const reread = await store.readTask(created.url);
    expect(reread.task.title).toBe("Edited issue");
    expect(reread.task.description).toBe("Shared body");
    expect(reread.task.assignee).toBe(webId);
    expect(reread.task.priority).toBe("medium");
    expect(reread.task.dueDate?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(issueComments(reread.task)[0]?.content).toBe("Reply");
    expect(
      pod
        .mutations()
        .filter((request) => request.url === created.url)
        .map((request) => [request.headers.get("If-None-Match"), request.headers.get("If-Match")]),
    ).toEqual([
      ["*", null],
      [null, '"1"'],
      [null, '"2"'],
    ]);
  });
  it("preserves unknown triples and the #this subject on legacy issues", async () => {
    const { store, pod } = await issuesFixture();
    const url = `${containerUrl}legacy.ttl`;
    pod.seed(
      url,
      `<#this> a <${NS.WF}Task>, <${NS.WF}Open>; <${NS.DCT}title> "Legacy"; <${NS.WF}tracker> <${trackerUrl}#this>; <https://example.org/extra> "Keep".`,
    );
    const item = await store.readTask(url);
    const updated = await store.updateTask(item, (task) => {
      task.title = "Still legacy";
    });
    expect(updated.task.id).toBe(`${url}#this`);
    expect(node(updated.task.id, updated.dataset).text("https://example.org/extra")).toBe("Keep");
    expect(node(`${url}#it`, updated.dataset).types.size).toBe(0);
  });
  it("rolls back a 412, refreshes and supplies the existing retry handler", async () => {
    const { store, pod, project } = await issuesFixture();
    const failure = vi.fn();
    const cache = new TasksCache(store, failure, webId);
    await cache.start();
    await cache.loadTasks(project);
    const created = await cache.createTask(project, { title: "Baseline" });
    if (!created) throw new Error("Missing issue");
    const remote = await store.readTask(created.url);
    remote.task.title = "Changed elsewhere";
    pod.seed(created.url, await serialize(remote.dataset));
    expect(
      await cache.updateTask(created, (task) => {
        task.title = "My edit";
      }),
    ).toBeUndefined();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 412 }),
      expect.any(Function),
    );
    expect(cache.getSnapshot().views.find((view) => view.url === created.url)?.title).toBe(
      "Changed elsewhere",
    );
    failure.mock.calls[0]?.[1]();
    await vi.waitFor(() =>
      expect(cache.getSnapshot().views.find((view) => view.url === created.url)?.title).toBe(
        "My edit",
      ),
    );
  });
  it("preserves fallback stateStore when declaring a label in the existing editor", async () => {
    const { store, project } = await issuesFixture();
    const updated = await store.updateProject(project, (tracker) =>
      tracker.defineCategory("Label", "Bug"),
    );
    expect(updated.tracker.stateStore).toBe(containerUrl);
    expect(updated.tracker.labels[0]?.name).toBe("Bug");
    expect(updated.tracker.categories.has(updated.tracker.labels[0]?.id ?? "")).toBe(true);
    expect(node(updated.tracker.id, updated.dataset).iri(`${NS.WF}stateStore`)).toBeUndefined();
  });
  it("refuses to overwrite an existing issue URL", async () => {
    const { store, project } = await issuesFixture();
    await store.createTask(project, { title: "First", state: "open" }, "fixed");
    await expect(
      store.createTask(project, { title: "Other", state: "open" }, "fixed"),
    ).rejects.toMatchObject({ status: 412 });
    expect((await store.readTask(`${containerUrl}fixed.ttl`)).task.title).toBe("First");
  });
});
