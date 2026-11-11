// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox } from "@jeswr/suite-sdk/offline";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { DelayedDeletes } from "../../src/apps/tasks/state/delayed-delete";
import { OfflineTaskStore, TASKS_REPLAY, TasksOffline } from "../../src/apps/tasks/state/offline";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { createRealOutbox } from "../../src/shell/lib/real-outbox";
import { now, Pod, storage, webId } from "./pod";

const { IDBFactory } = createRequire(
  new URL("../../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  vi.restoreAllMocks();
});
async function setup() {
  const pod = new Pod();
  let online = true;
  const outbox = createOutbox({ webId, idb: new IDBFactory() });
  cleanups.push(() => outbox.close());
  await outbox.ready;
  const values = new Map<string, string>();
  const cacheStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const transport: typeof fetch = (input, init) => {
    if (!online) return Promise.reject(new TypeError("Offline"));
    return pod.fetch(input, init);
  };
  const offlineOptions = {
    webId,
    storageUrl: storage,
    fetch: transport,
    online: () => online,
    outbox: () => outbox,
    storage: cacheStorage,
  };
  const offline = new TasksOffline(offlineOptions);
  outbox.registerDelegate(TASKS_REPLAY, offline.replay);
  const storeOptions = {
    storage,
    webId,
    fetch: offline.fetch,
    now: () => now,
    typeIndex: false,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
  };
  const store = new OfflineTaskStore(storeOptions, () => online);
  const remote = new TaskStore({ ...storeOptions, fetch: pod.fetch });
  const failures = vi.fn();
  const cache = new TasksCache(store, failures, webId);
  offline.subscribeReceipts(cache.confirmOfflineWrite);
  await cache.start();
  const inbox = cache.getSnapshot().projects[0];
  if (!inbox) throw new Error("Missing Inbox");
  await cache.loadTasks(inbox);
  const raw = createMemoryStorage({ root: storage });
  vi.spyOn(raw, "head").mockImplementation(async (url) => {
    const response = await pod.fetch(url);
    return { url, etag: response.headers.get("ETag") } as Awaited<
      ReturnType<StorageClient["head"]>
    >;
  });
  const adapter = createRealOutbox({
    outbox,
    storage: () => raw,
    signal: new AbortController().signal,
  });
  cleanups.push(() => adapter.dispose());
  return {
    pod,
    cache,
    store,
    inbox,
    outbox,
    failures,
    offline,
    offlineOptions,
    storeOptions,
    adapter,
    raw,
    remote,
    connect: (next: boolean) => {
      online = next;
    },
  };
}

