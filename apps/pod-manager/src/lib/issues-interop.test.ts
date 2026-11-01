// AUTHORED-BY Codex GPT-6.1-Sol
import { Task, type TaskPriority } from "@jeswr/solid-task-model";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { buildIssue, IssueDoc, issuesStore, parseIssue, type Issue } from "./issues.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "./integrations/core/testing.js";
import { serializeTurtle } from "./pod-data.js";

const url = `${TEST_POD_ROOT}issues/shared.ttl`;
const creator = "https://reporter.example/profile#me";
const assignee = "https://assignee.example/profile#me";
const priorities: (TaskPriority | undefined)[] = ["high", "medium", "low", undefined];

describe.each(["open", "closed"] as const)("shared %s issues", (state) => {
  it.each(priorities)("reads a Task with priority %s and rebuilds it intact", (priority) => {
    const dataset = new Store();
    const task = new Task(`${url}#it`, dataset, DataFactory).mark();
    task.title = "Shared task";
    task.state = state;
    task.assignee = assignee;
    task.priority = priority;
    task.creator = creator;

    const expected = { title: "Shared task", state, assignee, priority, creator };
    const issue = parseIssue(url, dataset);
    expect(issue).toMatchObject(expected);
    const rebuilt = new Task(`${url}#it`, buildIssue(url, issue!), DataFactory);
    expect(rebuilt).toMatchObject(expected);
  });

  it.each(priorities)("exposes a PM issue with priority %s to Task", (priority) => {
    const issue: Issue = { title: "PM issue", state, assignee, priority, creator };
    const dataset = buildIssue(url, issue);
    const task = new Task(`${url}#it`, dataset, DataFactory);
    expect(task.isTask).toBe(true);
    expect(task).toMatchObject(issue);
    expect(parseIssue(url, dataset)).toMatchObject(issue);
  });
});

describe("shared priority and creator accessors", () => {
  it.each([" HIGH ", "Medium", "low", "urgent", "", " high priority ", undefined])(
    "normalizes raw priority %s exactly like Task",
    (value) => {
      const dataset = new Store();
      const task = new Task(`${url}#it`, dataset, DataFactory).mark();
      OptionalAs.object(task, "http://schema.org/priority", value, LiteralFrom.string);
      expect(parseIssue(url, dataset)?.priority).toBe(task.priority);
    },
  );

  it("removes priority when cleared and leaves creator intact", () => {
    const dataset = buildIssue(url, { title: "x", state: "open", priority: "high", creator });
    const doc = new IssueDoc(`${url}#it`, dataset, DataFactory);
    doc.priority = undefined;
    const task = new Task(`${url}#it`, dataset, DataFactory);
    expect(task.priority).toBeUndefined();
    expect(
      OptionalFrom.subjectPredicate(doc, "http://schema.org/priority", LiteralAs.string),
    ).toBeUndefined();
    expect(task.creator).toBe(creator);
    expect(parseIssue(url, dataset)?.priority).toBeUndefined();
  });

  it.each(["just a name", "ftp://reporter.example/me", "", undefined])(
    "omits a creator that is not a WebID: %s",
    (value) => {
      const dataset = buildIssue(url, { title: "x", state: "open", creator: value });
      expect(new Task(`${url}#it`, dataset, DataFactory).creator).toBeUndefined();
    },
  );
});

describe("issues store authorship and priority", () => {
  function setup() {
    const pod = createMemoryPod();
    const store = issuesStore({ podRoot: TEST_POD_ROOT, webId: TEST_WEBID, fetchImpl: pod.fetch });
    return { pod, store };
  }

  it("stamps the acting user's WebID on create without mutating the payload", async () => {
    const { store } = setup();
    const data: Issue = { title: "New issue", state: "open", priority: "high", creator };
    const { url: createdUrl } = await store.create(data);
    expect((await store.read(createdUrl))?.data).toMatchObject({
      ...data,
      creator: TEST_WEBID,
    });
    expect(data.creator).toBe(creator);
  });

  it("leaves creator absent when the store has no acting WebID", async () => {
    const pod = createMemoryPod();
    const store = issuesStore({ podRoot: TEST_POD_ROOT, webId: "", fetchImpl: pod.fetch });
    // Registration needs a profile; isolate the create contract without a known user.
    vi.spyOn(store, "ensureRegistered").mockResolvedValue(undefined);
    const { url: createdUrl } = await store.create({ title: "Anonymous fixture", state: "open" });
    expect((await store.read(createdUrl))?.data.creator).toBeUndefined();
  });

  it.each([creator, undefined])("preserves creator %s on update and clears priority", async (author) => {
    const { pod, store } = setup();
    const dataset = buildIssue(url, {
      title: "Imported issue",
      state: "open",
      creator: author,
      priority: "high",
    });
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(dataset),
    });
    const item = (await store.read(url))!;
    await store.update(url, { ...item.data, title: "Edited issue", priority: undefined }, item.etag);
    const updated = (await store.read(url))!;
    expect(updated.data.creator).toBe(author);
    expect(updated.data.priority).toBeUndefined();
    expect(updated.data.title).toBe("Edited issue");
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const saved = await parseRdf(pod.get(url)!, "text/turtle", { baseIRI: url });
    const task = new Task(`${url}#it`, saved, DataFactory);
    expect(task.creator).toBe(author);
    expect(task.priority).toBeUndefined();
  });

  it.each([undefined, TEST_WEBID])("retains the original creator when an update supplies %s", async (replacement) => {
    const { pod, store } = setup();
    await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(buildIssue(url, { title: "Imported issue", state: "open", creator })),
    });
    const item = (await store.read(url))!;
    await store.update(url, { title: "Edited issue", state: "open", creator: replacement }, item.etag);
    expect((await store.read(url))?.data.creator).toBe(creator);
  });

  it("keeps conditional writes when preserving creator", async () => {
    const { store } = setup();
    const { url: createdUrl } = await store.create({ title: "Before", state: "open", priority: "high" });
    await expect(
      store.update(createdUrl, { title: "After", state: "closed", creator }, '"stale"'),
    ).rejects.toMatchObject({ status: 412 });
    expect((await store.read(createdUrl))?.data).toMatchObject({
      title: "Before",
      state: "open",
      creator: TEST_WEBID,
      priority: "high",
    });
  });
});
