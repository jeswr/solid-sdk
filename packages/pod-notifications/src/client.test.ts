// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, test, vi } from "vitest";
import { createNotifications } from "./index.js";
import { platform, systemTimers } from "./runtime.js";
import { FakeTimers } from "./testing.js";
import type { ChangeEvent } from "./types.js";

const root = "https://pod.example/alice/";
function fixture(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ protocol, root, pageSize: 1 });
  const timers = new FakeTimers();
  const fetch = vi.fn(() => {
    throw new Error("Unexpected raw fetch");
  });
  const client = createNotifications({ fetch, storage, timers, now: timers.now });
  return { storage, timers, client, fetch };
}
function network(online = true) {
  const navigator = { onLine: online };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler);
  });
  vi.stubGlobal("removeEventListener", (type: string, handler: () => void) => {
    listeners.get(type)?.delete(handler);
  });
  return {
    listeners,
    set: (onLine: boolean) => {
      navigator.onLine = onLine;
      for (const fn of listeners.get(onLine ? "online" : "offline") ?? []) fn();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  {
    protocol: "solid",
    channels: ["legacy-ws", "sse", "websocket"],
    relay: false,
    expected: "websocket",
  },
  { protocol: "lws", channels: ["webhook", "sse"], relay: true, expected: "sse" },
  { protocol: "lws", channels: ["webhook", "legacy-ws"], relay: true, expected: "webhook-relay" },
  { protocol: "lws", channels: ["webhook"], relay: false, expected: "poll" },
  { protocol: "solid", channels: ["webhook", "legacy-ws"], relay: true, expected: "legacy-ws" },
  { protocol: "solid", channels: [], relay: false, expected: "poll" },
] as const)("plans $expected for $protocol/$channels with relay=$relay", ({
  protocol,
  channels,
  relay,
  expected,
}) => {
  const { storage, fetch } = fixture(protocol);
  storage.features.liveUpdates.state = "available";
  storage.features.liveUpdates.detail.channels = [...channels];
  const client = createNotifications({
    storage,
    fetch,
    relay: relay ? { url: "https://relay.example" } : undefined,
  });
  expect(client.plan()).toEqual({ channel: expected, reason: expect.any(String) });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "unknown",
  "unavailable",
] as const)("untrusted %s capability does not select advertised channels", (state) => {
  const { storage, client } = fixture();
  storage.features.liveUpdates = { state, evidence: "none", detail: { channels: ["websocket"] } };
  expect(client.plan().channel).toBe("poll");
});

test("polls default cadence, establishes a quiet baseline, reports ETags and membership across pages", async () => {
  const { storage, client, timers, fetch } = fixture("lws");
  const a = await storage.create(root, "first", { contentType: "text/plain", name: "a" });
  const hot = await storage.create(root, "hot", { contentType: "text/plain", name: "hot" });
  const topic = [root];
  const sub = await client.subscribe(topic, { hot: [hot.url, root, hot.url], depth: "recursive" });
  topic.push("https://evil.example/");
  expect(sub.topics).toEqual([root, hot.url]);
  expect(sub.state).toBe("connecting");
  expect(sub.channel).toBe("poll");
  const changes: ChangeEvent[] = [];
  const states = vi.fn();
  sub.on("change", (e) => changes.push(e));
  sub.on("state", states);
  await timers.advanceBy(0);
  expect(changes).toEqual([]);
  expect(sub.state).toBe("degraded");
  expect(states).toHaveBeenCalledWith("degraded", "polling");
  const b = await storage.create(root, null, { kind: "container", name: "b" });
  await storage.delete(a.url, { ifMatch: a.etag as string });
  await storage.write(hot.url, "changed", {
    ifMatch: hot.etag as string,
    contentType: "text/plain",
  });
  await timers.advanceBy(29_999);
  expect(changes).toEqual([]);
  await timers.advanceBy(1);
  expect(changes.map((e) => [e.type, e.object])).toEqual([
    ["Update", root],
    ["Create", b.url],
    ["Delete", a.url],
    ["Update", hot.url],
  ]);
  expect(changes[0]?.state).toBe((await storage.head(root)).etag);
  expect(changes[1]).toMatchObject({ objectKind: "container", target: root, via: "poll" });
  expect(changes[2]).toMatchObject({ origin: root, objectKind: "resource" });
  expect(new Set(changes.map((e) => e.id)).size).toBe(4);
  expect(changes.every((e) => e.published.getTime() === 30_000)).toBe(true);
  await timers.advanceBy(30_000);
  expect(changes).toHaveLength(4);
  expect(fetch).not.toHaveBeenCalled();
  await sub.close();
  expect(timers.pending).toBe(0);
});

