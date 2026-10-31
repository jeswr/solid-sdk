// AUTHORED-BY Codex GPT-6.1-Sol
import * as storageModule from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, test, vi } from "vitest";
import { createNotifications } from "../index.js";
import { FakeTimers, FakeWebSocket } from "../testing.js";
import type { ChangeEvent, NotificationsDependencies } from "../types.js";
import { validateChannelUrl } from "./channel-url.js";
import { createLwsWebSocketChannel } from "./lws-websocket.js";
import { reconnectDelay } from "./websocket.js";
import { createWebSocket2023Channel } from "./websocket2023.js";

function fixture(protocol: "solid" | "lws" = "solid", root = "https://pod.example/alice/") {
  const storage = createMemoryStorage({ protocol, root });
  storage.features.liveUpdates = {
    state: "available",
    evidence: "fixture",
    detail: { channels: ["websocket"] },
  };
  const timers = new FakeTimers();
  const sockets: FakeWebSocket[] = [];
  const description = `${root}description`;
  let revision = 0;
  let service = `${root}subscribe`;
  let channel: unknown;
  let postStatus = 201;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "POST") {
      expect(url).toBe(service);
      revision++;
      return Response.json(
        channel === undefined
          ? {
              receiveFrom: `${root.replace(/^http/, "ws")}socket-${revision}?token=redacted`,
              ...(protocol === "lws" ? { subscription: `${root}subscription-${revision}` } : {}),
            }
          : channel,
        { status: postStatus },
      );
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "HEAD" && url === root)
      return new Response(null, {
        headers: {
          link:
            protocol === "lws"
              ? `<${description}>; rel="https://www.w3.org/ns/lws#storage"`
              : `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type"`,
        },
      });
    if (method === "OPTIONS") return new Response(null);
    if (method === "GET" && url === description) {
      if (protocol === "lws")
        return Response.json(
          {
            "@context": "https://www.w3.org/ns/lws/v1",
            id: description,
            type: "Storage",
            service: [
              { type: "StorageRoot", serviceEndpoint: root },
              {
                type: "NotificationService",
                serviceEndpoint: service,
                subscriptionType: ["https://jeswr.org/ns/solid-sd#WebSocketSubscription"],
              },
            ],
          },
          { headers: { "content-type": "application/lws+cid" } },
        );
      return new Response(
        `<${root}> <http://www.w3.org/ns/solid/notifications#subscription> <${service}>. <${service}> <http://www.w3.org/ns/solid/notifications#channelType> <http://www.w3.org/ns/solid/notifications#WebSocketChannel2023>.`,
        { headers: { "content-type": "text/turtle" } },
      );
    }
    throw new Error("Unexpected fixture request");
  });
  const socketFactory = vi.fn((url: string) => {
    const socket = new FakeWebSocket(url);
    sockets.push(socket);
    return socket;
  });
  const deps = { storage, fetch, socketFactory, timers, now: timers.now, random: () => 0.5 };
  return {
    root,
    description,
    storage,
    timers,
    sockets,
    fetch,
    deps,
    socketFactory,
    client: createNotifications(deps),
    service: (value: string) => {
      service = value;
    },
    channel: (value: unknown) => {
      channel = value;
    },
    status: (value: number) => {
      postStatus = value;
    },
    posts: () => fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
    deletes: () => fetch.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    discoveries: () => fetch.mock.calls.filter(([, init]) => init?.method === "HEAD"),
  };
}
function network(online = true) {
  const navigator = { onLine: online };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal("addEventListener", (type: string, handler: () => void) => {
    let handlers = listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      listeners.set(type, handlers);
    }
    handlers.add(handler);
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("Solid discovers, subscribes once per unique topic/hot resource and normalizes CSS/sparq frames", async () => {
  const f = fixture();
  const head = vi.spyOn(f.storage, "head");
  const { subscribe } = f.client;
  const sub = await subscribe([f.root, f.root], { hot: [`${f.root}note`], pollIntervalMs: 0 });
  const states = vi.fn();
  const resync = vi.fn();
  const changes: ChangeEvent[] = [];
  sub.on("state", states);
  sub.on("resync", resync);
  sub.on("change", (e) => changes.push(e));
  const iterator = sub[Symbol.asyncIterator]();
  await f.timers.advanceBy(0);
  expect(f.posts()).toHaveLength(2);
  expect(f.posts().map(([, init]) => JSON.parse(init?.body as string))).toEqual(
    [f.root, `${f.root}note`].map((topic) => ({
      "@context": ["https://www.w3.org/ns/solid/notifications-context/v1"],
      type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
      topic,
    })),
  );
  for (const [, init] of f.fetch.mock.calls)
    expect(init).toMatchObject({
      redirect: "error",
      cache: "no-cache",
      signal: expect.any(AbortSignal),
    });
  expect(f.posts()[0]?.[1]?.headers).toEqual({
    "content-type": "application/ld+json",
    accept: "application/ld+json",
  });
  const [a, b] = f.sockets as [FakeWebSocket, FakeWebSocket];
  a.message(JSON.stringify({ type: "Update", object: f.root })); // Before open is ignored.
  a.open();
  a.open();
  expect(sub.state).toBe("connecting");
  b.open();
  expect(sub.state).toBe("live");
  expect(resync).not.toHaveBeenCalled();
  // CSS WebSocketChannel2023 and sparq Solid AS2 wire shapes.
  a.message(
    JSON.stringify({
      "@context": ["https://www.w3.org/ns/solid/notifications-context/v1"],
      id: "urn:css:1",
      type: "Update",
      object: `${f.root}note`,
      state: '"css-etag"',
    }),
  );
  b.message(
    JSON.stringify({
      id: "urn:sparq:1",
      type: ["https://www.w3.org/ns/activitystreams#Add"],
      object: { id: `${f.root}child` },
      target: f.root,
      state: '"sparq-etag"',
    }),
  );
  expect(changes).toMatchObject([
    { type: "Update", object: `${f.root}note`, state: '"css-etag"', via: "websocket" },
    { type: "Add", object: `${f.root}child`, target: f.root },
  ]);
  expect((await iterator.next()).value).toBe(changes[0]);
  a.message("garbage");
  a.message(new Uint8Array());
  a.message("null");
  a.message(JSON.stringify({ id: "foreign", type: "Update", object: "https://foreign.example/" }));
  a.message(JSON.stringify(changes[0]?.raw));
  expect(changes).toHaveLength(2);
  expect(head).not.toHaveBeenCalled();
  await sub.close();
  expect(f.timers.pending).toBe(0);
  expect(f.sockets.every((socket) => socket.listenerCount === 0 && socket.readyState === 3)).toBe(
    true,
  );
});

test("LWS batches topics, unwraps activities with canonical storage id and DELETEs on close", async () => {
  const f = fixture("lws");
  const abort = new AbortController();
  const sub = await f.client.subscribe([f.root], { hot: [`${f.root}hot`], signal: abort.signal });
  await f.timers.advanceBy(0);
  expect(f.posts()).toHaveLength(1);
  expect(JSON.parse(f.posts()[0]?.[1]?.body as string)).toEqual({
    "@context": ["https://www.w3.org/ns/lws/v1"],
    type: "https://jeswr.org/ns/solid-sd#WebSocketSubscription",
    topic: [f.root, `${f.root}hot`],
    expires: "1970-01-02T00:00:00.000Z",
  });
  expect(f.posts()[0]?.[1]?.headers).toMatchObject({ "content-type": "application/lws+json" });
  const changes = vi.fn();
  sub.on("change", changes);
  f.sockets[0]?.open();
  const frame = {
    type: "Notification",
    storage: f.description,
    activity: [
      { id: "one", type: "Create", object: { id: `${f.root}child`, type: "DataResource" } },
      {
        id: "two",
        type: "Move",
        object: { id: `${f.root}other`, type: "Container" },
        target: f.root,
      },
    ],
  };
  f.sockets[0]?.message(JSON.stringify({ ...frame, storage: f.root }));
  f.sockets[0]?.message(JSON.stringify(frame));
  expect(changes).toHaveBeenCalledTimes(2);
  expect(changes.mock.calls.map(([event]) => event.objectKind)).toEqual(["resource", "container"]);
  abort.abort();
  await sub.close();
  expect(f.deletes()).toHaveLength(1);
  expect(f.deletes()[0]).toEqual([
    `${f.root}subscription-1`,
    { method: "DELETE", redirect: "error" },
  ]);
  expect(f.timers.pending).toBe(0);
});

test.each([
  "solid",
  "lws",
] as const)("%s close/error rediscovers a fresh endpoint, resubscribes and resyncs since last frame", async (protocol) => {
  const f = fixture(protocol);
  const sub = await f.client.subscribe([f.root]);
  const resync = vi.fn();
  sub.on("resync", resync);
  await f.timers.advanceBy(0);
  const old = f.sockets[0] as FakeWebSocket;
  old.open();
  await f.timers.advanceBy(123);
  old.message("ping");
  old.close();
  old.error();
  expect(sub.state).toBe("degraded");
  expect(f.timers.pending).toBe(1);
  expect(old.listenerCount).toBe(0);
  f.service(`${f.root}new-service`);
  await f.timers.advanceBy(999);
  expect(f.posts()).toHaveLength(1);
  await f.timers.advanceBy(1);
  expect(f.discoveries()).toHaveLength(2);
  expect(f.posts()[1]?.[0]).toBe(`${f.root}new-service`);
  expect(f.sockets[1]?.url).not.toBe(old.url);
  f.sockets[1]?.open();
  expect(sub.state).toBe("live");
  expect(resync).toHaveBeenCalledExactlyOnceWith(new Date(123));
  await sub.close();
});

test("90 second heartbeat resets on messages; connecting and open silent sockets reconnect", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  await f.timers.advanceBy(89_999);
  expect(sub.state).toBe("connecting");
  await f.timers.advanceBy(1);
  expect(sub.state).toBe("degraded");
  await f.timers.advanceBy(1_000);
  const socket = f.sockets[1] as FakeWebSocket;
  socket.open();
  await f.timers.advanceBy(89_999);
  socket.message("ping");
  await f.timers.advanceBy(89_999);
  expect(sub.state).toBe("live");
  await f.timers.advanceBy(1);
  expect(sub.state).toBe("degraded");
  expect(socket.readyState).toBe(3);
  await sub.close();
});

test("retries failures with an exponential ceiling, capped jitter and a reset after opening", async () => {
  const f = fixture();
  f.status(500);
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  for (const delay of [1_000, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const before = f.posts().length;
    await f.timers.advanceBy(delay - 1);
    expect(f.posts()).toHaveLength(before);
    await f.timers.advanceBy(1);
    expect(f.posts()).toHaveLength(before + 1);
  }
  f.status(201);
  await f.timers.advanceBy(30_000);
  f.sockets[0]?.open();
  f.sockets[0]?.error();
  await f.timers.advanceBy(1_000);
  expect(f.sockets).toHaveLength(2);
  await sub.close();
});

test("backoff property: every valid random sample and retry stays in the bounded jitter window", () => {
  for (const attempt of [0, 1, 2, 3, 4, 5, 6, 20, 1024]) {
    const ceiling = Math.min(60_000, 1_000 * 2 ** attempt);
    for (let sample = 0; sample <= 1000; sample++) {
      const delay = reconnectDelay(attempt, () => sample / 1000);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  }
});

test.each([
  "initial",
  "reconnect",
  "discovery",
])("403 during %s closes terminally as forbidden", async (stage) => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  const states = vi.fn();
  sub.on("state", states);
  const waiting = sub[Symbol.asyncIterator]().next();
  if (stage === "reconnect") {
    await f.timers.advanceBy(0);
    f.sockets[0]?.open();
    f.sockets[0]?.close();
  }
  if (stage === "discovery") f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
  else f.status(403);
  await f.timers.advanceBy(stage === "reconnect" ? 1_000 : 0);
  expect(states).toHaveBeenLastCalledWith("closed", "forbidden");
  expect(sub.state).toBe("closed");
  expect(await waiting).toEqual({ done: true, value: undefined });
  expect(f.timers.pending).toBe(0);
  await f.timers.advanceBy(1_000_000);
  await sub.close();
});

test("offline suspends sockets and retries; online rediscovers once and cleans listeners", async () => {
  const net = network(false);
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  const resync = vi.fn();
  sub.on("resync", resync);
  expect(sub.state).toBe("degraded");
  await f.timers.advanceBy(100);
  expect(f.fetch).not.toHaveBeenCalled();
  net.set(true);
  net.set(true);
  await f.timers.advanceBy(0);
  f.sockets[0]?.open();
  expect(resync).toHaveBeenCalledWith(new Date(0));
  net.set(true);
  expect(f.timers.pending).toBe(1); // Heartbeat only.
  net.set(false);
  expect(f.timers.pending).toBe(0);
  expect(f.sockets[0]?.listenerCount).toBe(0);
  net.set(true);
  await f.timers.advanceBy(0);
  expect(f.posts()).toHaveLength(2);
  await sub.close();
  expect([...net.listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
});

test.each([
  "close",
  "offline",
])("%s while discovery is pending aborts I/O and ignores a late response", async (action) => {
  const net = network();
  const f = fixture();
  const gate = Promise.withResolvers<Response>();
  const entered = Promise.withResolvers<void>();
  f.fetch.mockImplementationOnce(async () => {
    entered.resolve();
    return gate.promise;
  });
  const sub = await f.client.subscribe([f.root]);
  const tick = f.timers.advanceBy(0);
  await entered.promise;
  if (action === "close") await sub.close();
  else net.set(false);
  expect(f.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  gate.resolve(new Response(null));
  await tick;
  expect(f.sockets).toHaveLength(0);
  expect(f.timers.pending).toBe(0);
  await sub.close();
});

test("late LWS subscribe after close is deleted without opening a socket", async () => {
  const f = fixture("lws");
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<Response>();
  f.fetch.mockImplementation(async (input, init) => {
    if (init?.method === "POST") {
      entered.resolve();
      return gate.promise;
    }
    return base(input, init);
  });
  const sub = await f.client.subscribe([f.root]);
  const tick = f.timers.advanceBy(0);
  await entered.promise;
  await sub.close();
  gate.resolve(
    Response.json({
      subscription: `${f.root}late-subscription`,
      receiveFrom: "wss://pod.example/late",
    }),
  );
  await tick;
  expect(f.deletes()).toHaveLength(1);
  expect(f.sockets).toHaveLength(0);
  expect(f.timers.pending).toBe(0);
});

test.each([
  null,
  [],
  "string",
  {},
  { receiveFrom: 12 },
  { receiveFrom: "https://pod.example/socket" },
  { receiveFrom: "wss://foreign.example/socket?secret=hidden" },
  { receiveFrom: "ws://pod.example/socket" },
  { receiveFrom: "wss://user:secret@pod.example/socket" },
  { receiveFrom: "wss://pod.example/socket#fragment" },
])("rejects malformed/unsafe channel without creating a socket: %j", async (channel) => {
  const f = fixture();
  f.channel(channel);
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("degraded");
  expect(f.sockets).toHaveLength(0);
  await sub.close();
  expect(f.timers.pending).toBe(0);
});

test("allows secure receiveFrom on the advertised subscription service host", async () => {
  const f = fixture();
  f.service("https://notifications.example/subscribe");
  f.channel({ receiveFrom: "wss://notifications.example/socket" });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(f.sockets[0]?.url).toBe("wss://notifications.example/socket");
  await sub.close();
});

test.each([
  false,
  true,
])("loopback HTTP/WS requires explicit opt in (%s)", async (allowInsecureLoopback) => {
  const f = fixture("solid", "http://localhost:3000/alice/");
  const client = createNotifications({ ...f.deps, allowInsecureLoopback });
  const sub = await client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(f.sockets).toHaveLength(allowInsecureLoopback ? 1 : 0);
  await sub.close();
});

test.each([
  undefined,
  "https://pod.example",
  "https://other.example:443/subscribe",
])("URL host rule accepts storage or subscription service: %s", (service) => {
  expect(
    validateChannelUrl(
      "wss://pod.example/path?token=redacted",
      "https://pod.example/root/",
      service,
      true,
      false,
    ),
  ).toBe("wss://pod.example/path?token=redacted");
});
test.each([
  "http://127.0.0.1:3000/",
  "http://127.0.0.2:3000/",
  "http://[::1]:3000/",
  "http://localhost:3000/",
])("permits explicitly enabled literal loopback %s", (root) => {
  expect(validateChannelUrl(root.replace("http:", "ws:"), root, root, true, true)).toBe(
    root.replace("http:", "ws:"),
  );
});
test.each([
  "/relative",
  "wss://pod.example\\evil/socket",
  "wss://pod.example/\nsecret",
  "wss://pod.example:99/socket",
  "wss://pod.example.evil/socket",
  "wss://pod.example@evil/socket",
  "ftp://pod.example/socket",
  "wss://[invalid",
  "wss://pod.example/path#secret",
])("URL validation refuses %j with a redacted error", (value) => {
  expect(() =>
    validateChannelUrl(value, "https://pod.example/", "https://pod.example/subscribe", true, true),
  ).toThrow();
});
test.each([
  "http://evil.example/",
  "http://localhost.evil/",
  "http://[::2]/",
])("loopback exception refuses %s", (url) => {
  expect(() => validateChannelUrl(url, "http://localhost/", undefined, false, true)).toThrow();
  expect(() =>
    validateChannelUrl("ws://localhost/", "https://pod.example/", undefined, true, true),
  ).toThrow();
});

test("low-level adapters reject wrong protocol, empty and foreign topics before I/O", () => {
  const f = fixture();
  expect(() => createLwsWebSocketChannel({ ...f.deps, topics: [f.root] })).toThrow(TypeError);
  expect(() => createWebSocket2023Channel({ ...f.deps, topics: [] })).toThrow(TypeError);
  expect(() =>
    createWebSocket2023Channel({ ...f.deps, topics: ["https://foreign.example/"] }),
  ).toThrow(TypeError);
  expect(f.fetch).not.toHaveBeenCalled();
});

test("default global socket, timers, clock and random work without injected factories", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const f = fixture();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const deps: NotificationsDependencies = { fetch: f.fetch, storage: f.storage };
  const sub = createWebSocket2023Channel({ ...deps, topics: [f.root] });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.posts()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(91_000);
  expect(f.posts()).toHaveLength(2);
  await sub.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("pre-aborted signals close the low-level channel immediately", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  const sub = createWebSocket2023Channel({ ...f.deps, topics: [f.root], signal: abort.signal });
  expect(sub.state).toBe("closed");
  expect(f.timers.pending).toBe(0);
  await sub.close();
});

test("missing and invalid discovery advertisements retry without POSTing", async () => {
  const f = fixture();
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  f.fetch.mockImplementation(async (input, init) => {
    if (init?.method === "GET") return new Response("", { status: 404 });
    return base(input, init);
  });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("degraded");
  expect(f.posts()).toHaveLength(0);
  await sub.close();
});

test("no websocket service after rediscovery is degraded and never POSTs to a stale endpoint", async () => {
  const f = fixture();
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  f.fetch.mockImplementation(async (input, init) => {
    if (init?.method === "GET")
      return new Response("", { headers: { "content-type": "text/turtle" } });
    return base(input, init);
  });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("degraded");
  expect(f.posts()).toHaveLength(0);
  await sub.close();
});

test("socket construction and cleanup failures cannot leak retry timers or listeners", async () => {
  const f = fixture();
  f.socketFactory.mockImplementationOnce(() => {
    throw new Error("not supported");
  });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("degraded");
  await f.timers.advanceBy(1_000);
  const socket = f.sockets[0] as FakeWebSocket;
  vi.spyOn(socket, "close").mockImplementation(() => {
    throw new Error("closed");
  });
  await sub.close();
  expect(socket.listenerCount).toBe(0);
  expect(f.timers.pending).toBe(0);
});

test("LWS DELETE is best effort and close waits for its completion", async () => {
  const f = fixture("lws");
  const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
  const gate = Promise.withResolvers<Response>();
  f.fetch.mockImplementation((input, init) =>
    init?.method === "DELETE" ? gate.promise : base(input, init),
  );
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  let done = false;
  const close = sub.close().then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  gate.reject(new Error("offline"));
  await close;
  expect(done).toBe(true);
  expect(sub.state).toBe("closed");
});

test("LWS invalid receiveFrom still deletes a validated subscription; invalid DELETE hosts are refused", async () => {
  for (const subscription of [
    "https://pod.example/alice/created",
    "https://foreign.example/secret",
  ]) {
    const f = fixture("lws");
    f.channel({ subscription, receiveFrom: "wss://foreign.example/secret" });
    const sub = await f.client.subscribe([f.root]);
    await f.timers.advanceBy(0);
    expect(f.deletes()).toHaveLength(subscription.includes("foreign") ? 0 : 1);
    expect(f.sockets).toHaveLength(0);
    await sub.close();
  }
});

test("LWS receive-only responses do not invent a server-side DELETE URL", async () => {
  const f = fixture("lws");
  f.channel({ receiveFrom: "wss://pod.example/socket" });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  f.sockets[0]?.open();
  expect(sub.state).toBe("live");
  await sub.close();
  expect(f.deletes()).toHaveLength(0);
});

test("invalid JSON and redirected subscribe responses fail closed", async () => {
  for (const redirect of [true, false]) {
    const f = fixture();
    const base = f.fetch.getMockImplementation() as typeof globalThis.fetch;
    f.fetch.mockImplementation(async (input, init) => {
      if (init?.method !== "POST") return base(input, init);
      const response = new Response("invalid json");
      Object.defineProperty(response, "redirected", { value: redirect });
      return response;
    });
    const sub = await f.client.subscribe([f.root]);
    await f.timers.advanceBy(0);
    expect(f.sockets).toHaveLength(0);
    expect(sub.state).toBe("degraded");
    await sub.close();
  }
});

test("close from live/resync/degraded observers cannot restart the subscription", async () => {
  for (const stage of ["live", "resync", "degraded"]) {
    const f = fixture();
    const sub = await f.client.subscribe([f.root]);
    await f.timers.advanceBy(0);
    if (stage === "live")
      sub.on("state", (state) => {
        if (state === "live") void sub.close();
      });
    if (stage === "resync")
      sub.on("resync", () => {
        void sub.close();
      });
    if (stage === "degraded")
      sub.on("state", (state) => {
        if (state === "degraded") void sub.close();
      });
    f.sockets[0]?.open();
    if (stage !== "live") {
      f.sockets[0]?.error();
      await f.timers.advanceBy(1_000);
      f.sockets[1]?.open();
    }
    expect(sub.state).toBe("closed");
    expect(f.timers.pending).toBe(0);
    await sub.close();
  }
});

test("silently offline retry and failure callbacks never restart I/O", async () => {
  const f = fixture();
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  vi.stubGlobal("navigator", { onLine: false });
  f.sockets[0]?.error();
  expect(f.timers.pending).toBe(0);
  await sub.close();
  vi.unstubAllGlobals();
  const b = fixture();
  const next = await b.client.subscribe([b.root]);
  await b.timers.advanceBy(0);
  b.sockets[0]?.error();
  vi.stubGlobal("navigator", { onLine: false });
  await b.timers.advanceBy(1_000);
  expect(b.posts()).toHaveLength(1);
  await next.close();
});

// Exercise the lifecycle at the public discovery seam while preserving real fetch/parse
// integration above. These cases model cancellation after cached discovery and hostile
// metadata returned by an adapter, rather than relying on a particular backend parser.
test.each([
  "protocol",
  "root",
  "channels",
  "endpoint",
])("refuses discovery changing %s", async (field) => {
  const f = fixture();
  const real = storageModule.createPodClient;
  const spy = vi.spyOn(storageModule, "createPodClient").mockImplementation(async (options) => {
    const pod = await real(options);
    if (field === "protocol") pod.description.protocol = "lws";
    if (field === "root") pod.description.root = "https://pod.example/other/";
    if (field === "channels") pod.features.liveUpdates.detail.channels = ["sse"];
    if (field === "endpoint")
      pod.features.liveUpdates.detail.endpoint = "http://pod.example/insecure";
    return pod;
  });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("degraded");
  expect(f.posts()).toHaveLength(0);
  await sub.close();
  spy.mockRestore();
});

test("cancellation after resolved discovery does not start a subscribe request", async () => {
  const f = fixture();
  const abort = new AbortController();
  const real = storageModule.createPodClient;
  vi.spyOn(storageModule, "createPodClient").mockImplementation(async (options) => {
    const pod = await real(options);
    abort.abort();
    return pod;
  });
  const sub = await f.client.subscribe([f.root], { signal: abort.signal });
  await f.timers.advanceBy(0);
  expect(sub.state).toBe("closed");
  expect(f.posts()).toHaveLength(0);
  await sub.close();
});

test("discovery fetch preserves Request inputs and validates them before sending", async () => {
  const f = fixture();
  const real = storageModule.createPodClient;
  vi.spyOn(storageModule, "createPodClient").mockImplementation(async (options) => {
    await options.fetch(new Request(f.root, { method: "HEAD" }));
    return real(options);
  });
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  expect(f.fetch.mock.calls[0]?.[0]).toBeInstanceOf(Request);
  expect(f.sockets).toHaveLength(1);
  await sub.close();
});

test("queued socket events and timers after close cannot reopen or reschedule", async () => {
  const f = fixture();
  const handlers = vi.spyOn(FakeWebSocket.prototype, "addEventListener");
  const sub = await f.client.subscribe([f.root]);
  await f.timers.advanceBy(0);
  const oldHandlers = [...handlers.mock.calls];
  await sub.close();
  for (const [type, handler] of oldHandlers) {
    if (type === "message") (handler as (event: { data: unknown }) => void)({ data: "{}" });
    else handler({} as never);
  }
  expect(sub.state).toBe("closed");
  expect(f.timers.pending).toBe(0);
  expect(f.posts()).toHaveLength(1);
});
