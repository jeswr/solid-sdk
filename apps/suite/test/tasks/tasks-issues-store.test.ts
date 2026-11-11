// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { addIssueComment, issueComments } from "../../src/apps/tasks/lib/issues/model";
import { IssuesTaskStore } from "../../src/apps/tasks/lib/issues/store";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TypeIndex } from "../../src/apps/tasks/lib/model/type-index";
import { storage, webId } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

describe("Issues store boundaries", () => {
  it("rejects issue moves before writing or deleting any data", async () => {
    const { store, pod, project } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    const created = await store.createTask(project, { title: "Keep here", state: "open" });
    const item = await store.updateTask(created, (task) => {
      addIssueComment(task, "Keep this reply", webId, "reply", new Date());
      node(task.id, task.dataset).setText("https://example.org/extra", "Keep");
    });
    const before = pod.mutations().length;
    expect(() => store.prepareTaskMove(item, project, inbox)).toThrow("Issues cannot be moved");
    await expect(store.moveTaskToProject(item, project, inbox)).rejects.toThrow(
      "Issues cannot be moved",
    );
    expect(pod.mutations()).toHaveLength(before);
    const reread = await store.readTask(item.url);
    expect(issueComments(reread.task)[0]?.content).toBe("Keep this reply");
    expect(node(reread.task.id, reread.dataset).text("https://example.org/extra")).toBe("Keep");
  });
  it.each([
    "write",
    "append",
  ])("creates with container %s and edits with document write despite read-only tracker", async (mode) => {
    const { store, pod, project } = await issuesFixture();
    const created = await store.createTask(project, { title: "Editable", state: "open" });
    const permissions = new Map([
      [trackerUrl, "read"],
      [containerUrl, `read ${mode}`],
      [created.url, "read write"],
    ]);
    pod.intercept = (request) =>
      request.method === "GET" && permissions.has(request.url)
        ? new Response(pod.files.get(request.url)?.body, {
            headers: {
              "Content-Type": "text/turtle",
              ETag: `"${pod.files.get(request.url)?.version}"`,
              "WAC-Allow": `user="${permissions.get(request.url)}"`,
            },
          })
        : undefined;
    await store.readProject(trackerUrl);
    await store.issuesIO.read(containerUrl);
    const item = await store.readTask(created.url);
    expect(store.canCreate(project)).toBe(true);
    expect(store.canEdit(project, item)).toBe(true);
    expect(store.canEdit(project)).toBe(false);
    const commented = await store.updateTask(item, (task) => {
      task.title = "Edited";
      addIssueComment(task, "Reply", webId, "reply", new Date());
    });
    expect(commented.task.title).toBe("Edited");
    expect(issueComments(commented.task)[0]?.content).toBe("Reply");
    expect((await store.createTask(project, { title: "New", state: "open" })).task.title).toBe(
      "New",
    );
    permissions.set(containerUrl, "read");
    await store.issuesIO.read(containerUrl);
    expect(store.canCreate(project)).toBe(false);
    expect(store.canEdit(project, commented)).toBe(true);
    await store.updateTask(commented, (task) => {
      task.description = "Still editable";
    });
    await expect(
      store.updateProject(project, (tracker) => {
        tracker.title = "No";
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("initialises a missing issues container conditionally before the first issue", async () => {
    const { store, pod, project } = await issuesFixture();
    pod.files.delete(containerUrl);
    const item = await store.createTask(project, { title: "First issue", state: "open" });
    expect(item.task.title).toBe("First issue");
    expect(
      pod
        .mutations()
        .find((request) => request.url === containerUrl)
        ?.headers.get("If-None-Match"),
    ).toBe("*");
  });
  it("rechecks creation permissions on the first container read", async () => {
    const { store, pod, project } = await issuesFixture();
    pod.intercept = (request) =>
      request.url === containerUrl
        ? new Response(`<${containerUrl}> a <${NS.LDP}BasicContainer>.`, {
            headers: { "Content-Type": "text/turtle", "WAC-Allow": 'user="read"' },
          })
        : undefined;
    await expect(
      store.createTask(project, { title: "No permission", state: "open" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(pod.mutations()).toHaveLength(0);
  });
  it("retains the ordinary Tasks CRUD path", async () => {
    const { store } = await issuesFixture();
    const project = await store.bootstrapInbox();
    const renamed = await store.updateProject(project, (tracker) => {
      tracker.title = "Inbox renamed";
    });
    expect(renamed.tracker.title).toBe("Inbox renamed");
    const created = await store.createTask(project, { title: "Normal task", state: "open" });
    const read = await store.readTask(created.url);
    const updated = await store.updateTask(read, (task) => {
      task.description = "Ordinary body";
    });
    expect(updated.task.description).toBe("Ordinary body");
    expect(await store.listTasks(project.tracker.stateStore as string)).toHaveLength(1);
    const target = await store.createProject("Destination");
    const moved = await store.moveTaskToProject(updated, project, target, "moved");
    expect(moved.task.description).toBe("Ordinary body");
    expect(await store.listTasks(project.tracker.stateStore as string)).toHaveLength(0);
  });
  it("rejects a tracker that points outside its own folder or to a non-container", async () => {
    const { pod, store, project } = await issuesFixture();
    for (const location of [
      "https://evil.example/issues/",
      `${storage}issue-tracker/not-a-container`,
    ]) {
      node(project.tracker.id, project.dataset).setIri(`${NS.WF}stateStore`, location);
      pod.seed(project.url, await serialize(project.dataset));
      await expect(store.readProject(project.url)).rejects.toMatchObject({ status: 400 });
    }
  });
  it("keeps tracker and issue write permission independent of create permission", async () => {
    const { pod, store, project } = await issuesFixture();
    const item = await store.createTask(
      project,
      { title: "Protected", state: "open" },
      "protected",
    );
    pod.intercept = (request) =>
      request.method === "GET" && [trackerUrl, item.url].includes(request.url)
        ? new Response(pod.files.get(request.url)?.body, {
            headers: { "Content-Type": "text/turtle", ETag: '"1"', "WAC-Allow": 'user="read"' },
          })
        : undefined;
    await store.readTask(item.url);
    expect(store.canEdit(project, item)).toBe(false);
    await expect(
      store.updateTask(item, (task) => {
        task.title = "No";
      }),
    ).rejects.toMatchObject({ status: 403 });
    await store.readProject(trackerUrl);
    await expect(
      store.updateProject(project, (tracker) => {
        tracker.title = "No";
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("ignores untrusted members and isolates per-issue failures, with strict recovery reads", async () => {
    const { pod, store } = await issuesFixture();
    pod.seed(
      containerUrl,
      `<${containerUrl}> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <https://evil.example/secret.ttl>, <${containerUrl}bad.ttl>, <${containerUrl}notes.txt>.`,
    );
    pod.seed(`${containerUrl}bad.ttl`, `<#this> <${NS.DCT}title> "Not a task".`);
    expect(await store.listTasks(containerUrl)).toEqual([]);
    await expect(store.listTasks(containerUrl, { strict: true })).rejects.toThrow(
      "Expected a wf:Task",
    );
    expect(await store.listTasks(containerUrl, { strict: true, skipInvalid: true })).toEqual([]);
    expect(pod.requests.some((request) => request.url.startsWith("https://evil.example"))).toBe(
      false,
    );
  });
  it("isolates a failed registered container and a malformed registered tracker", async () => {
    const { pod, store } = await issuesFixture();
    await store.bootstrapInbox();
    pod.seed(`${store.projects}notes.txt`, "# Not a tracker document");
    await pod.emptyContainer(`${storage}mixed/`);
    pod.seed(`${storage}mixed/notes.txt`, "# Not a tracker document");
    const index = new TypeIndex(store.issuesIO, storage, webId, pod.ensurePrivateIndexAccess);
    await index.register([
      { forClass: `${NS.WF}Tracker`, location: `${storage}mixed/`, kind: "instanceContainer" },
      { forClass: `${NS.WF}Tracker`, location: `${storage}gone/`, kind: "instanceContainer" },
      { forClass: `${NS.WF}Tracker`, location: `${storage}malformed.ttl`, kind: "instance" },
    ]);
    pod.seed(`${storage}malformed.ttl`, `<#this> <${NS.DCT}title> "Not a tracker".`);
    pod.intercept = (request) =>
      request.url === `${storage}gone/` ? new Response(null, { status: 403 }) : undefined;
    const failure = vi.fn();
    expect((await store.listProjects(failure)).some((project) => project.url === trackerUrl)).toBe(
      true,
    );
    expect(failure).toHaveBeenCalledWith(
      `${storage}gone/`,
      expect.objectContaining({ status: 403 }),
    );
    expect(failure).toHaveBeenCalledWith(`${storage}malformed.ttl`, expect.any(TypeError));
    await store.listProjects();
  });
  it("uses the injected/default clock, handles absent indexes and validates new document identifiers", async () => {
    const { pod } = await issuesFixture();
    const store = new IssuesTaskStore({ storage, webId, fetch: pod.fetch, typeIndex: false });
    const project = await store.readProject(trackerUrl);
    const created = await store.createTask(project, { title: "No clock option", state: "open" });
    expect(created.task.created).toBeInstanceOf(Date);
    const updated = await store.updateTask(created, (task) => {
      task.description = "Default clock";
    });
    expect(updated.task.modified).toBeInstanceOf(Date);
    await expect(
      store.createTask(project, { title: "Unsafe", state: "open" }, "../escape"),
    ).rejects.toThrow("Invalid task identifier");
    await expect(
      store.updateTask(updated, (task) => {
        task.assignee = "javascript:alert(1)";
      }),
    ).rejects.toThrow();
    expect((await store.listProjects()).map((project) => project.url)).toEqual([trackerUrl]);
  });
});
