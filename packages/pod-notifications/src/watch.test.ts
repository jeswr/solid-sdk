// AUTHORED-BY Codex GPT-6.1-Sol
import * as storageModule from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, test, vi } from "vitest";
import * as pollModule from "./channels/poll.js";
import * as pushModule from "./channels/push.js";
import { watchInvalidations } from "./index.js";
import { SubscriptionController } from "./subscription.js";
import { FakeEventSource, FakeTimers, FakeWebSocket } from "./testing.js";

const root = "https://watch.example/pod/";
function fixture(channels: ("websocket" | "legacy-ws" | "sse")[] = []) {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  storage.features.liveUpdates = {
    state: "available",
    evidence: "test",
    detail: {
      channels,
      endpoint: channels.includes("legacy-ws") ? "wss://watch.example/socket" : `${root}subscribe`,
    },
  };
  const pod = {
    storage,
    features: storage.features,
    description: {
      id: root,
      root,
      protocol: "solid",
      services: [],
    },
  } as unknown as storageModule.PodClient;
  const discover = vi.spyOn(storageModule, "createPodClient").mockResolvedValue(pod);
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ receiveFrom: "wss://watch.example/socket" }),
  );
  const onInvalidate = vi.fn();
  const sockets: FakeWebSocket[] = [];
  const options = {
    fetch,
    topics: [root],
    scope: (url: string) => new URL(url).origin === "https://watch.example",
    onInvalidate,
    socketFactory: (url: string) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
  return { storage, pod, discover, fetch, onInvalidate, sockets, options };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("reuses discovery, deduplicates topics and refreshes first live and reconnect gaps", async () => {
  vi.useFakeTimers();
  const f = fixture(["websocket"]);
  const watch = watchInvalidations({ ...f.options, topics: [root, `${root}note`, root] });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.discover).toHaveBeenCalledTimes(1);
  expect(f.sockets).toHaveLength(2);
  f.sockets[0]?.open();
  expect(f.onInvalidate).not.toHaveBeenCalled();
  f.sockets[1]?.open();
  expect(f.onInvalidate.mock.calls).toEqual([
    [{ type: "Update", object: root }],
    [{ type: "Update", object: `${root}note` }],
  ]);
  f.sockets[0]?.message(JSON.stringify({ type: "Delete", object: `${root}gone` }));
  expect(f.onInvalidate).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "Delete", object: `${root}gone` }),
  );
  f.sockets[0]?.error();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.discover).toHaveBeenCalledTimes(2);
  f.sockets[2]?.open();
  f.sockets[3]?.open();
  expect(f.onInvalidate).toHaveBeenCalledTimes(5);
  const close = watch.close();
  expect(watch.close()).toBe(close);
  await close;
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  "websocket",
  "legacy-ws",
] as const)("uses the platform constructor for %s when available", async (channel) => {
  vi.useFakeTimers();
  const f = fixture([channel]);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const watch = watchInvalidations({ ...f.options, socketFactory: undefined });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(
    channel === "legacy-ws" ? 0 : 1,
  );
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  "service",
  "receiveFrom",
  "capability",
  "malformed",
])("switches unusable %s permanently to polling", async (kind) => {
  vi.useFakeTimers();
  const f = fixture(["websocket"]);
  if (kind === "service")
    f.storage.features.liveUpdates.detail.endpoint = "https://foreign.example/subscribe";
  if (kind === "receiveFrom")
    f.fetch.mockResolvedValue(Response.json({ receiveFrom: "wss://foreign.example/socket" }));
  if (kind === "malformed")
    f.fetch.mockResolvedValue(Response.json({ receiveFrom: "https://watch.example/socket" }));
  if (kind === "capability") f.pod.description.protocol = "lws";
  const watch = watchInvalidations({ ...f.options, pollIntervalMs: 30_000 });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(1);
  expect(f.sockets).toHaveLength(0);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.discover).toHaveBeenCalledTimes(1);
  expect(f.fetch.mock.calls.some(([url]) => String(url).includes("foreign.example"))).toBe(false);
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("batches LWS topics in one subscription and reconciles all topics", async () => {
  vi.useFakeTimers();
  const f = fixture(["websocket"]);
  const storage = createMemoryStorage({ root, protocol: "lws" });
  storage.features.liveUpdates = f.storage.features.liveUpdates;
  f.pod.storage = storage;
  f.pod.description.protocol = "lws";
  const watch = watchInvalidations({ ...f.options, topics: [root, `${root}one`, root] });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sockets).toHaveLength(1);
  const post = f.fetch.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(post?.[1]?.body as string).topic).toEqual([root, `${root}one`]);
  f.sockets[0]?.open();
  expect(f.onInvalidate).toHaveBeenCalledTimes(2);
  await watch.close();
});

