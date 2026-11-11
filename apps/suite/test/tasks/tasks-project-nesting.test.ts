// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import {
  canMoveProject,
  projectBreadcrumb,
  projectDescendants,
  projectHierarchy,
  storedProjectDescendants,
} from "../../src/apps/tasks/lib/projects/tree";
import {
  defaultPreferences,
  parsePreferences,
  preferencesReducer,
} from "../../src/apps/tasks/state/preferences-reducer";
import { now } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";
import { project } from "./tasks-views-fixtures";

it("projects a depth-first tree, breadcrumbs and descendants without changing RDF", () => {
  const [work, clients, acme, other] = [
    project("Work"),
    project("Clients"),
    project("Acme"),
    project("Other"),
  ] as const;
  clients.tracker.parent = work.tracker.id;
  acme.tracker.parent = clients.tracker.id;
  const tree = projectHierarchy([acme, other, work, clients]);
  expect(tree.map((node) => [node.project.tracker.title, node.depth])).toEqual([
    ["Other", 1],
    ["Work", 1],
    ["Clients", 2],
    ["Acme", 3],
  ]);
  expect(projectBreadcrumb(tree, acme.url)).toEqual([work, clients, acme]);
  expect(projectBreadcrumb(tree, "missing")).toEqual([]);
  expect(projectDescendants(tree, work.url).map((node) => node.project)).toEqual([clients, acme]);
  expect(projectDescendants(tree, "missing")).toEqual([]);
});

it("renders dangling, archived, unreadable, foreign-pod and cyclic ancestry at top level", () => {
  const [a, b, c] = [project("A"), project("B"), project("C")] as const;
  a.tracker.parent = b.tracker.id;
  b.tracker.parent = a.tracker.id;
  c.tracker.parent = b.tracker.id;
  expect(projectHierarchy([a, b, c]).every((node) => node.depth === 1)).toBe(true);
  a.tracker.parent = a.tracker.id;
  expect(projectHierarchy([a])[0]?.depth).toBe(1);
  a.tracker.parent = b.tracker.id;
  b.tracker.parent = undefined;
  expect(projectHierarchy([a])[0]?.depth).toBe(1);
  b.tracker.archivedAt = now;
  expect(projectHierarchy([a, b]).map((node) => node.project)).toEqual([a]);
  b.tracker.archivedAt = undefined;
  expect(projectHierarchy([a, b], [b.url]).every((node) => node.depth === 1)).toBe(true);
  expect(projectHierarchy([a, b], [a.url])[0]?.depth).toBe(1);
  const foreign = { ...b, url: "https://pod.test/bob/b.ttl" };
  expect(projectHierarchy([a, foreign]).every((node) => node.depth === 1)).toBe(true);
});

it("enforces three levels for a whole moved subtree and safely projects over-depth RDF", () => {
  const [a, b, c, d] = [project("A"), project("B"), project("C"), project("D")] as const;
  b.tracker.parent = a.tracker.id;
  c.tracker.parent = b.tracker.id;
  d.tracker.parent = c.tracker.id;
  expect(projectHierarchy([a, b, c, d]).find((node) => node.project === d)?.depth).toBe(1);
  d.tracker.parent = undefined;
  const tree = projectHierarchy([a, b, c, d]);
  expect(canMoveProject(tree, "missing", a.url)).toBe(false);
  expect(canMoveProject(tree, a.url, undefined)).toBe(true);
  expect(canMoveProject(tree, a.url, "missing")).toBe(false);
  expect(canMoveProject(tree, a.url, a.url)).toBe(false);
  expect(canMoveProject(tree, a.url, c.url)).toBe(false);
  expect(canMoveProject(tree, a.url, d.url)).toBe(false);
  expect(canMoveProject(tree, b.url, d.url)).toBe(true);
  expect(canMoveProject(tree, d.url, b.url)).toBe(true);
  expect(canMoveProject(tree, d.url, c.url)).toBe(false);
  expect(canMoveProject(projectHierarchy([a, d], [a.url]), d.url, a.url)).toBe(false);
  expect(canMoveProject(projectHierarchy([a], [a.url]), a.url, undefined)).toBe(false);
  expect(
    canMoveProject(
      projectHierarchy([a, { ...d, url: "https://foreign.test/d.ttl" }]),
      a.url,
      "https://foreign.test/d.ttl",
    ),
  ).toBe(false);
});