test("zero disables polling, retains lifecycle/abort, and handles no signal", async () => {
  const { client, timers } = fixture();
  const signal = new AbortController();
  const sub = await client.subscribe([root], { pollIntervalMs: 0, signal: signal.signal });
  expect(sub.channel).toBeNull();
  expect(sub.state).toBe("degraded");
  expect(timers.pending).toBe(0);
  signal.abort();
  expect(sub.state).toBe("closed");
  await (await client.subscribe([root], { pollIntervalMs: 0 })).close();
});

test.each([
  -1,
  NaN,
  Infinity,
  0.5,
  2_147_483_648,
])("rejects invalid interval %s before I/O", async (pollIntervalMs) => {
  await expect(fixture().client.subscribe([root], { pollIntervalMs })).rejects.toThrow(
    "pollIntervalMs",
  );
});

test("refuses empty/foreign topics and hot resources and invalid depth without echoing secrets", async () => {
  const { client } = fixture();
  for (const topics of [
    [],
    ["https://evil.example/"],
    ["https://user:secret@pod.example/alice/"],
  ]) {
    await expect(client.subscribe(topics)).rejects.toThrow(
      "Notification topics must be nonempty and within the storage",
    );
  }
  await expect(client.subscribe([root], { hot: ["https://evil.example/"] })).rejects.toThrow(
    TypeError,
  );
  await expect(client.subscribe([root], { depth: "bad" as never })).rejects.toThrow("depth");
  const abort = new AbortController();
  abort.abort();
  await expect(client.subscribe([root], { signal: abort.signal })).rejects.toThrow();
});

test("offline before subscription suspends baseline; online reconciles immediately and removes listeners", async () => {
  const net = network(false);
  const { storage, client, timers } = fixture();
  const head = vi.spyOn(storage, "head");
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  expect(sub.state).toBe("degraded");
  expect(timers.pending).toBe(0);
  const resync = vi.fn();
  sub.on("resync", resync);
  await timers.advanceBy(100);
  expect(head).not.toHaveBeenCalled();
  net.set(true);
  await timers.advanceBy(0);
  expect(head).toHaveBeenCalledTimes(1);
  expect(resync).toHaveBeenCalledWith(new Date(0));
  net.set(false);
  await timers.advanceBy(100);
  expect(head).toHaveBeenCalledTimes(1);
  net.set(true);
  await timers.advanceBy(0);
  expect(head).toHaveBeenCalledTimes(2);
  await sub.close();
  expect([...net.listeners.values()].every((set) => set.size === 0)).toBe(true);
});

test("offline resumes missed membership changes without advancing a partial baseline", async () => {
  const net = network();
  const { storage, client, timers } = fixture();
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  const changes = vi.fn();
  sub.on("change", changes);
  net.set(false);
  const child = await storage.create(root, "new", { contentType: "text/plain", name: "new" });
  await timers.advanceBy(100);
  expect(changes).not.toHaveBeenCalled();
  net.set(true);
  await timers.advanceBy(0);
  expect(changes.mock.calls.map(([e]) => e.type)).toEqual(["Update", "Create"]);
  expect(changes.mock.calls[1]?.[0].object).toBe(child.url);
  await sub.close();
});

