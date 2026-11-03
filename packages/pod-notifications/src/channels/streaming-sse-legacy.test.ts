// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import * as storageModule from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, test, vi } from "vitest";
import { createNotifications } from "../index.js";
import { FakeEventSource, FakeTimers, FakeWebSocket } from "../testing.js";
import type { ChangeEvent, TransportEvents } from "../types.js";
import { createLegacyWebSocketChannel } from "./legacy-ws.js";
import { createLwsSseChannel } from "./lws-sse.js";
import { createStreamingHttpChannel } from "./streaming-http.js";

function fixture(kind: "stream" | "lws" | "legacy" = "stream") {
  const root = "https://pod.example/alice/";
  const storage = createMemoryStorage({ protocol: kind === "lws" ? "lws" : "solid", root });
  storage.features.liveUpdates = {
    state: "available",
    evidence: "fixture",
    detail: { channels: [kind === "legacy" ? "legacy-ws" : "sse"] },
  };
  const timers = new FakeTimers();
  const sources: FakeEventSource[] = [];
  const sockets: FakeWebSocket[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const cancels = vi.fn();
  const description = `${root}description`;
  let service = `${root}subscribe`;
  let websocketService: string | undefined;
  let socketUrl = "wss://pod.example/legacy";
  let channel: unknown;
  let status = 201;
  let revision = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (init?.method === "POST") {
      expect(url).toBe(service);
      revision++;
      return Response.json(
        channel === undefined
          ? {
              receiveFrom: `${root}stream-${revision}`,
              ...(kind === "lws" ? { subscription: `${root}subscription-${revision}` } : {}),
            }
          : channel,
        { status },
      );
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.startsWith(`${root}stream-`))
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            streams.push(controller);
          },
          cancel: cancels,
        }),
      );
    if (init?.method === "OPTIONS") return new Response(null);
    if (init?.method === "HEAD")
      return new Response(null, {
        headers:
          kind === "legacy"
            ? {
                "updates-via": socketUrl,
                link: '<http://www.w3.org/ns/pim/space#Storage>; rel="type"',
              }
            : {
                link:
                  kind === "lws"
                    ? `<${description}>; rel="https://www.w3.org/ns/lws#storage"`
                    : `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type"`,
              },
      });
    if (url === description && kind === "lws")
      return Response.json(
        {
          "@context": "https://www.w3.org/ns/lws/v1",
          id: description,
          type: "Storage",
          service: [
            { type: "StorageRoot", serviceEndpoint: root },
            ...(websocketService
              ? [
                  {
                    type: "NotificationService",
                    serviceEndpoint: websocketService,
                    subscriptionType: ["https://jeswr.org/ns/solid-sd#WebSocketSubscription"],
                  },
                ]
              : []),
            {
              type: "NotificationService",
              serviceEndpoint: service,
              subscriptionType: ["https://jeswr.org/ns/solid-sd#SseSubscription"],
            },
          ],
        },
        { headers: { "content-type": "application/lws+cid" } },
      );
    if (url === description)
      return new Response(
        `${websocketService ? `<${root}> <http://www.w3.org/ns/solid/notifications#subscription> <${websocketService}>. <${websocketService}> <http://www.w3.org/ns/solid/notifications#channelType> <http://www.w3.org/ns/solid/notifications#WebSocketChannel2023>.` : ""}
        <${root}> <http://www.w3.org/ns/solid/notifications#subscription> <${service}>. <${service}> <http://www.w3.org/ns/solid/notifications#channelType> <http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023>.`,
        { headers: { "content-type": "text/turtle" } },
      );
    throw new Error("Unexpected fixture request");
  });
  const eventSourceFactory = vi.fn((url: string) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source;
  });
  const socketFactory = vi.fn((url: string, protocols?: string[]) => {
    const socket = new FakeWebSocket(url, protocols);
    sockets.push(socket);
    return socket;
  });
  const deps = {
    storage,
    fetch,
    eventSourceFactory,
    socketFactory,
    timers,
    now: timers.now,
    random: () => 0.5,
  };
  return {
    root,
    description,
    deps,
    storage,
    fetch,
    timers,
    sources,
    sockets,
    streams,
    cancels,
    eventSourceFactory,
    socketFactory,
    client: createNotifications(deps),
    channel: (value: unknown) => {
      channel = value;
    },
    status: (value: number) => {
      status = value;
    },
    service: (value: string) => {
      service = value;
    },
    websocketService: (value: string) => {
      websocketService = value;
    },
    socketUrl: (value: string) => {
      socketUrl = value;
    },
    posts: () => fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
    deletes: () => fetch.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const encode = (s: string) => new TextEncoder().encode(s);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test.each([
  "stream",
  "lws",
] as const)("%s SSE adapter selects its own endpoint when WebSocket is preferred", async (kind) => {
  const f = fixture(kind);
  f.websocketService(`${f.root}websocket-subscribe`);
  const adapter = kind === "stream" ? createStreamingHttpChannel : createLwsSseChannel;
  const sub = adapter({ ...f.deps, topics: [f.root] });
  const changes = vi.fn();
  sub.on("change", changes);
  await f.timers.advanceBy(0);
  expect(f.posts()).toHaveLength(1);
  expect(f.posts()[0]?.[0]).toBe(`${f.root}subscribe`);
  const frame = JSON.stringify({ type: "Update", object: f.root });
  if (kind === "stream") f.streams[0]?.enqueue(encode(`${frame}\n`));
  else {
    f.sources[0]?.open();
    f.sources[0]?.message(frame, "event-1", "notification");
  }
  await flush();
  expect(sub.state).toBe("live");
  expect(sub.channel).toBe("sse");
  expect(changes).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ object: f.root, via: "sse" }),
  );
  expect(f.sockets).toHaveLength(0);
  await sub.close();
});