it("validates stored ancestry and subtree height even when display edges are hidden", () => {
  const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((name) => project(name));
  if (!a || !b || !c || !d || !e) throw new Error("Missing projects");
  b.tracker.parent = a.tracker.id;
  c.tracker.parent = b.tracker.id;
  d.tracker.parent = c.tracker.id;
  const tree = projectHierarchy([a, b, c, d, e]);
  expect(tree.find((node) => node.project === d)?.parentUrl).toBeUndefined();
  expect(canMoveProject(tree, c.url, d.url)).toBe(false);
  expect(canMoveProject(tree, a.url, e.url)).toBe(false);
  expect(canMoveProject(tree, a.url, undefined)).toBe(false);
  expect(canMoveProject(tree, e.url, d.url)).toBe(false);
  expect(canMoveProject(tree, c.url, undefined)).toBe(true);
});

it("bounds stored cycles and breaks dangling or foreign parent chains", () => {
  const [a, b, c] = [project("A"), project("B"), project("C")] as const;
  a.tracker.parent = b.tracker.id;
  b.tracker.parent = a.tracker.id;
  expect(canMoveProject(projectHierarchy([a, b, c]), c.url, a.url)).toBe(false);
  expect(
    storedProjectDescendants(projectHierarchy([a, b]), a.url).map((node) => node.project),
  ).toEqual([b]);
  expect(canMoveProject(projectHierarchy([a, b]), a.url, undefined)).toBe(true);
  a.tracker.parent = "https://unknown.test/project.ttl#this";
  expect(canMoveProject(projectHierarchy([a, c]), c.url, a.url)).toBe(true);
  a.tracker.parent = b.tracker.id;
  const foreign = { ...b, url: "https://foreign.test/b.ttl" };
  expect(canMoveProject(projectHierarchy([a, foreign, c]), c.url, a.url)).toBe(true);
});

async function family() {
  const setup = await frameCache();
  const a = await setup.cache.createProject("Work");
  const b = await setup.cache.createProject("Clients");
  const c = await setup.cache.createProject("Acme");
  const d = await setup.cache.createProject("Other");
  if (!a || !b || !c || !d) throw new Error("Missing projects");
  await setup.cache.setProjectParent(b, a.url);
  await setup.cache.setProjectParent(c, b.url);
  return { ...setup, a, b, c, d };
}

it("round-trips parent tracker triples through conditional writes and clears the link", async () => {
  const { cache, store, pod, a, b } = await family();
  const saved = await store.readProject(b.url);
  expect(saved.tracker.parent).toBe(a.tracker.id);
  expect(node(saved.tracker.id, await pod.dataset(b.url)).iri(`${NS.DCT}isPartOf`)).toBe(
    a.tracker.id,
  );
  const before = pod.requests.length;
  await cache.setProjectParent(saved, undefined);
  const write = pod.requests.slice(before).find((request) => request.method === "PUT");
  expect(write?.headers.get("If-Match")).toBe(saved.etag);
  expect((await store.readProject(b.url)).tracker.parent).toBeUndefined();
  expect(() => {
    saved.tracker.parent = "file:///bad";
  }).toThrow();
});

it("rejects cycles, foreign moves and excessive subtree depth before writing", async () => {
  const { cache, pod, a, b, c, d } = await family();
  const before = pod.mutations().length;
  for (const [source, parent] of [
    [a, c.url],
    [a, d.url],
    [d, c.url],
    [b, "https://foreign.test/p.ttl"],
  ] as const)
    expect(() => cache.setProjectParent(source, parent)).toThrow(TypeError);
  expect(pod.mutations()).toHaveLength(before);
});

it("keeps reorder writes within the effective sibling group", async () => {
  const { cache, pod, a, b, c, d } = await family();
  await cache.setProjectParent(d, a.url);
  const before = pod.requests.length;
  await cache.moveProject(d, "up");
  expect(
    pod.requests
      .slice(before)
      .filter((request) => request.method === "PUT")
      .map((request) => request.url)
      .sort(),
  ).toEqual([d.url]);
  expect(cache.projectTree.map((node) => node.project.url)).toEqual([a.url, d.url, b.url, c.url]);
});