describe("Tasks uses the shell's durable outbox", () => {
  it("queues create, edit, complete, reorder, move and title-only rename; preserves optimistic rows", async () => {
    const f = await setup();
    const target = await f.cache.createProject("Home");
    if (!target) throw new Error("Missing target");
    await f.cache.loadTasks(target);
    const task = await f.cache.createTask(f.inbox, { title: "Original" });
    if (!task) throw new Error("Missing task");
    const writes = f.pod.mutations().length;
    f.connect(false);
    const created = await f.cache.createTask(f.inbox, { title: "Offline" });
    if (!created) throw new Error("Missing offline task");
    expect(created.task.title).toBe("Offline");
    await f.cache.updateTask(task, (value) => {
      value.title = "Edited";
    });
    await f.cache.updateTask(task, (value) => {
      value.rank = 8;
    });
    await f.cache.completeTask(task, now);
    await f.cache.renameProject(target, "House");
    const moved = await f.cache.moveTaskToProject(created as NonNullable<typeof created>, target);
    if (!moved) throw new Error("Missing moved task");
    expect(moved.task.title).toBe("Offline");
    expect(f.pod.mutations()).toHaveLength(writes);
    expect(f.failures).not.toHaveBeenCalled();
    expect(f.outbox.pending().length).toBeGreaterThanOrEqual(7);
    expect(f.adapter.getSnapshot().pending).toHaveLength(f.outbox.pending().length);
    f.connect(true);
    await f.adapter.reconnected();
    expect(f.outbox.pending()).toEqual([]);
    expect((await f.remote.readTask(task.url)).task).toMatchObject({
      title: "Edited",
      state: "closed",
      rank: 8,
    });
    expect((await f.remote.readProject(target.url)).tracker.title).toBe("House");
    expect((await f.remote.readTask(moved.url)).task.title).toBe("Offline");
    expect(f.pod.files.has(created.url)).toBe(false);
  });

  it("re-applies intent on a compatible remote revision and serialises double reconnect", async () => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Original", description: "Before" });
    if (!task) throw new Error("Missing task");
    f.connect(false);
    await f.cache.updateTask(task, (value) => {
      value.description = "Local body";
    });
    await f.cache.updateTask(task, (value) => {
      value.rank = 8;
    });
    const changed = await f.remote.updateTask(task, (value) => {
      value.priority = "high";
    });
    f.connect(true);
    const writes = f.pod.mutations().length;
    await Promise.all([f.adapter.reconnected(), f.adapter.reconnected()]);
    expect(f.pod.mutations()).toHaveLength(writes + 2);
    expect(f.pod.mutations()[writes]?.headers.get("If-Match")).toBe(changed.etag);
    const result = await f.remote.readTask(task.url);
    expect(result.task).toMatchObject({ description: "Local body", priority: "high", rank: 8 });
    expect(f.outbox.pending()).toEqual([]);
  });

  it.each([
    "mine",
    "theirs",
    "both",
  ] as const)("resolves a changed title with Keep %s", async (choice) => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Original" });
    if (!task) throw new Error("Missing task");
    f.connect(false);
    await f.cache.updateTask(task, (value) => {
      value.title = "Local title";
      value.state = "closed";
    });
    const remote = await f.remote.updateTask(task, (value) => {
      value.title = "Remote title";
      value.priority = "high";
    });
    f.connect(true);
    await f.adapter.reconnected();
    const conflict = f.outbox.conflicts()[0];
    if (!conflict) throw new Error("Missing conflict");
    expect(f.adapter.getSnapshot().conflicts).toHaveLength(1);
    expect(await f.offline.conflictSummary(conflict.id)).toBe("Title changed elsewhere");
    await f.adapter.resolve(conflict.id, choice);
    expect(f.outbox.pending()).toEqual([]);
    const result = await f.remote.readTask(task.url);
    expect(result.task.title).toBe(choice === "mine" ? "Local title" : "Remote title");
    expect(result.task.priority).toBe("high");
    if (choice === "mine") {
      expect(result.task.state).toBe("closed");
      expect(f.pod.mutations().at(-1)?.headers.get("If-Match")).toBe(remote.etag);
    }
    if (choice === "both") {
      const tasks = await f.remote.listTasks(f.inbox.tracker.stateStore as string);
      expect(tasks.map((item) => item.task.title)).toContain("Local title (copy)");
      expect(f.pod.mutations().at(-1)?.headers.get("If-None-Match")).toBe("*");
    }
  });

  it("turns a racing conditional 412 into a retained conflict", async () => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Task" });
    if (!task) throw new Error("Missing task");
    f.connect(false);
    await f.cache.updateTask(task, (value) => {
      value.title = "Local";
    });
    f.connect(true);
    f.pod.intercept = (request) =>
      request.method === "PUT" && request.url === task.url
        ? new Response(null, { status: 412 })
        : undefined;
    await f.adapter.reconnected();
    expect(f.outbox.conflicts()).toHaveLength(1);
    const conflict = f.outbox.conflicts()[0];
    if (!conflict) throw new Error("Missing conflict");
    await expect(f.adapter.resolve(conflict.id, "mine")).rejects.toThrow();
    expect(f.outbox.conflicts()).toHaveLength(1);
  });

  it("retains failed replay and holds later intents, including dependent moves", async () => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Task" });
    if (!task) throw new Error("Missing task");
    f.connect(false);
    await f.cache.updateTask(task, (value) => {
      value.title = "First";
    });
    await f.cache.updateTask(task, (value) => {
      value.title = "Second";
    });
    f.connect(true);
    f.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 500 }) : undefined;
    const writes = f.pod.mutations().length;
    await f.adapter.reconnected();
    expect(f.pod.mutations()).toHaveLength(writes + 1);
    expect(f.outbox.pending().map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(f.adapter.getSnapshot().pending.every((item) => item.state === "failed")).toBe(true);
    f.pod.intercept = undefined;
    await f.adapter.retryAll();
    expect(f.outbox.pending()).toEqual([]);
    expect((await f.remote.readTask(task.url)).task.title).toBe("Second");
  });

  it("queues network failures without reverting, and leaves HTTP failures to normal rollback", async () => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Task" });
    if (!task) throw new Error("Missing task");
    f.pod.intercept = (request) => {
      if (request.method === "PUT") throw new TypeError("Lost connection");
      return undefined;
    };
    await f.cache.updateTask(task, (value) => {
      value.title = "Queued";
    });
    expect(f.outbox.pending()).toHaveLength(1);
    expect(f.cache.getSnapshot().views[0]?.title).toBe("Queued");
    expect(f.failures).not.toHaveBeenCalled();
    f.pod.intercept = undefined;
    await f.adapter.reconnected();
    f.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;
    await f.cache.updateTask(task, (value) => {
      value.title = "Rejected";
    });
    expect(f.outbox.pending()).toEqual([]);
    expect(f.cache.getSnapshot().views[0]?.title).toBe("Queued");
    expect(f.failures).toHaveBeenCalledOnce();
  });

  it("hydrates cached rows across reload while offline, including queued edits and date-like titles", async () => {
    const f = await setup();
    const task = await f.cache.createTask(f.inbox, { title: "Task", due: now });
    if (!task) throw new Error("Missing task");
    f.connect(false);
    await f.cache.updateTask(task, (value) => {
      value.title = "2026-11-01";
    });
    const offline = new TasksOffline(f.offlineOptions);
    const cache = new TasksCache(
      new OfflineTaskStore({ ...f.storeOptions, fetch: offline.fetch }, () => false),
      f.failures,
      webId,
    );
    await cache.start();
    await cache.loadTasks(f.inbox);
    expect(cache.getSnapshot().views[0]).toMatchObject({ title: "2026-11-01", due: now });
    const otherIdentity = new TasksOffline({ ...f.offlineOptions, webId: "https://bob.test/#me" });
    await expect(otherIdentity.fetch(f.inbox.url)).rejects.toThrow("Not available offline");
    expect(f.failures).not.toHaveBeenCalled();
  });
});