test.each([
  "stream",
  "lws",
] as const)("%s SSE service selection ignores ineligible entries and fails closed without a match", async (kind) => {
  const f = fixture(kind);
  const real = storageModule.createPodClient;
  let matching = true;
  vi.spyOn(storageModule, "createPodClient").mockImplementation(async (options) => {
    const pod = await real(options);
    const service = pod.description.services.find(
      (entry) => entry.endpoint === `${f.root}subscribe`,
    );
    if (!service) throw new Error("Fixture is missing the SSE service");
    pod.description.services = [
      {
        ...service,
        endpoint: `${f.root}wrong-service`,
        type: ["https://example.org/OtherService"],
      },
      {
        ...service,
        endpoint: `${f.root}unsupported-channel`,
        extra: {
          "http://www.w3.org/ns/solid/notifications#channelType": [],
          "https://example.org/subscriptionType": "https://jeswr.org/ns/solid-sd#SseSubscription",
        },
      },
      ...(kind === "lws" ? [{ ...service, endpoint: "https://foreign.example/subscribe" }] : []),
      ...(matching ? [service] : []),
    ];
    return pod;
  });
  const adapter = kind === "stream" ? createStreamingHttpChannel : createLwsSseChannel;
  const sub = adapter({ ...f.deps, topics: [f.root] });
  await f.timers.advanceBy(0);
  expect(f.posts().map(([url]) => url)).toEqual([`${f.root}subscribe`]);
  await sub.close();
  matching = false;
  const missing = adapter({ ...f.deps, topics: [f.root] });
  await f.timers.advanceBy(0);
  expect(missing.state).toBe("degraded");
  expect(f.posts()).toHaveLength(1);
  expect(f.timers.pending).toBe(1);
  await missing.close();
  expect(f.timers.pending).toBe(0);
});

