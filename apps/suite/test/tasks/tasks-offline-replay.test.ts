// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { DelayedDeletes } from "../../src/apps/tasks/state/delayed-delete";
import { OfflineTaskStore, TasksOffline } from "../../src/apps/tasks/state/offline";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { now, storage, webId } from "./pod";

import { setupOffline as setup } from "./tasks-offline-fixtures";

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

  it("retains failed replay and later edits to the same resource", async () => {
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

it("retries Keep both at the same create-only URL after a lost response", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Task" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.updateTask(task, (value) => {
    value.title = "Mine";
    value.created = undefined;
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
      if (attempts.length === 1) {
        f.pod.seed(request.url, request.body);
        throw new TypeError("Lost copy response");
      }
    }
    return undefined;
  };
  await expect(f.adapter.resolve(conflict.id, "both")).rejects.toThrow();
  await f.adapter.resolve(conflict.id, "both");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(new URL(`tasks-copy-${conflict.itemId}.ttl`, task.url).href);
  expect(new Set(attempts).size).toBe(1);
  expect(f.outbox.pending()).toEqual([]);
  expect(await f.remote.listTasks(f.inbox.tracker.stateStore as string)).toHaveLength(2);
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

it.each([
  "mine",
  "theirs",
] as const)("conflicts a queued delete after any remote change, then keeps %s", async (choice) => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Task" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.deleteTask(task);
  const changed = await f.remote.updateTask(task, (value) => {
    value.description = "Remote notes";
  });
  f.connect(true);
  const writes = f.pod.mutations().length;
  await f.adapter.reconnected();
  expect(f.pod.mutations()).toHaveLength(writes);
  expect(f.pod.files.has(task.url)).toBe(true);
  const conflict = f.outbox.conflicts()[0];
  if (!conflict) throw new Error("Missing delete conflict");
  await f.adapter.resolve(conflict.id, choice);
  expect(f.outbox.pending()).toEqual([]);
  expect(f.pod.files.has(task.url)).toBe(choice === "theirs");
  if (choice === "mine")
    expect(f.pod.mutations().at(-1)?.headers.get("If-Match")).toBe(changed.etag);
});

it.each([
  "mine",
  "theirs",
  "both",
] as const)("replays unrelated resources and resumes waiting edits after Keep %s", async (choice) => {
  const f = await setup();
  const first = await f.cache.createTask(f.inbox, { title: "First" });
  const second = await f.cache.createTask(f.inbox, { title: "Second" });
  if (!first || !second) throw new Error("Missing tasks");
  f.connect(false);
  await f.cache.updateTask(first, (value) => {
    value.title = "Local first";
  });
  await f.cache.updateTask(first, (value) => {
    value.rank = 7;
  });
  await f.cache.updateTask(second, (value) => {
    value.title = "Local second";
  });
  await f.remote.updateTask(first, (value) => {
    value.title = "Remote first";
  });
  f.connect(true);
  await f.adapter.reconnected();
  expect((await f.remote.readTask(second.url)).task.title).toBe("Local second");
  expect(f.outbox.pending().map((item) => item.status)).toEqual(["conflict", "waiting"]);
  const conflict = f.outbox.conflicts()[0];
  if (!conflict) throw new Error("Missing conflict");
  await f.adapter.resolve(conflict.id, choice);
  expect(f.outbox.pending()).toEqual([]);
  expect((await f.remote.readTask(first.url)).task.rank).toBe(7);
});

it("overlays pending creates and deletes on listing refresh and offline reload", async () => {
  const f = await setup();
  const removed = await f.cache.createTask(f.inbox, { title: "Remove" });
  if (!removed) throw new Error("Missing task");
  f.connect(false);
  await f.cache.createTask(f.inbox, { title: "Pending" });
  await f.cache.deleteTask(removed);
  f.connect(true);
  await f.cache.loadTasks(f.inbox, true);
  expect(f.cache.getSnapshot().views.map((task) => task.title)).toEqual(["Pending"]);
  f.connect(false);
  const reloaded = new TasksOffline(f.offlineOptions);
  const store = new OfflineTaskStore({ ...f.storeOptions, fetch: reloaded.fetch }, () => false);
  expect(
    (await store.listTasks(f.inbox.tracker.stateStore as string)).map((task) => task.task.title),
  ).toEqual(["Pending"]);
});

it("ignores a listing response begun before a newer local project change", async () => {
  const f = await setup();
  const folder = f.inbox.tracker.stateStore as string;
  const stale = await f.pod.fetch(folder);
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  f.pod.intercept = (request) => {
    if (request.url === folder && request.method === "GET") {
      started.resolve();
      return response.promise;
    }
    return undefined;
  };
  const reading = f.store.listTasks(folder);
  await started.promise;
  f.connect(false);
  await f.cache.createTask(f.inbox, { title: "Newer local task" });
  response.resolve(stale);
  expect((await reading).map((task) => task.task.title)).toEqual(["Newer local task"]);
  expect((await f.store.listTasks(folder)).map((task) => task.task.title)).toEqual([
    "Newer local task",
  ]);
});