it.each([
  "archive",
  "delete",
] as const)("%s can promote direct children while retaining their subtree", async (kind) => {
  const { cache, store, pod, a, b, c } = await family();
  expect(
    await (kind === "archive"
      ? cache.archiveProject(a, "promote")
      : cache.deleteProject(a, "promote")),
  ).toBe(true);
  expect((await store.readProject(b.url)).tracker.parent).toBeUndefined();
  expect((await store.readProject(c.url)).tracker.parent).toBe(b.tracker.id);
  expect(cache.projectTree.find((node) => node.project.url === c.url)?.depth).toBe(2);
  expect(
    kind === "archive"
      ? Boolean((await store.readProject(a.url)).tracker.archivedAt)
      : !pod.files.has(a.url),
  ).toBe(true);
});

it.each(["archive", "delete"] as const)("%s can cascade through every descendant", async (kind) => {
  const { cache, store, pod, a, b, c, d } = await family();
  const task = await cache.createTask(c, { title: "Nested task" });
  if (!task) throw new Error("Missing task");
  await (kind === "archive"
    ? cache.archiveProject(a, "cascade")
    : cache.deleteProject(a, "cascade"));
  for (const item of [a, b, c]) {
    expect(cache.projectTree.some((node) => node.project.url === item.url)).toBe(false);
    if (kind === "archive")
      expect((await store.readProject(item.url)).tracker.archivedAt).toBeTruthy();
    else expect(pod.files.has(item.url)).toBe(false);
  }
  expect(pod.files.has(task.url)).toBe(kind === "archive");
  expect(pod.files.has(d.url)).toBe(true);
});

it.each([
  "archive",
  "delete",
] as const)("stops %s before removing the parent when a child write fails, then retries", async (kind) => {
  const { cache, store, pod, failures, a, b, c } = await family();
  pod.intercept = (request) =>
    request.url === c.url && request.method === "PUT"
      ? new Response(null, { status: 412 })
      : undefined;
  expect(
    await (kind === "archive"
      ? cache.archiveProject(a, "cascade")
      : cache.deleteProject(a, "cascade")),
  ).toBeUndefined();
  expect((await store.readProject(a.url)).tracker.archivedAt).toBeUndefined();
  expect((await store.readProject(b.url)).tracker.archivedAt).toBeUndefined();
  pod.intercept = undefined;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(cache.projectTree.some((node) => node.project.url === a.url)).toBe(false);
});

it("rolls back a conflicting move without discarding the remote tracker", async () => {
  const { cache, store, pod, failures, a, b, d } = await family();
  const remote = await store.readProject(b.url);
  remote.tracker.description = "Edited elsewhere";
  pod.seed(b.url, await serialize(remote.dataset));
  expect(await cache.setProjectParent(b, d.url)).toBeUndefined();
  expect(cache.projectTree.find((node) => node.project.url === b.url)?.parentUrl).toBe(a.url);
  expect(
    cache.getSnapshot().projects.find((project) => project.url === b.url)?.tracker.description,
  ).toBe("Edited elsewhere");
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect((await store.readProject(b.url)).tracker.parent).toBe(d.tracker.id);
});

it.each([
  "archive",
  "delete",
] as const)("reconfirms a changed %s scope after a conflict instead of deleting a moved family on Retry", async (kind) => {
  const { cache, store, pod, failures, a, b, c, d } = await family();
  const task = await cache.createTask(c, { title: "Keep with Clients" });
  if (!task) throw new Error("Missing task");
  let conflicted = false;
  pod.intercept = async (request) => {
    if (request.url !== c.url || request.method !== "PUT" || conflicted) return;
    conflicted = true;
    const remote = await store.readProject(b.url);
    remote.tracker.parent = d.tracker.id;
    pod.seed(b.url, await serialize(remote.dataset));
    return new Response(null, { status: 412 });
  };
  await (kind === "archive"
    ? cache.archiveProject(a, "cascade")
    : cache.deleteProject(a, "cascade"));
  pod.intercept = undefined;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(pod.files.has(b.url)).toBe(true);
  expect(pod.files.has(c.url)).toBe(true);
  expect(pod.files.has(task.url)).toBe(true);
  expect((await store.readProject(b.url)).tracker.archivedAt).toBeUndefined();
  expect(cache.getSnapshot()).toMatchObject({
    projectFamilyConfirmation: { project: { url: a.url }, kind, projects: [] },
  });
});