test("StreamingHTTP subscribes per topic/hot, parses split UTF-8 records, skips malformed lines and cancels readers", async () => {
  const f = fixture();
  const head = vi.spyOn(f.storage, "head");
  const sub = await f.client.subscribe([f.root], { hot: [`${f.root}hot`], pollIntervalMs: 0 });
  const changes: ChangeEvent[] = [];
  sub.on("change", (event) => changes.push(event));
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("live");
  expect(sub.channel).toBe("sse");
  expect(f.posts().map(([, init]) => JSON.parse(init?.body as string))).toEqual(
    [f.root, `${f.root}hot`].map((topic) => ({
      "@context": ["https://www.w3.org/ns/solid/notifications-context/v1"],
      type: "http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023",
      topic,
    })),
  );
  const bytes = encode(
    `${JSON.stringify({ id: "café", type: "Update", object: `${f.root}hot`, state: '"etag"' })}\r\n\nnot-json\nnull\n${JSON.stringify({ id: "next", type: "Add", object: `${f.root}child`, target: f.root })}\n`,
  );
  // One byte per read includes splits inside UTF-8 code points and JSON tokens.
  for (const byte of bytes) {
    f.streams[0]?.enqueue(Uint8Array.of(byte));
    await flush();
  }
  expect(changes).toMatchObject([
    { id: "café", type: "Update", via: "sse", state: '"etag"' },
    { id: "next", type: "Add", target: f.root },
  ]);
  f.streams[1]?.enqueue(encode('{"type":"Update","object":"https://foreign.example/"}\n'));
  await flush();
  expect(changes).toHaveLength(2);
  expect(head).not.toHaveBeenCalled();
  await sub.close();
  await flush();
  expect(f.cancels).toHaveBeenCalledTimes(2);
  expect(f.timers.pending).toBe(0);
});

test("StreamingHTTP final unterminated record is delivered and EOF rediscovers and resyncs", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  const changes = vi.fn();
  const resync = vi.fn();
  sub.on("change", changes);
  sub.on("resync", resync);
  await f.timers.advanceBy(0);
  await f.timers.advanceBy(123);
  f.streams[0]?.enqueue(encode(JSON.stringify({ id: "last", type: "Update", object: f.root })));
  f.streams[0]?.close();
  await flush();
  expect(changes).toHaveBeenCalledTimes(1);
  expect(sub.state).toBe("degraded");
  f.service(`${f.root}replacement`);
  f.websocketService(`${f.root}new-websocket-subscribe`);
  await f.timers.advanceBy(1_000);
  expect(f.posts()[1]?.[0]).toBe(`${f.root}replacement`);
  expect(resync).toHaveBeenCalledExactlyOnceWith(new Date(123));
  await sub.close();
});

test.each([
  "error",
  "oversized",
  "utf8",
])("StreamingHTTP %s fails closed, releases streams and retries", async (mode) => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  const changes = vi.fn();
  sub.on("change", changes);
  await f.timers.advanceBy(0);
  if (mode === "error") f.streams[0]?.error(new Error("dropped"));
  if (mode === "oversized") f.streams[0]?.enqueue(encode("x".repeat(1_048_577)));
  if (mode === "utf8") f.streams[0]?.enqueue(Uint8Array.of(255));
  await flush();
  expect(sub.state).toBe("degraded");
  expect(changes).not.toHaveBeenCalled();
  await f.timers.advanceBy(1_000);
  expect(f.posts()).toHaveLength(2);
  await sub.close();
});