test.each([
  "absent",
  "native",
  "factory",
])("handles an %s EventSource for LWS SSE", async (mode) => {
  vi.useFakeTimers();
  const f = fixture(["sse"]);
  const storage = createMemoryStorage({ root, protocol: "lws" });
  storage.features.liveUpdates = f.storage.features.liveUpdates;
  f.pod.storage = storage;
  f.pod.description.protocol = "lws";
  f.pod.description.services = [
    {
      type: ["https://www.w3.org/ns/lws#NotificationService"],
      endpoint: `${root}subscribe`,
      extra: {
        subscriptionType: "https://jeswr.org/ns/solid-sd#SseSubscription",
      },
    },
  ];
  f.fetch.mockResolvedValue(Response.json({ receiveFrom: `${root}events` }));
  vi.stubGlobal("EventSource", mode === "native" ? FakeEventSource : undefined);
  const watch = watchInvalidations({
    ...f.options,
    eventSourceFactory: mode === "factory" ? (url) => new FakeEventSource(url) : undefined,
  });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.fetch).toHaveBeenCalledTimes(mode === "absent" ? 0 : 1);
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  "missing description",
  "foreign root",
  "foreign topic",
])("refreshes periodically after %s without rediscovery, pausing offline", async (kind) => {
  vi.useFakeTimers();
  const f = fixture();
  if (kind === "missing description")
    f.discover.mockRejectedValue(new Error("No storage description"));
  if (kind === "foreign root")
    f.pod.storage = createMemoryStorage({ root: "https://other.example/", protocol: "solid" });
  const watch = watchInvalidations({
    ...f.options,
    topics: kind === "foreign topic" ? ["https://watch.example/elsewhere"] : [root],
    onInvalidate: (event) => {
      f.onInvalidate(event);
      throw new Error("Observer error");
    },
  });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(29_999);
  expect(f.onInvalidate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  vi.stubGlobal("navigator", { onLine: false });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  vi.stubGlobal("navigator", { onLine: true });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.onInvalidate).toHaveBeenCalledTimes(2);
  expect(f.discover).toHaveBeenCalledTimes(1);
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["poll", "discovery", "push"])("zero disables the %s fallback", async (mode) => {
  vi.useFakeTimers();
  const f = fixture(mode === "push" ? ["websocket"] : []);
  if (mode === "discovery") f.discover.mockRejectedValue(new Error("Discovery failed"));
  if (mode === "push") f.storage.features.liveUpdates.detail.endpoint = "https://foreign.example/";
  const watch = watchInvalidations({ ...f.options, pollIntervalMs: 0 });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.onInvalidate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await watch.close();
});

test("honors explicit poll-only policy and injected timers/clock", async () => {
  const f = fixture(["websocket"]);
  const timers = new FakeTimers();
  const watch = watchInvalidations({
    ...f.options,
    storage: root,
    push: false,
    timers,
    now: timers.now,
  });
  await watch.ready;
  await timers.advanceBy(0);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  expect(f.fetch).not.toHaveBeenCalled();
  await watch.close();
  expect(timers.pending).toBe(0);
});

test.each([
  -1,
  0.5,
  NaN,
  Infinity,
  2_147_483_648,
])("rejects invalid interval %s without discovery", async (pollIntervalMs) => {
  const f = fixture();
  const watch = watchInvalidations({ ...f.options, pollIntervalMs });
  await expect(watch.ready).rejects.toThrow("pollIntervalMs");
  expect(f.discover).not.toHaveBeenCalled();
});

test.each([
  [],
  ["https://outside.example/"],
  ["https://user:secret@watch.example/pod/"],
  ["https://watch.example/pod/#fragment"],
  ["http://watch.example/pod/"],
])("rejects empty or unsafe topics %# before discovery", async (topics) => {
  const f = fixture();
  const watch = watchInvalidations({ ...f.options, topics });
  await expect(watch.ready).rejects.toBeInstanceOf(TypeError);
  expect(f.discover).not.toHaveBeenCalled();
});

test("permits HTTP only with the explicit loopback exception", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.discover.mockRejectedValue(new Error("No description"));
  const watch = watchInvalidations({
    ...f.options,
    topics: ["http://localhost/pod/"],
    scope: () => true,
    allowInsecureLoopback: true,
  });
  await watch.ready;
  expect(f.discover).toHaveBeenCalledTimes(1);
  await watch.close();
});

