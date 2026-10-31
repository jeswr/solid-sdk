// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createNotifications,
  type NotificationsClient,
  type Subscription,
} from "@jeswr/pod-notifications";
import { FakeTimers } from "@jeswr/pod-notifications/testing";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { SolidPersistence, YSolidProvider } from "./provider.js";
import { SolidUpdateStore } from "./store.js";

const ROOT = "https://pod.example/";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: ROOT, protocol });
  const { url: container } = await storage.create(ROOT, null, { kind: "container", name: "doc" });
  return { storage, container };
}
async function count(storage: StorageClient, container: string) {
  let total = 0;
  for await (const _entry of storage.listAll(container)) total++;
  return total;
}
function textUpdate(text: string) {
  const doc = new Y.Doc();
  doc.getText("text").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}
const noFetch: typeof fetch = async () => {
  throw new Error("unexpected network");
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each(["solid", "lws"] as const)("%s notifications", (protocol) => {
  it("reconciles a remote append swallowed by the initial polling baseline", async () => {
    vi.useFakeTimers();
    const { storage, container } = await setup(protocol);
    const timers = new FakeTimers();
    const notifications = createNotifications({ fetch: noFetch, storage, timers, now: timers.now });
    const doc = new Y.Doc();
    const reader = new YSolidProvider({ doc, storage, container, notifications });
    try {
      await reader.whenSynced;
      await vi.advanceTimersByTimeAsync(30_000);
      // The subscription exists, but its silent baseline has not run yet.
      await new SolidUpdateStore({ storage, container }).appendUpdate(textUpdate("between"));
      await timers.advanceBy(0);
      await timers.advanceBy(30_000); // Unchanged membership produces no hint.
      expect(doc.getText("text").toString()).toBe("");
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(doc.getText("text").toString()).toBe("between"));
      await reader.flush();
      expect(await count(storage, container)).toBe(1);
    } finally {
      reader.destroy();
    }
    expect(timers.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries failed notification reads after recovery without another change or manual sync", async () => {
    vi.useFakeTimers();
    const { storage, container } = await setup(protocol);
    const timers = new FakeTimers();
    const notifications = createNotifications({ fetch: noFetch, storage, timers, now: timers.now });
    const read = vi.fn(storage.read);
    const doc = new Y.Doc();
    const reader = new YSolidProvider({
      doc,
      storage: { ...storage, read },
      container,
      notifications,
    });
    const error = vi.fn();
    reader.on("error", error);
    try {
      await reader.whenSynced;
      await timers.advanceBy(0);
      await new SolidUpdateStore({ storage, container }).appendUpdate(textUpdate("recovered"));
      read.mockRejectedValue(new Error("temporarily offline"));
      await timers.advanceBy(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalled();
      expect(doc.getText("text").toString()).toBe("");
      const attempts = read.mock.calls.length;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(read.mock.calls.length).toBeGreaterThan(attempts);
      read.mockImplementation(storage.read);
      await timers.advanceBy(30_000); // The poller has already recorded the new membership.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(doc.getText("text").toString()).toBe("recovered"));
      await reader.flush();
      expect(await count(storage, container)).toBe(1);
      read.mockClear();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(read).not.toHaveBeenCalled();
    } finally {
      reader.destroy();
    }
    expect(timers.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "disconnect",
    "destroy",
  ] as const)("cancels pending reconciliation retries on %s", async (method) => {
    vi.useFakeTimers();
    const { storage, container } = await setup(protocol);
    const timers = new FakeTimers();
    const notifications = createNotifications({ fetch: noFetch, storage, timers, now: timers.now });
    const read = vi.fn(storage.read);
    const reader = new YSolidProvider({
      doc: new Y.Doc(),
      storage: { ...storage, read },
      container,
      notifications,
    });
    const error = vi.fn();
    reader.on("error", error);
    try {
      await reader.whenSynced;
      await timers.advanceBy(0);
      await new SolidUpdateStore({ storage, container }).appendUpdate(textUpdate("remote"));
      read.mockRejectedValue(new Error("offline"));
      await timers.advanceBy(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalled();
      await reader[method]();
      const attempts = read.mock.calls.length;
      expect(timers.pending).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await timers.advanceBy(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).toHaveBeenCalledTimes(attempts);
      expect(reader.synced).toBe(false);
    } finally {
      reader.destroy();
    }
  });

  it("ingests Create hints through the real notifications polling client without echoing", async () => {
    const { storage, container } = await setup(protocol);
    const timers = new FakeTimers();
    const notifications = createNotifications({ fetch: noFetch, storage, timers, now: timers.now });
    const readerDoc = new Y.Doc();
    const reader = new YSolidProvider({ doc: readerDoc, storage, container, notifications });
    await reader.whenSynced;
    await timers.advanceBy(0); // Establish the quiet notification baseline.
    const writerDoc = new Y.Doc();
    const writer = new YSolidProvider({ doc: writerDoc, storage, container });
    await writer.whenSynced;
    writerDoc.getText("text").insert(0, "remote");
    await writer.flush();
    const received = deferred<void>();
    readerDoc.on("update", () => received.resolve());
    await timers.advanceBy(30_000);
    await received.promise;
    await reader.flush();
    expect(readerDoc.getText("text").toString()).toBe("remote");
    expect(await count(storage, container)).toBe(1);
    await reader.disconnect();
    expect(timers.pending).toBe(0);
    writerDoc.getText("text").insert(6, " later");
    await writer.flush();
    await timers.advanceBy(30_000);
    expect(readerDoc.getText("text").toString()).toBe("remote");
    await reader.connect();
    expect(readerDoc.getText("text").toString()).toBe("remote later");
    reader.destroy();
    writer.destroy();
    expect(timers.pending).toBe(0);
  });
});

it("debounces local updates for 300 ms and flush bypasses the timer", async () => {
  vi.useFakeTimers();
  const { storage, container } = await setup();
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, storage, container });
  await provider.whenSynced;
  try {
    doc.getText("text").insert(0, "a");
    doc.getText("text").insert(1, "b");
    await vi.advanceTimersByTimeAsync(299);
    expect(await count(storage, container)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await provider.flush();
    expect(await count(storage, container)).toBe(1);
    doc.getText("text").insert(2, "c");
    await provider.flush();
    expect(await count(storage, container)).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    provider.destroy();
  }
});

it("automatically compacts at the resource threshold and respects the minimum interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01"));
  const { storage, container } = await setup();
  const store = new SolidUpdateStore({ storage, container });
  const compact = vi.spyOn(store, "compact");
  const doc = new Y.Doc();
  const provider = new SolidPersistence({
    doc,
    store,
    compaction: { afterUpdates: 2, minIntervalMs: 60_000 },
  });
  await provider.whenSynced;
  try {
    for (let i = 0; i < 2; i++) {
      doc.getText("text").insert(0, String(i));
      await provider.flush();
    }
    await vi.waitFor(() => expect(compact).toHaveBeenCalledOnce());
    await provider.compact();
    expect(await count(storage, container)).toBe(1);
    for (let i = 0; i < 2; i++) {
      doc.getText("text").insert(0, String(i));
      await provider.flush();
    }
    expect(compact).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    doc.getText("text").insert(0, "next");
    await provider.flush();
    await vi.waitFor(() => expect(compact).toHaveBeenCalledTimes(2));
    await provider.compact();
    expect(await count(storage, container)).toBe(1);
  } finally {
    provider.destroy();
  }
});