test.each([
  "message",
  "notification",
] as const)("LWS SSE handles %s events, filters envelopes and scopes, preserves native Last-Event-ID replay after a drop", async (eventType) => {
  const f = fixture("lws");
  const sub = await f.client.subscribe([f.root, f.root], { hot: [`${f.root}hot`] });
  const changes = vi.fn();
  const resync = vi.fn();
  sub.on("change", changes);
  sub.on("resync", resync);
  await f.timers.advanceBy(0);
  expect(JSON.parse(f.posts()[0]?.[1]?.body as string)).toEqual({
    "@context": ["https://www.w3.org/ns/lws/v1"],
    type: "https://jeswr.org/ns/solid-sd#SseSubscription",
    topic: [f.root, `${f.root}hot`],
    expires: "1970-01-02T00:00:00.000Z",
  });
  const source = f.sources[0] as FakeEventSource;
  source.open();
  await f.timers.advanceBy(123);
  const frame = {
    type: "Notification",
    storage: f.description,
    activity: [
      { id: "one", type: "Create", object: `${f.root}a` },
      { id: "two", type: "Delete", object: `${f.root}b` },
    ],
  };
  source.message(JSON.stringify({ ...frame, storage: f.root }), "0", eventType);
  source.message(JSON.stringify(frame), "event-1", eventType);
  expect(changes.mock.calls.map(([e]) => [e.type, e.via])).toEqual([
    ["Create", "sse"],
    ["Delete", "sse"],
  ]);
  // A recoverable native error must retain the source (and its browser-owned id buffer).
  expect(source.reconnect()).toEqual({ "Last-Event-ID": "event-1" });
  expect(sub.state).toBe("degraded");
  expect(f.timers.pending).toBe(0);
  source.message(
    JSON.stringify({ type: "Update", object: f.root }),
    "ignored-before-open",
    eventType,
  );
  source.reconnect();
  source.open();
  source.open();
  expect(sub.state).toBe("live");
  expect(f.sources).toHaveLength(1);
  expect(f.posts()).toHaveLength(1);
  expect(f.deletes()).toHaveLength(0);
  expect(resync).toHaveBeenCalledExactlyOnceWith(new Date(123));
  source.message(JSON.stringify(frame), "event-1", eventType); // Replay is deduped.
  expect(changes).toHaveBeenCalledTimes(2);
  source.message("malformed", "", eventType); // Empty id resets the native replay cursor.
  expect(source.reconnect()).toEqual({});
  source.open();
  f.websocketService(`${f.root}new-websocket-subscribe`);
  f.service(`${f.root}replacement`);
  source.close(); // Terminal close mints a fresh subscription.
  await f.timers.advanceBy(1_000);
  expect(f.posts()[1]?.[0]).toBe(`${f.root}replacement`);
  expect(f.sources).toHaveLength(2);
  expect(source.listenerCount).toBe(0);
  expect(f.deletes()).toHaveLength(1);
  f.sources[1]?.open();
  await sub.close();
  expect(f.deletes()).toHaveLength(2);
  expect(f.sources[1]?.listenerCount).toBe(0);
  source.message(JSON.stringify({ type: "Update", object: f.root }), "late", eventType);
  expect(changes).toHaveBeenCalledTimes(2);
});

test("NSS Updates-Via opens solid-0.1, sends sub per unique topic, accepts only exact scoped pub frames", async () => {
  const f = fixture("legacy");
  const sub = await f.client.subscribe([f.root, f.root], { hot: [`${f.root}hot`] });
  const changes = vi.fn();
  const resync = vi.fn();
  sub.on("change", changes);
  sub.on("resync", resync);
  await f.timers.advanceBy(0);
  const socket = f.sockets[0] as FakeWebSocket;
  expect(socket.protocols).toEqual(["solid-0.1"]);
  expect(sub.channel).toBe("legacy-ws");
  socket.open();
  socket.open();
  expect(socket.sent).toEqual([`sub ${f.root}`, `sub ${f.root}hot`]);
  for (const data of [
    "protocol solid-0.1",
    `pub ${f.root}not-subscribed`,
    "pub https://foreign.example/",
    `pub ${f.root} extra`,
    `pub ${f.root}\nsub https://foreign.example/`,
    `pub https://user:pass@pod.example/alice/`,
    "{bad",
    2,
  ])
    socket.message(data);
  expect(changes).not.toHaveBeenCalled();
  await f.timers.advanceBy(123);
  socket.message(`pub ${f.root}`);
  expect(changes).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "Update",
      object: f.root,
      via: "legacy-ws",
      raw: `pub ${f.root}`,
    }),
  );
  socket.error();
  f.socketUrl("wss://pod.example/replacement");
  await f.timers.advanceBy(1_000);
  expect(f.sockets[1]?.url).toBe("wss://pod.example/replacement");
  f.sockets[1]?.open();
  expect(resync).toHaveBeenCalledExactlyOnceWith(new Date(123));
  expect(f.posts()).toHaveLength(0);
  await sub.close();
  expect(f.timers.pending).toBe(0);
});

test("legacy send failures degrade and clean socket listeners", async () => {
  const f = fixture("legacy");
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  const socket = f.sockets[0] as FakeWebSocket;
  vi.spyOn(socket, "send").mockImplementationOnce(() => {
    throw new Error("send failed");
  });
  socket.open();
  expect(sub.state).toBe("degraded");
  expect(socket.listenerCount).toBe(0);
  await sub.close();
});