it("acknowledges a committed create after losing its response and adopts its ETag", async () => {
  const f = await setup();
  f.pod.intercept = (request) => {
    if (request.method === "PUT" && request.url.includes("/inbox/")) {
      f.pod.seed(request.url, request.body);
      throw new TypeError("Lost create response");
    }
    return undefined;
  };
  const task = await f.cache.createTask(f.inbox, { title: "Created once" });
  if (!task) throw new Error("Missing create");
  expect(f.outbox.pending()).toHaveLength(1);
  f.pod.intercept = undefined;
  const receipt = vi.fn();
  f.offline.subscribeReceipts(receipt);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect(f.outbox.conflicts()).toEqual([]);
  const remote = await f.remote.readTask(task.url);
  expect(receipt).toHaveBeenCalledWith(task.url, task.etag, remote.etag);
  expect(await f.remote.listTasks(f.inbox.tracker.stateStore as string)).toHaveLength(1);
});

it.each([
  404, 410,
])("acknowledges a delete pre-read returning %s and unblocks later entries", async (status) => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Remove" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.deleteTask(task);
  const id = task.url.slice(task.url.lastIndexOf("/") + 1, -4);
  await f.store.createTask(f.inbox, { title: "Replacement", state: "open" }, id);
  await f.cache.createTask(f.inbox, { title: "Independent" });
  f.pod.files.delete(task.url);
  f.pod.intercept = (request) =>
    request.url === task.url && request.method === "GET"
      ? new Response(null, { status })
      : undefined;
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  f.pod.intercept = undefined;
  expect((await f.remote.readTask(task.url)).task.title).toBe("Replacement");
  expect(
    (await f.remote.listTasks(f.inbox.tracker.stateStore as string)).map((task) => task.task.title),
  ).toEqual(expect.arrayContaining(["Replacement", "Independent"]));
});

it.each([404, 410])("acknowledges a replay DELETE returning %s", async (status) => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Remove" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  await f.cache.deleteTask(task);
  f.pod.intercept = (request) => {
    if (request.url === task.url && request.method === "DELETE") {
      f.pod.files.delete(task.url);
      return new Response(null, { status });
    }
    return undefined;
  };
  f.connect(true);
  await f.adapter.reconnected();
  expect(f.outbox.pending()).toEqual([]);
  expect(f.pod.files.has(task.url)).toBe(false);
});

it("retains a Keep both conflict if the deterministic copy URL contains different data", async () => {
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
      if (attempts.length === 1)
        f.pod.seed(request.url, request.body.replace('"Mine (copy)"', '"Occupied"'));
    }
    return undefined;
  };
  await expect(f.adapter.resolve(conflict.id, "both")).rejects.toThrow();
  await expect(f.adapter.resolve(conflict.id, "both")).rejects.toThrow();
  expect(new Set(attempts).size).toBe(1);
  expect(f.outbox.conflicts()).toHaveLength(1);
  expect((await f.remote.readTask(attempts[0] as string)).task.title).toBe("Occupied");
});

it("persists the confirmed base ETag for a delete queued behind its own edit", async () => {
  const f = await setup();
  const task = await f.cache.createTask(f.inbox, { title: "Task" });
  if (!task) throw new Error("Missing task");
  f.connect(false);
  const edited = await f.cache.updateTask(task, (value) => {
    value.title = "Edited";
  });
  if (!edited) throw new Error("Missing edit");
  await f.cache.deleteTask(edited);
  f.connect(true);
  // Stop immediately after the edit is acknowledged, before the queued delete.
  const controller = new AbortController();
  f.offline.subscribeReceipts(() => controller.abort());
  await f.outbox.replay(f.raw, { signal: controller.signal });
  expect(f.outbox.pending()).toHaveLength(1);
  const reloaded = new TasksOffline(f.offlineOptions);
  const confirmed = await f.remote.readTask(task.url);
  expect(reloaded.baseEtag(task.url, edited.etag)).toBe(confirmed.etag);
  // An ETag change remains a conflict even if all the document's fields are identical.
  const file = f.pod.files.get(task.url);
  if (!file) throw new Error("Missing task file");
  f.pod.seed(task.url, file.body);
  await f.adapter.reconnected();
  expect(f.outbox.conflicts()).toHaveLength(1);
  expect(f.pod.files.has(task.url)).toBe(true);
});