it("retains failed writes for retry, reports the error, then continues persisting", async () => {
  const { storage, container } = await setup();
  const create = vi.fn(storage.create).mockRejectedValueOnce(new Error("offline"));
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, container, storage: { ...storage, create } });
  const error = vi.fn();
  provider.on("error", error);
  await provider.whenSynced;
  doc.getText("text").insert(0, "retained");
  await expect(provider.flush()).rejects.toThrow("offline");
  expect(error).toHaveBeenCalledOnce();
  doc.getText("text").insert(8, " plus");
  await provider.flush();
  const reader = new YSolidProvider({ doc: new Y.Doc(), storage, container });
  await reader.whenSynced;
  expect(reader.doc.getText("text").toString()).toBe("retained plus");
  reader.destroy();
  provider.destroy();
});

it("discards a late hydration after destroy without mutating the caller's doc or firing synced", async () => {
  const { storage, container } = await setup();
  const store = new SolidUpdateStore({ storage, container });
  await store.appendUpdate(textUpdate("remote"));
  const gate = deferred<void>();
  const started = deferred<void>();
  const read: StorageClient["read"] = async (...args) => {
    started.resolve();
    await gate.promise;
    return storage.read(...args);
  };
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, container, storage: { ...storage, read } });
  const synced = vi.fn();
  provider.on("synced", synced);
  await started.promise;
  provider.destroy();
  gate.resolve();
  await provider.whenSynced;
  expect(doc.getText("text").toString()).toBe("");
  expect(provider.synced).toBe(false);
  expect(synced).not.toHaveBeenCalled();
});