test("cancels before discovery and after a delayed discovery without leaking timers", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const signal = new AbortController();
  signal.abort();
  const early = watchInvalidations({ ...f.options, signal: signal.signal });
  await early.ready;
  expect(f.discover).not.toHaveBeenCalled();
  const pending = Promise.withResolvers<storageModule.PodClient>();
  f.discover.mockReturnValueOnce(pending.promise);
  const abort = new AbortController();
  const late = watchInvalidations({ ...f.options, signal: abort.signal });
  abort.abort();
  pending.resolve(f.pod);
  await late.ready;
  await late.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("close aborts a failed discovery and ignores stale fallback ticks", async () => {
  const f = fixture();
  f.discover.mockRejectedValue(new Error("No description"));
  let tick = () => {};
  const timers = {
    setTimeout: (callback: () => void) => {
      tick = callback;
      return 1;
    },
    clearTimeout: vi.fn(),
  };
  const watch = watchInvalidations({ ...f.options, timers });
  await watch.ready;
  await watch.close();
  tick();
  expect(f.onInvalidate).not.toHaveBeenCalled();
  expect(timers.clearTimeout).toHaveBeenCalledTimes(1);
  const pending = Promise.withResolvers<storageModule.PodClient>();
  f.discover.mockReturnValueOnce(pending.promise);
  const late = watchInvalidations({ ...f.options, timers });
  await late.close();
  pending.reject(new Error("Late discovery failure"));
  await late.ready;
  expect(timers.clearTimeout).toHaveBeenCalledTimes(1);
});

test("covers an already-live subscription and fences callbacks during observer-driven close", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root, `${root}note`]);
  sub.transition("live");
  vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const watch = watchInvalidations({
    ...f.options,
    topics: [root, `${root}note`],
    onInvalidate: (event) => {
      f.onInvalidate(event);
      void watch.close();
    },
  });
  await watch.ready;
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  await watch.close();
});

test("filters invalidations to caller scope and ignores repeated live states", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const watch = watchInvalidations(f.options);
  await watch.ready;
  sub.transition("degraded");
  sub.transition("live");
  sub.transition("degraded");
  sub.transition("live");
  sub.change({ type: "Update", object: "https://foreign.example/note" } as never);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  await watch.close();
});

test("keeps refreshing if a push teardown fails during the polling switch", async () => {
  vi.useFakeTimers();
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  sub.cleanup = () => {
    throw new Error("Transport cleanup failed");
  };
  const create = vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const watch = watchInvalidations(f.options);
  await watch.ready;
  create.mock.calls[0]?.[0].onUnavailable?.();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  await expect(watch.close()).rejects.toThrow("Transport cleanup failed");
  expect(vi.getTimerCount()).toBe(0);
});

test("cancellation during the switch cannot start polling", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  const create = vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const polling = vi.spyOn(pollModule, "createPollChannel");
  const watch = watchInvalidations(f.options);
  await watch.ready;
  create.mock.calls[0]?.[0].onUnavailable?.();
  await watch.close();
  await Promise.resolve();
  expect(polling).not.toHaveBeenCalled();
});

test("bounds every fetch, disables redirects, combines cancellation and retains DELETE after close", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const watch = watchInvalidations(f.options);
  await watch.ready;
  const fetch = f.discover.mock.calls[0]?.[0].fetch as typeof globalThis.fetch;
  await expect(fetch("https://foreign.example/")).rejects.toThrow("scope");
  await expect(fetch("https://user:secret@watch.example/")).rejects.toThrow("URL");
  await expect(fetch("wss://watch.example/socket")).rejects.toThrow("scheme");
  const controller = new AbortController();
  await fetch(new Request(root), { redirect: "follow", signal: controller.signal });
  const call = f.fetch.mock.calls[0]?.[1];
  expect(call?.redirect).toBe("error");
  controller.abort();
  expect(call?.signal?.aborted).toBe(true);
  const redirected = Response.json({});
  Object.defineProperty(redirected, "redirected", { value: true });
  f.fetch.mockResolvedValueOnce(redirected);
  await expect(fetch(root)).rejects.toThrow("redirect refused");
  await watch.close();
  await expect(fetch(root)).rejects.toThrow();
  await fetch(`${root}channel`, { method: "DELETE" });
  expect(f.fetch).toHaveBeenLastCalledWith(`${root}channel`, {
    method: "DELETE",
    redirect: "error",
  });
});