it("keeps the deletion undo window before enqueueing and replays its conditional DELETE", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Delete later" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  const deletes = new DelayedDeletes();
  const schedule = () =>
    deletes.schedule(
      task.url,
      () => f.cache.hideTask(task.url, true),
      () => {
        void f.cache.deleteTask(task);
      },
      () => f.cache.hideTask(task.url, false),
    );
  schedule();
  expect(f.cache.getSnapshot().views).toEqual([]);
  expect(f.outbox.pending()).toEqual([]);
  deletes.undo(task.url);
  expect(f.cache.getSnapshot().views[0]?.title).toBe("Delete later");
  expect(f.outbox.pending()).toEqual([]);
  schedule();
  deletes.finish(task.url);
  await vi.waitFor(() => expect(f.outbox.pending()).toHaveLength(1));
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.pod.files.has(task.url)).toBe(false);
  expect(f.outbox.pending()).toEqual([]);
  expect(f.pod.mutations().at(-1)?.headers.get("If-Match")).toBe(task.etag);
});

it("replays recurring completion and its undo without losing the next occurrence", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, {
    title: "Daily",
    due: now,
    recurrence: { frequency: "DAILY" },
  });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  const plan = await f.cache.completeTask(task, now);
  if (!plan) throw new Error("Missing completion");
  expect(f.outbox.pending()).toHaveLength(2);
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(task.url)).task.dueDate?.getTime()).toBeGreaterThan(
    now.getTime(),
  );
  // Reconcile validators exactly as the mounted Tasks provider does after a replay.
  await f.cache.invalidate(task.url);
  f.connect(false);
  await f.cache.undoCompletion(task, plan);
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(task.url)).task.dueDate).toEqual(now);
  expect(await f.remote.listTasks(f.inbox.tracker.stateStore as string)).toHaveLength(1);
});

it("replays section and label intents before the tasks that refer to them", async () => {
  const f = await setup();
  f.connect(false);
  const sectioned = await f.cache.addSection(f.inbox, "Doing");
  if (!sectioned) throw new Error("Missing section");
  const labelled = await f.cache.ensureLabels(sectioned, ["Bills"]);
  if (!labelled) throw new Error("Missing label");
  const section = labelled.tracker.sections[0];
  const label = labelled.tracker.labels[0];
  if (!section || !label) throw new Error("Missing classes");
  const task = await f.cache.createTask(labelled, {
    title: "Task",
    sectionId: section.id,
    labelIds: [label.id],
  });
  if (!task) throw new Error("Missing task");
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  const project = await f.remote.readProject(f.inbox.url);
  expect(project.tracker.sections[0]?.name).toBe("Doing");
  expect(project.tracker.labels[0]?.name).toBe("Bills");
  const stored = await f.remote.readTask(task.url);
  expect(stored.task.types.has(section.id)).toBe(true);
  expect(stored.task.types.has(label.id)).toBe(true);
});