it("closes a subscription that arrives after destroy", async () => {
  const { storage, container } = await setup();
  const real = await createNotifications({ fetch: noFetch, storage }).subscribe([container], {
    pollIntervalMs: 0,
  });
  const close = vi.spyOn(real, "close");
  const gate = deferred<Subscription>();
  const notifications: NotificationsClient = {
    subscribe: () => gate.promise,
    plan: () => ({ channel: "none", reason: "test" }),
  };
  const provider = new YSolidProvider({ doc: new Y.Doc(), storage, container, notifications });
  provider.destroy();
  gate.resolve(real);
  await provider.whenSynced;
  expect(close).toHaveBeenCalledOnce();
  expect(real.state).toBe("closed");
});

it("reconciles resync hints, ignores foreign event URLs and reports background ingestion errors", async () => {
  const { storage, container } = await setup();
  const handlers = new Map<string, (arg: never) => void>();
  const real = await createNotifications({ fetch: noFetch, storage }).subscribe([container], {
    pollIntervalMs: 0,
  });
  const subscription: Subscription = {
    ...real,
    topics: [container],
    state: "live",
    channel: "websocket",
    on: ((event: string, handler: (arg: never) => void) => {
      handlers.set(event, handler);
      return () => {
        handlers.delete(event);
      };
    }) as Subscription["on"],
    close: () => real.close(),
    [Symbol.asyncIterator]: () => real[Symbol.asyncIterator](),
  };
  const listAll = vi.fn(storage.listAll);
  const read = vi.fn(storage.read);
  const notifications: NotificationsClient = {
    subscribe: async () => subscription,
    plan: () => ({ channel: "websocket", reason: "test" }),
  };
  const doc = new Y.Doc();
  const provider = new YSolidProvider({
    doc,
    container,
    storage: { ...storage, listAll, read },
    notifications,
  });
  await provider.whenSynced;
  const listed = listAll.mock.calls.length;
  handlers.get("change")?.({ object: "https://evil.example/secret" } as never);
  expect(listAll).toHaveBeenCalledTimes(listed);
  const store = new SolidUpdateStore({ storage, container });
  await store.appendUpdate(textUpdate("missed"));
  const applied = deferred<void>();
  doc.on("update", () => applied.resolve());
  handlers.get("resync")?.(new Date() as never);
  await applied.promise;
  expect(doc.getText("text").toString()).toBe("missed");
  await store.appendUpdate(textUpdate("next"));
  const error = deferred<Error>();
  provider.on("error", (e) => error.resolve(e));
  read.mockRejectedValueOnce(new Error("network down"));
  handlers.get("change")?.({ object: container } as never);
  expect((await error.promise).message).toBe("network down");
  await provider.sync();
  expect(doc.getText("text").length).toBe(10);
  provider.destroy();
});