test("a forbidden watched topic during discovery closes instead of polling", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  f.discover.mockImplementationOnce(async (options) => {
    await options.fetch(root);
    throw new Error("Forbidden");
  });
  const watch = watchInvalidations(f.options);
  await watch.ready;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.onInvalidate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await watch.close();
});

test("a forbidden ancestor probe falls back to refresh hints for a shared topic", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const topic = `${root}issues/team/`;
  f.fetch.mockImplementation(async (input) =>
    String(input) === topic
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 403 }),
  );
  f.discover.mockImplementationOnce(async (options) => {
    expect((await options.fetch(topic, { method: "HEAD" })).status).toBe(200);
    expect((await options.fetch(`${root}issues/`, { method: "HEAD" })).status).toBe(403);
    throw new Error("Forbidden ancestor");
  });
  const watch = watchInvalidations({ ...f.options, topics: [topic], pollIntervalMs: 25_000 });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(25_000);
  expect(f.onInvalidate).toHaveBeenCalledWith({ type: "Update", object: topic });
  await vi.advanceTimersByTimeAsync(25_000);
  expect(f.onInvalidate).toHaveBeenCalledTimes(2);
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("a forbidden response after discovery still closes the watch", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const watch = watchInvalidations(f.options);
  await watch.ready;
  const fetch = f.discover.mock.calls[0]?.[0].fetch as typeof globalThis.fetch;
  f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  await fetch(`${root}subscribe`, { method: "POST" });
  await expect(fetch(root)).rejects.toThrow();
  await watch.close();
});

test("a forbidden cleanup DELETE settles close without recursively awaiting itself", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const watch = watchInvalidations(f.options);
  await watch.ready;
  const fetch = f.discover.mock.calls[0]?.[0].fetch as typeof globalThis.fetch;
  f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  sub.cleanup = async () => {
    await fetch(`${root}channel`, { method: "DELETE" });
  };
  await expect(watch.close()).resolves.toBeUndefined();
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test.each([
  404, 405, 410, 501,
])("polls when a notification service reports unsupported push (%s)", async (status) => {
  vi.useFakeTimers();
  const f = fixture(["websocket"]);
  f.fetch.mockResolvedValue(new Response(null, { status }));
  const watch = watchInvalidations(f.options);
  await watch.ready;
  await vi.advanceTimersByTimeAsync(1);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.discover).toHaveBeenCalledTimes(1);
  await watch.close();
});

test("external abort absorbs a transport cleanup failure", async () => {
  const f = fixture(["websocket"]);
  const sub = new SubscriptionController([root]);
  sub.cleanup = () => {
    throw new Error("Cleanup failed");
  };
  vi.spyOn(pushModule, "createPushChannel").mockReturnValue(sub);
  const controller = new AbortController();
  const watch = watchInvalidations({ ...f.options, signal: controller.signal });
  await watch.ready;
  controller.abort();
  await expect(watch.close()).rejects.toThrow("Cleanup failed");
});

test.each([
  "websocket",
  "legacy-ws",
] as const)("polls when no WebSocket constructor exists for %s", async (channel) => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", undefined);
  const f = fixture([channel]);
  const watch = watchInvalidations({ ...f.options, socketFactory: undefined, pollIntervalMs: 20 });
  await watch.ready;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.onInvalidate).toHaveBeenCalledTimes(1);
  expect(f.fetch).not.toHaveBeenCalled();
  await f.storage.create(root, "new", { name: "new", contentType: "text/plain" });
  await vi.advanceTimersByTimeAsync(20);
  expect(f.onInvalidate).toHaveBeenCalledTimes(3);
  expect(f.discover).toHaveBeenCalledTimes(1);
  await watch.close();
  expect(vi.getTimerCount()).toBe(0);
});
