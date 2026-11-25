// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import { inside, isIssueMember } from "../../src/apps/tasks/lib/issues/discovery";
import { IssueItem } from "../../src/apps/tasks/lib/issues/model";
import { DataFactory, NS, node, Store } from "../../src/apps/tasks/lib/model/rdf";
import { storage } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

const foreign = "https://evil.example/";
const tracker = (target: string, body: string) =>
  `<${target}#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Evil"; ${body}.`;

describe("foreign trackers are confined (F1)", () => {
  it("rejects http trackers", async () => {
    const { store, pod } = await issuesFixture();
    const url = "http://evil.example/issue-tracker/tracker.ttl";
    pod.seed(url, tracker(url, `<${NS.WF}issueClass> <${NS.WF}Task>`));
    await expect(store.openTracker(url)).rejects.toThrow();
    expect(store.isOpenedTracker(url)).toBe(false);
  });
  it("rejects a tracker that is not Issues-shaped, even one aimed at the user's own tasks", async () => {
    const { store, pod } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    const url = `${foreign}p.ttl`;
    pod.seed(url, tracker(url, `<${NS.WF}stateStore> <${storage}tasks/projects/inbox/>`));
    expect(inbox.tracker.stateStore).toBeDefined();
    await expect(store.openTracker(url)).rejects.toMatchObject({ status: 404 });
    expect((await store.listProjects()).some((project) => project.url === url)).toBe(false);
  });
  it.each([
    ["the tracker's own directory", `${foreign}issue-tracker/`],
    ["a container on another origin", `${storage}tasks/projects/inbox/`],
    ["a sibling directory", `${foreign}other/`],
    ["an encoded escape", `${foreign}issue-tracker/%2e%2e/`],
  ])("rejects an Issues-shaped tracker whose stateStore is %s", async (_name, stateStore) => {
    const { store, pod } = await issuesFixture();
    const url = `${foreign}issue-tracker/tracker.ttl`;
    pod.seed(url, tracker(url, `<${NS.WF}stateStore> <${stateStore}>`));
    await expect(store.openTracker(url)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects an Issues-shaped tracker whose container holds or is the user's Tasks projects", async () => {
    const { store, pod } = await issuesFixture();
    const own = `${storage}issue-tracker/issues/`;
    for (const stateStore of [store.projects, `${store.projects}inbox/`, own]) {
      const url = `${storage}issue-tracker/t${stateStore.length}.ttl`;
      pod.seed(url, tracker(url, `<${NS.WF}stateStore> <${stateStore}>`));
      const opened = await store.openTracker(url).catch(() => []);
      expect(opened.every((candidate) => candidate !== url || stateStore === own)).toBe(true);
    }
  });
  it("opens an Issues-shaped foreign tracker and reports it as opened, not own", async () => {
    const { store, pod } = await issuesFixture();
    const url = `${foreign}issue-tracker/tracker.ttl`;
    pod.seed(url, tracker(url, `<${NS.WF}issueClass> <${NS.WF}Task>`));
    expect(store.isOpenedTracker(url)).toBe(false);
    expect(await store.openTracker(url)).toEqual([url]);
    expect(store.isOpenedTracker(url)).toBe(true);
    expect(store.isOpenedTracker(trackerUrl)).toBe(false);
  });
});
describe("containment (F8)", () => {
  it.each([
    [`${containerUrl}a.ttl`, true],
    [`${containerUrl}a.ttl#it`, false],
    [`${containerUrl}a.ttl?x=1`, false],
    [`${containerUrl}a%2Fb.ttl`, false],
    [`${containerUrl}a%5Cb.ttl`, false],
    [`${containerUrl}%2e%2e/a.ttl`, false],
    [`${containerUrl}sub/a.ttl`, true],
    ["https://pod.test/alice/issue-tracker/issues-evil/a.ttl", false],
    ["https://user@pod.test/alice/issue-tracker/issues/a.ttl", false],
    ["http://pod.test/alice/issue-tracker/issues/a.ttl", false],
  ])("inside(%s)", (url, expected) => {
    expect(inside(url, containerUrl)).toBe(expected);
  });
  it("accepts only direct .ttl children as issue members", () => {
    expect(isIssueMember(`${containerUrl}a.ttl`, containerUrl)).toBe(true);
    expect(isIssueMember(`${containerUrl}sub/a.ttl`, containerUrl)).toBe(false);
    expect(isIssueMember(`${containerUrl}a.txt`, containerUrl)).toBe(false);
    expect(isIssueMember(`${containerUrl}.ttl`, containerUrl)).toBe(false);
  });
  it("ignores nested documents when listing issues", async () => {
    const { store, pod, project } = await issuesFixture();
    pod.seed(
      `${containerUrl}sub/n.ttl`,
      `<#it> a <${NS.WF}Task>, <${NS.WF}Open>; <${NS.DCT}title> "Nested"; <${NS.WF}tracker> <${trackerUrl}#this>.`,
    );
    pod.seed(containerUrl, `<${containerUrl}> <${NS.LDP}contains> <${containerUrl}sub/n.ttl>.`);
    expect(await store.listTasks(project.tracker.stateStore as string)).toEqual([]);
  });
});
describe("legacy subjects (F9, F10)", () => {
  it("prefers #it, then #this, whatever the order in the document", async () => {
    const { store, pod } = await issuesFixture();
    const both = `${containerUrl}both.ttl`;
    pod.seed(
      both,
      `<#this> a <${NS.WF}Task>; <${NS.DCT}title> "Old". <#a> a <${NS.WF}Task>; <${NS.DCT}title> "A". <#it> a <${NS.WF}Task>; <${NS.DCT}title> "New".`,
    );
    expect((await store.readTask(both)).task.id).toBe(`${both}#it`);
    const legacy = `${containerUrl}legacy.ttl`;
    pod.seed(
      legacy,
      `<#a> a <${NS.WF}Task>; <${NS.DCT}title> "A". <#this> a <${NS.WF}Task>; <${NS.DCT}title> "Old".`,
    );
    expect((await store.readTask(legacy)).task.id).toBe(`${legacy}#this`);
  });
  it("does not throw reading priority for a non-http wf:tracker", () => {
    const dataset = new Store();
    const task = new IssueItem("https://pod.test/i.ttl#it", dataset, DataFactory);
    node(task.id, dataset).setIri(`${NS.WF}tracker`, "mailto:a@example.org");
    expect(() => task.priority).not.toThrow();
    expect(() => {
      task.priority = "high";
    }).not.toThrow();
  });
});
describe("listProjects honours the base contract (F3)", () => {
  it("skips Issues discovery for a collection read", async () => {
    const { store } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    const collection = new URL("./", inbox.url).href;
    const listed = await store.listProjects(undefined, { collection });
    expect(listed.map((project) => project.url)).toEqual([inbox.url]);
  });
  it("fails closed in strict mode when the Type Index is unreadable", async () => {
    const { store, pod } = await issuesFixture();
    await store.bootstrapInbox();
    pod.intercept = (request) =>
      request.url.includes("Index") ? new Response(null, { status: 500 }) : undefined;
    await expect(store.listProjects(undefined, { strict: true })).rejects.toBeDefined();
    await expect(store.listProjects()).resolves.toBeDefined();
  });
  it("tolerates a missing conventional tracker in strict mode", async () => {
    const { store, pod } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    pod.files.delete(trackerUrl);
    const listed = await store.listProjects(undefined, { strict: true });
    expect(listed.map((project) => project.url)).toEqual([inbox.url]);
  });
});