test("failed list page keeps the whole previous snapshot and retries; other topics still poll", async () => {
  const { storage, client, timers } = fixture();
  const child = await storage.create(root, "a", { contentType: "text/plain", name: "a" });
  const sub = await client.subscribe([root, child.url], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  const changes = vi.fn();
  sub.on("change", changes);
  await storage.create(root, "b", { contentType: "text/plain", name: "b" });
  await storage.write(child.url, "new", {
    contentType: "text/plain",
    ifMatch: child.etag as string,
  });
  vi.spyOn(storage, "listAll").mockImplementationOnce(async function* () {
    yield { url: `${root}partial`, kind: "resource" } as never;
    throw new Error("network");
  });
  await timers.advanceBy(10);
  expect(changes.mock.calls.map(([e]) => e.object)).toEqual([child.url]);
  await timers.advanceBy(10);
  expect(changes.mock.calls.map(([e]) => e.type)).toEqual(["Update", "Update", "Create"]);
  await sub.close();
});

test.each([
  null,
  "network",
  {},
  { code: "network" },
])("recovers after non-authorisation poll failure %#", async (error) => {
  const { storage, client, timers } = fixture();
  const spy = vi.spyOn(storage, "head").mockRejectedValueOnce(error);
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  await timers.advanceBy(10);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(sub.state).toBe("degraded");
  await sub.close();
});

test("forbidden terminates polling and settles iterators with an explicit reason", async () => {
  const { storage, client, timers } = fixture();
  vi.spyOn(storage, "head").mockRejectedValue({ code: "forbidden" });
  const sub = await client.subscribe([root]);
  const state = vi.fn();
  sub.on("state", state);
  const next = sub[Symbol.asyncIterator]().next();
  await timers.advanceBy(0);
  expect(state).toHaveBeenCalledWith("closed", "forbidden");
  expect(sub.state).toBe("closed");
  expect(timers.pending).toBe(0);
  expect(await next).toEqual({ value: undefined, done: true });
});

test("null ETags do not invent updates; foreign listed members are dropped", async () => {
  const { storage, client, timers } = fixture();
  const realHead = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url) => ({
    ...(await realHead(url)),
    etag: null,
  }));
  const realList = storage.listAll.bind(storage);
  vi.spyOn(storage, "listAll").mockImplementation(async function* (url, opts) {
    yield* realList(url, opts);
    yield { url: "https://evil.example/", kind: "resource" } as never;
  });
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  const changes = vi.fn();
  sub.on("change", changes);
  await timers.advanceBy(0);
  await storage.create(root, null, { kind: "container", name: "new" });
  await timers.advanceBy(10);
  expect(changes.mock.calls.map(([e]) => e.type)).toEqual(["Create"]);
  await sub.close();
});

test("defaults to system scheduler and clock; direct timer cancellation works", async () => {
  vi.useFakeTimers();
  const { storage, fetch } = fixture();
  const sub = await createNotifications({ storage, fetch }).subscribe([root], {
    pollIntervalMs: 10,
  });
  const changes = vi.fn();
  sub.on("change", changes);
  await vi.advanceTimersByTimeAsync(0);
  await storage.create(root, null, { kind: "container", name: "new" });
  await vi.advanceTimersByTimeAsync(10);
  expect(changes).toHaveBeenCalled();
  await sub.close();
  expect(vi.getTimerCount()).toBe(0);
  const timer = systemTimers.setTimeout(() => {
    throw new Error("cancelled");
  }, 10);
  systemTimers.clearTimeout(timer);
  await vi.advanceTimersByTimeAsync(10);
  expect(platform).toBe(globalThis);
});