test.each([
  "stream",
  "lws",
  "legacy",
] as const)("%s refuses insecure/foreign receivers, credentials, fragments and port changes", async (kind) => {
  for (const url of [
    "https://foreign.example/receive",
    "http://pod.example/receive",
    "https://pod.example:99/receive",
    "https://user:pass@pod.example/receive",
    "https://pod.example/receive#frag",
    "https://pod.example/rec\neive",
  ]) {
    const f = fixture(kind);
    if (kind === "legacy") f.socketUrl(url.replace(/^http/, "ws"));
    else f.channel({ receiveFrom: url });
    const sub = await f.client.subscribe([f.root]);
    await f.timers.advanceBy(0);
    expect(sub.state).toBe("degraded");
    expect(f.sources).toHaveLength(0);
    expect(f.sockets).toHaveLength(0);
    expect(f.streams).toHaveLength(0);
    await sub.close();
  }
});

test.each([
  "stream",
  "lws",
  "legacy",
] as const)("%s cancellation/offline ignores queued callbacks and releases all resources", async (kind) => {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("addEventListener", (type: string, fn: () => void) => {
    listeners.set(type, fn);
  });
  vi.stubGlobal("removeEventListener", (type: string) => {
    listeners.delete(type);
  });
  const nav = { onLine: true };
  vi.stubGlobal("navigator", nav);
  const f = fixture(kind);
  const abort = new AbortController();
  const spy = vi.spyOn(FakeEventSource.prototype, "addEventListener");
  const sub = await f.client.subscribe([f.root], { signal: abort.signal });
  await f.timers.advanceBy(0);
  const callbacks = [...spy.mock.calls];
  nav.onLine = false;
  listeners.get("offline")?.();
  expect(sub.state).toBe("degraded");
  expect(f.timers.pending).toBe(0);
  nav.onLine = true;
  listeners.get("online")?.();
  await f.timers.advanceBy(0);
  abort.abort();
  await sub.close();
  await flush();
  for (const [type, fn] of callbacks)
    (fn as (e: TransportEvents[typeof type]) => void)({ data: "{}" } as never);
  expect(sub.state).toBe("closed");
  expect(listeners.size).toBe(0);
  expect(f.timers.pending).toBe(0);
});

test.each(["stream", "lws"] as const)("%s subscription 403 is terminal forbidden", async (kind) => {
  const f = fixture(kind);
  f.status(403);
  const sub = await f.client.subscribe([f.root]);
  const states = vi.fn();
  sub.on("state", states);
  await f.timers.advanceBy(0);
  expect(states).toHaveBeenLastCalledWith("closed", "forbidden");
  expect(f.timers.pending).toBe(0);
  await sub.close();
});

test("low-level channels reject protocol mismatch, empty/foreign topics and legacy frame injection", () => {
  const f = fixture();
  expect(() => createLwsSseChannel({ ...f.deps, topics: [f.root] })).toThrow();
  expect(() => createStreamingHttpChannel({ ...f.deps, topics: [] })).toThrow();
  expect(() =>
    createLegacyWebSocketChannel({ ...f.deps, topics: ["https://foreign.example/"] }),
  ).toThrow();
  vi.spyOn(f.storage, "isWithinStorage").mockReturnValue(true);
  expect(() =>
    createLegacyWebSocketChannel({
      ...f.deps,
      topics: [`${f.root}\nsub https://foreign.example/`],
    }),
  ).toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
});

test("default native EventSource factory retains its source and closes explicitly", async () => {
  const f = fixture("lws");
  const sources: FakeEventSource[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    },
  );
  const sub = createLwsSseChannel({ ...f.deps, topics: [f.root], eventSourceFactory: undefined });
  await f.timers.advanceBy(0);
  sources[0]?.reconnect(); // Recoverable initial connection failure.
  expect(sub.state).toBe("degraded");
  sources[0]?.open();
  expect(sub.state).toBe("live");
  await sub.close();
  expect(sources[0]?.readyState).toBe(2);
});

