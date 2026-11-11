// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createOutbox, type Outbox, withOutbox } from "@jeswr/suite-sdk/offline";
import { expect, test, vi } from "vitest";
import { createRealOutbox, outboxTransport } from "../src/shell/lib/real-outbox";
import { defaultPreferences } from "../src/shell/lib/settings-preferences";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
const root = "https://pod.example/alice/";
function fake() {
  let items: ReturnType<Outbox["pending"]> = [];
  let conflicts: ReturnType<Outbox["conflicts"]> = [];
  const events = { change: new Set<() => void>(), conflict: new Set<() => void>() };
  const outbox: Outbox = {
    webId: `${root}profile#me`,
    ready: Promise.resolve(),
    pending: () => items.map((item) => ({ ...item })),
    conflicts: () => [...conflicts],
    enqueue: vi.fn(),
    registerDelegate: vi.fn(),
    registerGuardPolicy: vi.fn(),
    localBody: vi.fn(),
    discard: vi.fn(),
    purge: vi.fn(),
    close: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    replay: vi.fn().mockResolvedValue(undefined),
    on(event, listener) {
      events[event].add(listener);
      return () => {
        events[event].delete(listener);
      };
    },
  };
  return {
    outbox,
    events,
    set(next: typeof items, nextConflicts: typeof conflicts = []) {
      items = next;
      conflicts = nextConflicts;
    },
    emit(event: keyof typeof events = "change") {
      for (const listener of events[event]) listener();
    },
  };
}
const item = {
  id: "one",
  op: "write" as const,
  url: `${root}Work/Some%20notes.txt`,
  size: 3,
  createdAt: 1000,
  status: "waiting" as const,
};
const conflict = {
  id: "conflict",
  itemId: "one",
  url: item.url,
  kind: "binary" as const,
  localEtag: '"old"',
  remoteEtag: '"new"',
  contentType: "text/plain",
};

test("maps every status, labels, locations, errors, conflicts and stable snapshots", async () => {
  const f = fake();
  const controller = new AbortController();
  f.set([
    item,
    {
      ...item,
      id: "failed",
      status: "failed",
      label: "Save settings",
      error: "Denied",
      container: `${root}settings/`,
    },
    { ...item, id: "sending", status: "replaying" },
  ]);
  const adapter = createRealOutbox({
    outbox: f.outbox,
    storage: () => null,
    signal: controller.signal,
    now: () => new Date(2000),
  });
  await f.outbox.ready;
  const first = adapter.getSnapshot();
  expect(adapter.getSnapshot()).toBe(first);
  expect(first.pending).toEqual([
    {
      id: "one",
      label: "Some notes.txt",
      where: "/alice/Work/",
      queuedAt: new Date(1000),
      state: "pending",
    },
    {
      id: "failed",
      label: "Save settings",
      where: "/alice/settings/",
      queuedAt: new Date(1000),
      state: "failed",
      error: "Denied",
    },
    {
      id: "sending",
      label: "Some notes.txt",
      where: "/alice/Work/",
      queuedAt: new Date(1000),
      state: "pending",
    },
  ]);
  const listener = vi.fn();
  const unsubscribe = adapter.subscribe(listener);
  f.set([{ ...item, label: "Local notes", status: "conflict" }], [conflict]);
  f.emit("conflict");
  expect(adapter.getSnapshot().pending).toEqual([]);
  expect(adapter.getSnapshot().conflicts[0]).toMatchObject({
    id: "conflict",
    name: "Local notes",
    where: "/alice/Work/",
    changedAt: new Date(1000),
  });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  f.set([], [conflict]);
  adapter.reload();
  expect(adapter.getSnapshot().conflicts[0]).toMatchObject({
    name: "Some notes.txt",
    changedAt: new Date(2000),
  });
  expect(adapter.getSnapshot().lastSyncedAt).toEqual(new Date(2000));
  expect(listener).toHaveBeenCalledTimes(1);
  f.set([
    { ...item, url: "https://pod.example/", id: "host" },
    { ...item, url: `${root}%ZZ`, id: "malformed" },
  ]);
  f.emit();
  expect(adapter.getSnapshot().pending.map((p) => p.label)).toEqual(["pod.example", "%ZZ"]);
  adapter.dispose();
  expect(f.events.change.size + f.events.conflict.size).toBe(0);
});