test("signal abort cancels an in-flight HEAD and ignores a late response", async () => {
  const { storage, client, timers } = fixture();
  const head = await storage.head(root);
  const deferred = Promise.withResolvers<typeof head>();
  vi.spyOn(storage, "head").mockReturnValueOnce(deferred.promise);
  const abort = new AbortController();
  const sub = await client.subscribe([root], { signal: abort.signal });
  const changes = vi.fn();
  sub.on("change", changes);
  const tick = timers.advanceBy(0);
  abort.abort();
  deferred.resolve(head);
  await tick;
  expect(sub.state).toBe("closed");
  expect(timers.pending).toBe(0);
  expect(changes).not.toHaveBeenCalled();
});

test("online during an aborted request queues one immediate reconciliation and resyncs after success", async () => {
  const net = network();
  const { storage, client, timers } = fixture();
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  const head = await storage.head(root);
  const deferred = Promise.withResolvers<typeof head>();
  const spy = vi.spyOn(storage, "head").mockReturnValueOnce(deferred.promise);
  const resync = vi.fn();
  sub.on("resync", resync);
  const tick = timers.advanceBy(10);
  net.set(false);
  net.set(true);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(resync).not.toHaveBeenCalled();
  deferred.resolve(head);
  await tick;
  expect(spy).toHaveBeenCalledTimes(2);
  expect(resync).toHaveBeenCalledTimes(1);
  await sub.close();
});

test("abort during pagination discards partial members and preserves the old baseline", async () => {
  const net = network();
  const { storage, client, timers } = fixture();
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  const child = await storage.create(root, "new", { contentType: "text/plain", name: "new" });
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  vi.spyOn(storage, "listAll").mockImplementationOnce(async function* () {
    entered.resolve();
    await gate.promise;
    yield { url: `${root}partial`, kind: "resource" } as never;
  });
  const changes = vi.fn();
  sub.on("change", changes);
  const tick = timers.advanceBy(10);
  await entered.promise;
  net.set(false);
  gate.resolve();
  await tick;
  expect(changes).not.toHaveBeenCalled();
  net.set(true);
  await timers.advanceBy(0);
  expect(changes.mock.calls.map(([e]) => [e.type, e.object])).toEqual([
    ["Update", root],
    ["Create", child.url],
  ]);
  await sub.close();
});

test("closing in a change callback cancels remaining hot topics and queued timers", async () => {
  const { storage, client, timers } = fixture();
  const sub = await client.subscribe([root, `${root}missing`], { pollIntervalMs: 10 });
  await timers.advanceBy(0);
  const spy = vi.spyOn(storage, "head");
  sub.on("change", () => {
    void sub.close();
  });
  await storage.create(root, "new", { contentType: "text/plain", name: "new" });
  await timers.advanceBy(10);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(sub.state).toBe("closed");
  expect(timers.pending).toBe(0);
});

test("queued callbacks cannot restart a closed or silently offline subscription", async () => {
  const { storage, fetch } = fixture();
  const head = vi.spyOn(storage, "head");
  let queued = () => {};
  const timers = {
    setTimeout: (callback: () => void) => {
      queued = callback;
      return 1;
    },
    clearTimeout: vi.fn(),
  };
  const client = createNotifications({ storage, fetch, timers });
  const closed = await client.subscribe([root]);
  await closed.close();
  await queued();
  expect(head).not.toHaveBeenCalled();
  const offline = await client.subscribe([root]);
  vi.stubGlobal("navigator", { onLine: false });
  await queued();
  expect(head).not.toHaveBeenCalled();
  await offline.close();
});

test("closing from resync cannot leave a timer behind; failed reconciliation postpones resync", async () => {
  const net = network(false);
  const { storage, client, timers } = fixture();
  const sub = await client.subscribe([root], { pollIntervalMs: 10 });
  const resync = vi.fn(() => {
    void sub.close();
  });
  sub.on("resync", resync);
  vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("network"));
  net.set(true);
  await timers.advanceBy(0);
  expect(resync).not.toHaveBeenCalled();
  await timers.advanceBy(10);
  expect(resync).toHaveBeenCalledTimes(1);
  expect(timers.pending).toBe(0);
});