it("rejects explicit live mode and invalid persistence policies", async () => {
  const { storage, container } = await setup();
  const doc = new Y.Doc();
  expect(() => new YSolidProvider({ storage, container, doc, mode: "live" })).toThrow(/live mode/);
  for (const policy of [
    { afterUpdates: 0, minIntervalMs: 0 },
    { afterUpdates: 1, minIntervalMs: -1 },
  ]) {
    expect(() => new SolidPersistence({ storage, container, doc, compaction: policy })).toThrow(
      /invalid/,
    );
  }
  expect(() => new SolidPersistence({ storage, container, doc, debounceMs: Number.NaN })).toThrow(
    /invalid/,
  );
});

it("retains a resync arriving during an in-flight reconciliation", async () => {
  const { storage, container } = await setup();
  const handlers = new Map<string, (arg: never) => void>();
  const subscription = await createNotifications({ fetch: noFetch, storage }).subscribe(
    [container],
    { pollIntervalMs: 0 },
  );
  subscription.on = ((event: string, handler: (arg: never) => void) => {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  }) as Subscription["on"];
  const notifications: NotificationsClient = {
    subscribe: async () => subscription,
    plan: () => ({ channel: "none", reason: "test hints" }),
  };
  const store = new SolidUpdateStore({ storage, container });
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, store, notifications });
  const started = deferred<void>();
  const release = deferred<void>();
  try {
    await provider.whenSynced;
    vi.spyOn(store, "loadUpdates").mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return []; // This listing completed before the next invalidation.
    });
    handlers.get("resync")?.(new Date() as never);
    await started.promise;
    await store.appendUpdate(textUpdate("during"));
    const applied = deferred<void>();
    doc.on("update", () => applied.resolve());
    handlers.get("resync")?.(new Date() as never);
    release.resolve();
    await applied.promise;
    expect(doc.getText("text").toString()).toBe("during");
  } finally {
    release.resolve();
    provider.destroy();
  }
});

it("surfaces conditional deletion conflicts on automatic compaction", async () => {
  const { storage, container } = await setup();
  const del: StorageClient["delete"] = async (url) => {
    throw new StorageError("precondition-failed", { url, method: "DELETE", status: 412 });
  };
  const doc = new Y.Doc();
  const provider = new SolidPersistence({
    doc,
    container,
    storage: { ...storage, delete: del },
    compaction: { afterUpdates: 2, minIntervalMs: 0 },
  });
  const conflict = deferred<StorageError>();
  provider.on("conflict", (e) => conflict.resolve(e));
  await provider.whenSynced;
  doc.getText("text").insert(0, "a");
  await provider.flush();
  doc.getText("text").insert(1, "b");
  await provider.flush();
  expect((await conflict.promise).status).toBe(412);
  expect(await count(storage, container)).toBe(3);
  provider.destroy();
});

it("propagates an in-flight write failure to every flush waiting on it", async () => {
  const { storage, container } = await setup();
  const started = deferred<void>();
  const release = deferred<void>();
  const create: StorageClient["create"] = async () => {
    started.resolve();
    await release.promise;
    throw new Error("in-flight failure");
  };
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, container, storage: { ...storage, create } });
  await provider.whenSynced;
  doc.getText("text").insert(0, "pending");
  const first = provider.flush();
  await started.promise;
  const second = provider.flush();
  const checks = Promise.all([
    expect(first).rejects.toThrow("in-flight failure"),
    expect(second).rejects.toThrow("in-flight failure"),
  ]);
  release.resolve();
  await checks;
  provider.destroy();
});

it("debounces relative to the most recent edit", async () => {
  vi.useFakeTimers();
  const { storage, container } = await setup();
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, storage, container });
  await provider.whenSynced;
  try {
    doc.getText("text").insert(0, "a");
    await vi.advanceTimersByTimeAsync(299);
    doc.getText("text").insert(1, "b");
    await vi.advanceTimersByTimeAsync(299);
    expect(await count(storage, container)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await provider.flush();
    expect(await count(storage, container)).toBe(1);
  } finally {
    provider.destroy();
  }
});