test("retry, retry all, keep both and reconnect delegate to the session client", async () => {
  const f = fake();
  const controller = new AbortController();
  let storage: StorageClient | null = null;
  const adapter = createRealOutbox({
    outbox: f.outbox,
    storage: () => storage,
    signal: controller.signal,
  });
  await adapter.reconnected();
  expect(f.outbox.replay).not.toHaveBeenCalled();
  await expect(adapter.retry("one")).rejects.toThrow("still opening");
  expect(() => adapter.enqueue({ label: "description", where: "" })).toThrow("withOutbox");
  storage = {} as StorageClient;
  await adapter.retry("one");
  await adapter.retryAll();
  await adapter.resolve("conflict", "both");
  await adapter.reconnected();
  expect(f.outbox.retry).toHaveBeenNthCalledWith(1, "one");
  expect(f.outbox.retry).toHaveBeenNthCalledWith(2);
  expect(f.outbox.resolve).toHaveBeenCalledWith("conflict", "both");
  expect(f.outbox.replay).toHaveBeenCalledTimes(2);
  expect(f.outbox.replay).toHaveBeenLastCalledWith(storage, { signal: controller.signal });
  vi.mocked(f.outbox.resolve).mockRejectedValueOnce(new Error("Denied"));
  await expect(adapter.resolve("conflict", "mine")).rejects.toThrow("Denied");
  controller.abort();
  await adapter.reconnected();
  await expect(adapter.retryAll()).rejects.toThrow();
  expect(f.outbox.replay).toHaveBeenCalledTimes(2);
  adapter.dispose();
});

test("hydration failure is contained and an aborted session ignores late hydration", async () => {
  const f = fake();
  Object.defineProperty(f.outbox, "ready", {
    value: Promise.reject(new Error("Unavailable")),
    configurable: true,
  });
  const signal = new AbortController();
  signal.abort();
  const adapter = createRealOutbox({
    outbox: f.outbox,
    storage: () => null,
    signal: signal.signal,
  });
  await Promise.resolve();
  await Promise.resolve();
  adapter.dispose();
  Object.defineProperty(f.outbox, "ready", { value: Promise.resolve(), configurable: true });
  const retired = createRealOutbox({
    outbox: f.outbox,
    storage: () => null,
    signal: signal.signal,
  });
  const listener = vi.fn();
  retired.subscribe(listener);
  await f.outbox.ready;
  expect(listener).not.toHaveBeenCalled();
  retired.dispose();
});

test("transport forwards signals and refuses stale or aborted account authority, including late replies", async () => {
  let active = true;
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("ok"));
  const transport = outboxTransport(fetch, () => active, controller.signal);
  await transport(root);
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  const request = new Request(root);
  await transport(request);
  const signal = new AbortController();
  await transport(root, { signal: signal.signal });
  signal.abort();
  expect(fetch.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
  active = false;
  await expect(transport(root)).rejects.toThrow("no longer active");
  expect(fetch).toHaveBeenCalledTimes(3);
  active = true;
  fetch.mockImplementationOnce(async () => {
    active = false;
    return new Response();
  });
  await expect(transport(root)).rejects.toThrow("no longer active");
  active = true;
  controller.abort();
  await expect(transport(root)).rejects.toThrow();
});

test("queued creates keep contents, survive closing/sign-out and isolate WebIDs", async () => {
  const idb = new IDBFactory();
  const alice = createOutbox({ webId: `${root}profile#me`, idb });
  const bob = createOutbox({ webId: "https://pod.example/bob/profile#me", idb });
  const storage = createMemoryStorage({ root });
  const failing = new Proxy(storage, {
    get(target, property) {
      if (property === "create")
        return async () => {
          throw new TypeError("Network fetch failed");
        };
      return Reflect.get(target, property);
    },
  });
  const queued = await withOutbox(failing, alice).create(root, JSON.stringify(defaultPreferences), {
    name: "queued-note.json",
    contentType: "application/json",
    offline: "queue",
  });
  expect(queued.queued).toBe(true);
  expect(alice.pending()[0]?.url).toBe(queued.url);
  expect(alice.pending()[0]?.name).toBe("queued-note.json");
  alice.close();
  const reopened = createOutbox({ webId: alice.webId, idb });
  await Promise.all([reopened.ready, bob.ready]);
  expect(reopened.pending()).toHaveLength(1);
  expect(bob.pending()).toEqual([]);
  const adapter = createRealOutbox({
    outbox: reopened,
    storage: () => storage,
    signal: new AbortController().signal,
  });
  await adapter.reconnected();
  expect(JSON.parse(await (await storage.read(queued.url)).text())).toEqual(defaultPreferences);
  expect(reopened.pending()).toEqual([]);
  adapter.dispose();
  reopened.close();
  bob.close();
});
