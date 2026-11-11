// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { allowsWrite, discoverIssues, inside } from "../../src/apps/tasks/lib/issues/discovery";
import { isIssuesProject } from "../../src/apps/tasks/lib/issues/model";
import { NS, node, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TypeIndex } from "../../src/apps/tasks/lib/model/type-index";
import { storage, webId } from "./pod";
import { containerUrl, issuesFixture, trackerUrl } from "./tasks-issues-fixtures";

describe("Issues discovery", () => {
  it("distinguishes a .ttl WebID from an extensionless tracker by its RDF", async () => {
    const { store, pod } = await issuesFixture();
    const foreign = "https://foreign.example/";
    const target = `${foreign}projects/tracker`;
    const person = `${foreign}profile.ttl#me`;
    pod.seed(
      `${foreign}profile.ttl`,
      `<${person}> <${NS.PIM}storage> <${foreign}>; <${NS.SOLID}publicTypeIndex> <${foreign}index.ttl>.`,
    );
    pod.seed(
      `${foreign}index.ttl`,
      `<#entry> a <${NS.SOLID}TypeRegistration>; <${NS.SOLID}forClass> <${NS.WF}Tracker>; <${NS.SOLID}instance> <${target}>.`,
    );
    pod.seed(
      target,
      `<#this> a <${NS.WF}Tracker>; <${NS.WF}issueClass> <${NS.WF}Task>; <${NS.DCT}title> "Foreign issues".`,
    );
    expect(await store.openTracker(person)).toContain(target);
    expect(await store.openTracker(target)).toEqual([target]);
  });
  it("merges public/private registrations and the fallback without duplicates", async () => {
    const { store, pod } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    const index = new TypeIndex(store.issuesIO, storage, webId, pod.ensurePrivateIndexAccess);
    await index.register([{ forClass: `${NS.WF}Tracker`, location: trackerUrl, kind: "instance" }]);
    const profile = await store.issuesIO.read(`${storage}profile/card`);
    const publicIndex = `${storage}public.ttl`;
    node(webId, profile.dataset).setIri(`${NS.SOLID}publicTypeIndex`, publicIndex);
    pod.seed(profile.url, await serialize(profile.dataset));
    const data = new Store();
    for (const [id, url, valid] of [
      ["one", trackerUrl, true],
      ["two", `${trackerUrl}#this`, true],
      ["bad", "https://attacker.example/tracker.ttl", true],
      ["untyped", `${storage}ignore.ttl`, false],
    ] as const) {
      const reg = node(`${publicIndex}#${id}`, data);
      if (valid) reg.types.add(`${NS.SOLID}TypeRegistration`);
      reg.setIri(`${NS.SOLID}forClass`, `${NS.WF}Tracker`);
      reg.setIri(`${NS.SOLID}instance`, url);
    }
    pod.seed(publicIndex, await serialize(data));
    expect(await discoverIssues(webId, store.issuesIO, storage)).toEqual([trackerUrl]);
    const projects = await store.listProjects();
    expect(projects.map((project) => project.url).sort()).toEqual([inbox.url, trackerUrl].sort());
    expect(projects.filter(isIssuesProject)).toHaveLength(1);
    expect(pod.requests.some((request) => request.url.startsWith("https://attacker.example"))).toBe(
      false,
    );
  });
  it("uses the fallback when the profile or public index cannot be read", async () => {
    const { store, pod } = await issuesFixture();
    pod.intercept = (request) =>
      request.url === `${storage}profile/card` ? new Response(null, { status: 403 }) : undefined;
    expect(await discoverIssues(webId, store.issuesIO, storage)).toEqual([trackerUrl]);
    expect((await store.listProjects()).map((project) => project.url)).toEqual([trackerUrl]);
    expect(await discoverIssues("https://missing.example/#me", store.issuesIO)).toEqual([]);
  });
  it("opens a foreign tracker by URL or WebID, including a conventional fallback", async () => {
    const { store, pod } = await issuesFixture();
    const foreign = "https://bob.example/";
    const target = `${foreign}issue-tracker/tracker.ttl`;
    pod.seed(`${foreign}profile`, `<${foreign}profile#me> <${NS.PIM}storage> <${foreign}>.`);
    pod.seed(target, pod.files.get(trackerUrl)?.body ?? "");
    // Resolve relative subjects against the foreign document, as the standalone app does.
    pod.seed(
      target,
      `<${target}#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Bob"; <${NS.WF}issueClass> <${NS.WF}Task>.`,
    );
    expect(await store.openTracker(`${foreign}profile#me`)).toEqual([target]);
    expect(await store.openTracker(`${target}#this`)).toEqual([target]);
    expect((await store.listProjects()).some((project) => project.url === target)).toBe(true);
    await expect(store.openTracker("https://missing.example/profile")).rejects.toMatchObject({
      status: 404,
    });
    await expect(store.openTracker("bad-url")).rejects.toThrow();
  });
  it("isolates one failed tracker from healthy Tasks projects", async () => {
    const { store, pod } = await issuesFixture();
    const inbox = await store.bootstrapInbox();
    pod.intercept = (request) =>
      request.url === trackerUrl ? new Response(null, { status: 503 }) : undefined;
    const failed = vi.fn();
    expect((await store.listProjects(failed)).map((project) => project.url)).toEqual([inbox.url]);
    expect(failed).toHaveBeenCalledWith(trackerUrl, expect.objectContaining({ status: 503 }));
  });
  it("reads WAC-Allow separately for container creation, config and per-issue editing", async () => {
    const { store, pod, project } = await issuesFixture();
    pod.intercept = (request) =>
      request.url === containerUrl
        ? new Response(`<${containerUrl}> a <${NS.LDP}BasicContainer>.`, {
            headers: { "Content-Type": "text/turtle", "WAC-Allow": 'user="read", public="read"' },
          })
        : undefined;
    await store.listTasks(containerUrl);
    expect(store.canEdit(project)).toBe(false);
    expect(store.canCreate(project)).toBe(false);
    await expect(store.createTask(project, { title: "No", state: "open" })).rejects.toMatchObject({
      status: 403,
    });
  });
  it.each([
    [null, false, true],
    ['user="read write"', false, true],
    ['USER="READ WRITE"', false, true],
    ['user="read append"', true, true],
    ['user="read append"', false, false],
    ['public="write"', false, false],
    ['user="read"', false, false],
    ["", false, false],
  ] as const)("interprets %s for append=%s", (header, append, expected) =>
    expect(allowsWrite(header, append)).toBe(expected));
  it.each([
    [containerUrl, storage, true],
    ["https://pod.test/alice-other/x", storage, false],
    ["https://pod.test@evil.example/alice/x", storage, false],
    ["javascript:alert(1)", storage, false],
    ["invalid", storage, false],
    [`${containerUrl}?other`, storage, false],
  ])("validates containment of %s", (url, root, expected) =>
    expect(inside(String(url), String(root))).toBe(expected));
});
