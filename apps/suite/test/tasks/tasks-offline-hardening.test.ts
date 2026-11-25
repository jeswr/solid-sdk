// AUTHORED-BY Claude Sonnet 5.5
import { expect, it } from "vitest";
import {
  clearTasksCache,
  purgeStaleTasksCaches,
  TASKS_REPLAY,
  TasksOffline,
} from "../../src/apps/tasks/state/offline";
import { storage, webId } from "./pod";
import { setupOffline as setup } from "./tasks-offline-fixtures";

const cacheKey = `suite.tasks.cache.v1.${webId}\u0000${storage}`;

it("replays a queued move through per-delivery instances that share the session's applied record", async () => {
  const f = await setup(false);
  // Registered the way offline-session.tsx does: a new instance for every delivery.
  f.outbox.registerDelegate(TASKS_REPLAY, async (delivery, ctx) => {
    const replay = new TasksOffline({
      ...f.offlineOptions,
      storage: undefined,
      online: () => true,
      onConfirm: f.offline.confirm,
      onSettled: f.offline.settled,
      baseEtag: f.offline.baseEtag,
      onApplied: f.offline.markApplied,
      wasApplied: f.offline.wasApplied,
    });
    return replay.replay(delivery, ctx);
  });
  const target = await f.cache.createProject("Home");
  if (!target) throw new Error("Missing target");
  await f.cache.loadTasks(target);
  const task = await f.cache.createTask(f.inbox, { title: "Travelling" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  const moved = await f.cache.moveTaskToProject(task, target);
  if (!moved) throw new Error("Missing moved task");
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect(f.pod.files.has(task.url)).toBe(false);
  expect((await f.remote.readTask(moved.url)).task.title).toBe("Travelling");
  expect(
    JSON.parse(f.offlineOptions.storage.getItem(cacheKey) ?? "{}").applied.length,
  ).toBeGreaterThan(0);
});

it("refuses to delete a project while offline before queueing anything", async () => {
  const f = await setup();
  const project = await f.cache.createProject("Doomed");
  if (!project) throw new Error("Missing project");
  await f.cache.loadTasks(project);
  await f.cache.createTask(project, { title: "Keep me" });
  f.connect(false);
  const mutations = f.pod.mutations().length;
  await expect(f.store.deleteProject(project)).rejects.toThrow("Reconnect to delete this project");
  expect(f.outbox.pending()).toEqual([]);
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.pod.mutations()).toHaveLength(mutations);
});

it("clears one account's cache, and stale accounts' caches, without Tasks mounted", () => {
  const values = new Map<string, string>([
    [cacheKey, "{}"],
    [`suite.tasks.cache.v1.https://other.test/bob#me\u0000https://other.test/`, "{}"],
    ["unrelated", "keep"],
  ]);
  const store = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
  };
  purgeStaleTasksCaches([webId], store);
  expect([...values.keys()]).toEqual([cacheKey, "unrelated"]);
  clearTasksCache(webId, storage, store);
  expect([...values.keys()]).toEqual(["unrelated"]);
});

it("does not cache a document over the per-document cap and passes it through", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Big" });
  if (!task) throw new Error("Missing task");
  const huge = `# ${"x".repeat(1024 * 1024 + 10)}\n${f.pod.files.get(task.url)?.body}`;
  f.pod.intercept = (request) =>
    request.url === task.url && request.method === "GET"
      ? new Response(huge, { headers: { "Content-Type": "text/turtle", ETag: '"big"' } })
      : undefined;
  const response = await f.offline.fetch(task.url);
  expect((await response.text()).length).toBe(huge.length);
  const stored = f.offlineOptions.storage.getItem(cacheKey) ?? "";
  expect(stored.length).toBeLessThan(huge.length);
  f.pod.intercept = undefined;
  f.connect(false);
  await expect(f.offline.fetch(task.url)).rejects.toThrow();
});

it("evicts cached children when their container answers 403", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Shared" });
  if (!task) throw new Error("Missing task");
  const container = new URL(".", task.url).href;
  expect((await f.offline.fetch(task.url)).status).toBe(200);
  f.pod.intercept = (request) =>
    request.url === container ? new Response(null, { status: 403 }) : undefined;
  expect((await f.offline.fetch(container)).status).toBe(403);
  f.pod.intercept = undefined;
  f.connect(false);
  await expect(f.offline.fetch(task.url)).rejects.toThrow();
});

it("stops serving a local copy once its only queue entry has permanently failed", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Original" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.updateTask(task, (value) => {
    value.title = "Local";
  });
  f.connect(true);
  f.pod.intercept = (request) =>
    request.url === task.url && request.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined;
  await f.adapter.reconnected();
  expect(f.outbox.pending().map((item) => item.status)).toEqual(["failed"]);
  f.pod.intercept = undefined;
  const response = await f.offline.fetch(task.url);
  expect(await response.text()).toContain("Original");
});

it("refuses to queue a tracker change to nesting that replay cannot merge", async () => {
  const f = await setup();
  const project = await f.cache.createProject("Child");
  if (!project) throw new Error("Missing project");
  const fresh = await f.store.readProject(project.url);
  f.connect(false);
  await expect(
    f.store.updateProject(fresh, (tracker) => {
      tracker.parent = `${storage}tasks/projects/inbox.ttl`;
    }),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining("Reconnect to change") } });
  expect(f.outbox.pending()).toEqual([]);
});