test.each([
  false,
  true,
])("a late StreamingHTTP response with body=%s is cancelled without becoming live", async (body) => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  f.fetch.mockImplementation((input, init) => {
    if (String(input).startsWith(`${f.root}stream-`)) {
      entered.resolve();
      return response.promise;
    }
    return base(input, init);
  });
  const sub = await f.client.subscribe([f.root]);
  const tick = f.timers.advanceBy(0);
  await entered.promise;
  await sub.close();
  const cancel = vi.fn();
  response.resolve(new Response(body ? new ReadableStream({ cancel }) : null));
  await tick;
  expect(cancel).toHaveBeenCalledTimes(body ? 1 : 0);
  expect(sub.state).toBe("closed");
  expect(f.timers.pending).toBe(0);
});

test.each([
  "403",
  "500",
  "empty",
  "redirect",
])("StreamingHTTP receive %s cannot become live", async (mode) => {
  const f = fixture();
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  f.fetch.mockImplementation(async (input, init) => {
    if (!String(input).startsWith(`${f.root}stream-`)) return base(input, init);
    const response = new Response(null, {
      status: mode === "403" ? 403 : mode === "500" ? 500 : 200,
    });
    if (mode === "redirect") Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  const sub = await f.client.subscribe([f.root]);
  const states = vi.fn();
  sub.on("state", states);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe(mode === "403" ? "closed" : "degraded");
  if (mode === "403") expect(states).toHaveBeenLastCalledWith("closed", "forbidden");
  await sub.close();
  expect(f.timers.pending).toBe(0);
});

test("a stream observer can close at live or mid-chunk without leaking another topic/request", async () => {
  for (const stage of ["live", "change"]) {
    const f = fixture();
    const sub = await f.client.subscribe([f.root, `${f.root}hot`]);
    const changes = vi.fn(() => {
      void sub.close();
    });
    if (stage === "live")
      sub.on("state", (state) => {
        if (state === "live") void sub.close();
      });
    else sub.on("change", changes);
    await f.timers.advanceBy(0);
    if (stage === "change") {
      f.streams[0]?.enqueue(
        encode(
          `${JSON.stringify({ id: "first", type: "Update", object: f.root })}\n${JSON.stringify({ id: "second", type: "Update", object: f.root })}\n`,
        ),
      );
      await flush();
      expect(changes).toHaveBeenCalledTimes(1);
    }
    await sub.close();
    await flush();
    expect(sub.state).toBe("closed");
    expect(f.cancels).toHaveBeenCalledTimes(2);
    expect(f.timers.pending).toBe(0);
  }
});

test("a rejected stream read queued before close cannot schedule reconnection", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  f.streams[0]?.error(new Error("dropped"));
  await sub.close();
  await flush();
  expect(f.timers.pending).toBe(0);
  expect(sub.state).toBe("closed");
});

test.each([
  "throw",
  "reject",
])("StreamingHTTP cancellation %s still releases sibling streams and listeners", async (failure) => {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
    const handlers = listeners.get(type) ?? new Set();
    handlers.add(handler);
    listeners.set(type, handlers);
  });
  vi.stubGlobal("removeEventListener", (type: string, handler: () => void) => {
    listeners.get(type)?.delete(handler);
  });
  const f = fixture();
  const abort = new AbortController();
  const removeAbort = vi.spyOn(abort.signal, "removeEventListener");
  const sub = await f.client.subscribe([f.root, `${f.root}hot`], { signal: abort.signal });
  await f.timers.advanceBy(0);
  const error = new Error("reader cancellation failed");
  const cancel = ReadableStreamDefaultReader.prototype.cancel;
  const cancellation = Promise.withResolvers<void>();
  vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel").mockImplementationOnce(function (
    this: ReadableStreamDefaultReader<Uint8Array>,
  ) {
    void cancel.call(this);
    if (failure === "throw") throw error;
    return cancellation.promise;
  });
  const waiting = sub[Symbol.asyncIterator]().next();
  const close = sub.close();
  if (failure === "reject") cancellation.reject(error);
  await close;
  expect(sub.close()).toBe(close);
  expect(await waiting).toEqual({ done: true, value: undefined });
  expect(f.cancels).toHaveBeenCalledTimes(2);
  expect([...listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
  expect(removeAbort).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function));
  expect(f.timers.pending).toBe(0);
});