it("preserves edits made while disconnected until reconnection", async () => {
  const { storage, container } = await setup();
  const doc = new Y.Doc();
  const provider = new YSolidProvider({ doc, storage, container });
  await provider.whenSynced;
  await provider.disconnect();
  doc.getText("text").insert(0, "offline");
  await provider.flush();
  expect(await count(storage, container)).toBe(0);
  await provider.connect();
  await provider.flush();
  const reader = new YSolidProvider({ doc: new Y.Doc(), storage, container });
  await reader.whenSynced;
  expect(reader.doc.getText("text").toString()).toBe("offline");
  reader.destroy();
  provider.destroy();
});

it("reads a scoped Create before listing visibility and ignores another document's member", async () => {
  vi.useFakeTimers();
  const { storage, container } = await setup();
  const handlers = new Map<string, (arg: never) => void>();
  const subscription = await createNotifications({ fetch: noFetch, storage }).subscribe(
    [container],
    { pollIntervalMs: 0 },
  );
  subscription.on = ((event: string, handler: (arg: never) => void) => {
    handlers.set(event, handler);
    return () => {
      handlers.delete(event);
    };
  }) as Subscription["on"];
  const notifications: NotificationsClient = {
    subscribe: async () => subscription,
    plan: () => ({ channel: "poll", reason: "test hints" }),
  };
  const listAll = vi.fn(storage.listAll);
  const read = vi.fn(storage.read);
  const doc = new Y.Doc();
  const provider = new YSolidProvider({
    doc,
    container,
    storage: { ...storage, listAll, read },
    notifications,
  });
  await provider.whenSynced;
  listAll.mockImplementation(async function* () {}); // A Create precedes listing visibility.
  const created = await new SolidUpdateStore({ storage, container }).appendUpdate(
    textUpdate("early"),
  );
  const applied = deferred<void>();
  doc.on("update", () => applied.resolve());
  const error = deferred<Error>();
  provider.on("error", (e) => error.resolve(e));
  read.mockRejectedValueOnce(new Error("offline before listing visibility"));
  handlers.get("change")?.({
    type: "Create",
    objectKind: "resource",
    object: created.url,
  } as never);
  expect((await error.promise).message).toBe("offline before listing visibility");
  expect(doc.getText("text").toString()).toBe("");
  await vi.advanceTimersByTimeAsync(1_000);
  await applied.promise;
  expect(doc.getText("text").toString()).toBe("early");
  expect(read).toHaveBeenCalledTimes(2);
  const { url: otherContainer } = await storage.create(ROOT, null, {
    kind: "container",
    name: "other",
  });
  const other = await new SolidUpdateStore({ storage, container: otherContainer }).appendUpdate(
    textUpdate("unrelated"),
  );
  handlers.get("change")?.({ type: "Create", objectKind: "resource", object: other.url } as never);
  await provider.sync(); // Wait behind the event ingestion operation.
  expect(read).toHaveBeenCalledTimes(2);
  expect(doc.getText("text").toString()).toBe("early");
  provider.destroy();
});

it("reconnects without waiting for an old hydration request to finish", async () => {
  const { storage, container } = await setup();
  await new SolidUpdateStore({ storage, container }).appendUpdate(textUpdate("reconnect"));
  const started = deferred<void>();
  const release = deferred<void>();
  let firstRead = true;
  const read: StorageClient["read"] = async (...args) => {
    if (firstRead) {
      firstRead = false;
      started.resolve();
      await release.promise;
    }
    return storage.read(...args);
  };
  const doc = new Y.Doc();
  const provider = new SolidPersistence({ doc, container, storage: { ...storage, read } });
  try {
    await started.promise;
    await provider.disconnect();
    await provider.connect();
    expect(doc.getText("text").toString()).toBe("reconnect");
    release.resolve();
    await provider.whenSynced;
    expect(provider.synced).toBe(true);
  } finally {
    release.resolve();
    provider.destroy();
  }
});