it("refuses recurring undo when a replayed occurrence has since changed generation", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, {
    title: "Daily",
    due: now,
    recurrence: { frequency: "DAILY" },
  });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  const plan = await f.cache.completeTask(task, now);
  if (plan?.kind !== "advance" || !plan.copyUrl) throw new Error("Missing completion");
  f.connect(true);
  await f.adapter.reconnected();
  const copy = await f.remote.readTask(plan.copyUrl);
  await f.remote.updateTask(copy, () => {});
  await f.cache.invalidate(task.url);
  f.connect(false);
  expect(await f.cache.undoCompletion(task, plan)).toBeUndefined();
  expect(f.outbox.pending()).toEqual([]);
  expect(f.pod.files.has(copy.url)).toBe(true);
  expect((await f.remote.readTask(task.url)).task.dueDate?.getTime()).toBeGreaterThan(
    now.getTime(),
  );
});

it("keeps a network-failed replay waiting for reconnection", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Task" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.updateTask(task, (value) => {
    value.title = "Queued";
  });
  f.connect(true);
  f.pod.intercept = () => {
    throw new TypeError("Connection lost");
  };
  await f.adapter.reconnected();
  expect(f.outbox.pending().map((item) => item.status)).toEqual(["waiting"]);
  f.pod.intercept = undefined;
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(task.url)).task.title).toBe("Queued");
});

it("collision-checks Keep both copy names with create-only writes", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Task" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.updateTask(task, (value) => {
    value.title = "Mine";
  });
  await f.remote.updateTask(task, (value) => {
    value.title = "Theirs";
  });
  f.connect(true);
  await f.adapter.reconnected();
  const conflict = f.outbox.conflicts()[0];
  if (!conflict) throw new Error("Missing conflict");
  const attempts: string[] = [];
  f.pod.intercept = (request) => {
    if (request.method === "PUT" && request.headers.get("If-None-Match") === "*") {
      attempts.push(request.url);
      if (attempts.length === 1) return new Response(null, { status: 412 });
    }
    return undefined;
  };
  await f.adapter.resolve(conflict.id, "both");
  expect(attempts).toHaveLength(2);
  expect(new Set(attempts).size).toBe(2);
  expect(f.outbox.pending()).toEqual([]);
});

it("retains the document belonging to an older mutation validator during background reads", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Original", priority: "low" });
  if (!task) throw new Error("Missing task");
  await f.remote.updateTask(task, (value) => {
    value.priority = "high";
  });
  await f.store.readTask(task.url);
  // The cache's older generation still owns the user's edit.
  f.connect(false);
  await f.cache.updateTask(task, (value) => {
    value.title = "Local title";
  });
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(task.url)).task).toMatchObject({
    title: "Local title",
    priority: "high",
  });
});

it("resolves a queued create collision with Keep mine using the newly read validator", async () => {
  const f = await setup();
  f.connect(false);
  const task = await f.cache.createTask(f.inbox, { title: "Mine" });
  if (!task) throw new Error("Missing task");
  const id = task.url
    .split("/")
    .pop()
    ?.replace(/\.ttl$/, "");
  if (!id) throw new Error("Missing identifier");
  const occupied = await f.remote.createTask(f.inbox, { title: "Other", state: "open" }, id);
  f.connect(true);
  await f.adapter.reconnected();
  const conflict = f.outbox.conflicts()[0];
  if (!conflict) throw new Error("Missing conflict");
  await f.adapter.resolve(conflict.id, "mine");
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(task.url)).task.title).toBe("Mine");
  expect(f.pod.mutations().at(-1)?.headers.get("If-Match")).toBe(occupied.etag);
});

it("preserves the model's redirect rejection without caching the redirected document", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Original" });
  if (!task) throw new Error("Missing task");
  const contents = f.pod.files.get(task.url)?.body;
  if (!contents) throw new Error("Missing contents");
  f.pod.intercept = () => {
    const response = new Response(contents.replace('"Original"', '"Redirected"'), {
      headers: { "Content-Type": "text/turtle", ETag: '"redirect"' },
    });
    Object.defineProperty(response, "url", { value: `${storage}elsewhere.ttl` });
    return response;
  };
  await expect(f.store.readTask(task.url)).rejects.toThrow();
  f.connect(false);
  expect((await f.store.readTask(task.url)).task.title).toBe("Original");
});