it.each([
  "archive",
  "delete",
] as const)("blocks %s retries until parent re-reads succeed", async (kind) => {
  const { cache, store, pod, failures, a, b, c, d } = await family();
  const task = await cache.createTask(c, { title: "Keep me" });
  if (!task) throw new Error("Missing task");
  let blocked = false;
  pod.intercept = async (request) => {
    if (blocked && request.url === b.url && request.method === "GET")
      return new Response(null, { status: 503 });
    if (request.url === c.url && request.method === "PUT") {
      const remote = await store.readProject(b.url);
      remote.tracker.parent = d.tracker.id;
      pod.seed(b.url, await serialize(remote.dataset));
      blocked = true;
      return new Response(null, { status: 412 });
    }
  };
  await (kind === "archive"
    ? cache.archiveProject(a, "cascade")
    : cache.deleteProject(a, "cascade"));
  expect(failures).toHaveBeenCalledTimes(1);
  const before = pod.mutations().length;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(failures).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(pod.mutations()).toHaveLength(before);
  expect(cache.getSnapshot().projectFamilyConfirmation).toBeUndefined();
  pod.intercept = undefined;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(pod.mutations()).toHaveLength(before);
  expect(cache.getSnapshot().projectFamilyConfirmation?.projects).toEqual([]);
  expect(pod.files.has(task.url)).toBe(true);
});

it.each([
  "archive",
  "delete",
] as const)("recomputes the remaining %s plan after partial success", async (kind) => {
  const { cache, store, pod, failures, a, b, c } = await family();
  let failed = false;
  pod.intercept = (request) => {
    if (!failed && request.url === b.url && request.method === "PUT") {
      failed = true;
      return new Response(null, { status: 412 });
    }
  };
  await (kind === "archive"
    ? cache.archiveProject(a, "cascade")
    : cache.deleteProject(a, "cascade"));
  expect(
    kind === "archive"
      ? (await store.readProject(c.url)).tracker.archivedAt
      : !pod.files.has(c.url),
  ).toBeTruthy();
  expect(cache.getSnapshot().projectFamilyConfirmation).toBeUndefined();
  const before = pod.requests.length;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(cache.projectTree.some((node) => node.project.url === a.url)).toBe(false);
  expect(
    pod.requests
      .slice(before)
      .filter((request) => request.method !== "GET")
      .every((request) => request.url !== c.url),
  ).toBe(true);
});

it.each([
  "archive",
  "delete",
] as const)("uses fresh conditional tracker writes when a %s retry keeps the same scope", async (kind) => {
  const { cache, store, pod, failures, a, b, c } = await family();
  let conflicted = false;
  pod.intercept = async (request) => {
    if (conflicted || request.url !== c.url || request.method !== "PUT") return;
    conflicted = true;
    for (const project of [b, c]) {
      const remote = await store.readProject(project.url);
      remote.tracker.description = "Changed elsewhere";
      pod.seed(project.url, await serialize(remote.dataset));
    }
    return new Response(null, { status: 412 });
  };
  await (kind === "archive"
    ? cache.archiveProject(a, "cascade")
    : cache.deleteProject(a, "cascade"));
  const etags = new Map(
    await Promise.all(
      [b, c].map(
        async (project) => [project.url, (await store.readProject(project.url)).etag] as const,
      ),
    ),
  );
  pod.intercept = undefined;
  const before = pod.requests.length;
  failures.mock.lastCall?.[1]();
  await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
  expect(cache.getSnapshot().projectFamilyConfirmation).toBeUndefined();
  for (const project of [b, c]) {
    const write = pod.requests
      .slice(before)
      .find((request) => request.url === project.url && request.method === "PUT");
    expect(write?.headers.get("If-Match")).toBe(etags.get(project.url));
  }
});

it("persists expanded state and tolerates malformed local preferences", () => {
  const collapsed = preferencesReducer(defaultPreferences, {
    type: "collapseProject",
    url: "work",
  });
  expect(parsePreferences(JSON.stringify(collapsed)).collapsedProjects).toEqual(["work"]);
  expect(
    preferencesReducer(collapsed, { type: "collapseProject", url: "work" }).collapsedProjects,
  ).toEqual([]);
  expect(parsePreferences('{"collapsedProjects":["work",2]}').collapsedProjects).toEqual(["work"]);
  expect(parsePreferences('{"collapsedProjects":false}').collapsedProjects).toEqual([]);
});
