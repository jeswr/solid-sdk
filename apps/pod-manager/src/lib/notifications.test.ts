// AUTHORED-BY Codex GPT-6.1-Sol
import { FakeEventSource, FakeWebSocket } from "@jeswr/pod-notifications/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeToResource } from "./notifications";

let sequence = 0;
function lwsServer(transport: "websocket" | "sse" = "websocket") {
  const root = `https://manager-${++sequence}.example/pod/`;
  const description = `${root}description`;
  const sockets: FakeWebSocket[] = [];
  const sources: FakeEventSource[] = [];
  let service = `${root}subscribe`;
  const doFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (init?.method === "POST")
      return Response.json({
        receiveFrom:
          transport === "sse" ? `${root}stream` : root.replace("https:", "wss:") + "socket",
        subscription: `${root}subscription`,
      });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (url === description)
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
              subscriptionType: [
                `https://jeswr.org/ns/solid-sd#${transport === "sse" ? "SseSubscription" : "WebSocketSubscription"}`,
              ],
            },
          ],
        },
        { headers: { "content-type": "application/lws+cid" } },
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  class Socket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  }
  class Source extends FakeEventSource {
    constructor(url: string) {
      super(url);
      sources.push(this);
    }
  }
  vi.stubGlobal("EventSource", Source);
  return {
    root,
    description,
    doFetch,
    sockets,
    sources,
    foreignService: () => {
      service = "https://foreign.example/subscribe";
    },
    start: (onChange = vi.fn()) =>
      subscribeToResource(root, onChange, {
        fetchImpl: doFetch,
        webSocketImpl: Socket as unknown as typeof WebSocket,
      }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses LWS SSE and refreshes after native reconnect without replacing its replay stream", async () => {
  const f = lwsServer("sse");
  const changed = vi.fn();
  const stop = await f.start(changed);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(f.sources).toHaveLength(1);
    const source = f.sources[0];
    source.open();
    expect(changed).toHaveBeenCalledTimes(1);
    source.message(
      JSON.stringify({
        type: "Notification",
        storage: f.description,
        activity: { type: "Update", object: f.root },
      }),
      "revision-1",
    );
    expect(changed).toHaveBeenCalledTimes(2);
    expect(source.reconnect()).toEqual({ "Last-Event-ID": "revision-1" });
    source.open();
    expect(changed).toHaveBeenCalledTimes(3);
    expect(f.sources).toHaveLength(1);
  } finally {
    stop();
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(f.sources[0].listenerCount).toBe(0);
  expect(f.sources[0].readyState).toBe(2);
  expect(f.doFetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes on LWS membership/edit events and reconciliation, then DELETEs on unsubscribe", async () => {
  const f = lwsServer();
  const changed = vi.fn();
  const stop = await f.start(changed);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(f.sockets).toHaveLength(1);
    f.sockets[0].open();
    expect(changed).toHaveBeenCalledTimes(1);
    f.sockets[0].message(
      JSON.stringify({
        type: "Notification",
        storage: f.description,
        activity: [
          { type: "Create", object: { id: `${f.root}one` } },
          { type: "Update", object: { id: `${f.root}two` } },
          { type: "Delete", object: { id: `${f.root}three` } },
        ],
      }),
    );
    expect(changed.mock.calls.slice(1).map(([event]) => [event.type, event.object])).toEqual([
      ["Create", `${f.root}one`],
      ["Update", `${f.root}two`],
      ["Delete", `${f.root}three`],
    ]);
    f.sockets[0].message(
      JSON.stringify({
        type: "Notification",
        storage: "https://foreign.example/",
        activity: { type: "Update", object: f.root },
      }),
    );
    expect(changed).toHaveBeenCalledTimes(4);
    f.sockets[0].error();
    await vi.advanceTimersByTimeAsync(1_000);
    f.sockets[1].open();
    expect(changed).toHaveBeenCalledTimes(5);
  } finally {
    stop();
    stop();
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(f.doFetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
  expect(f.sockets.every((socket) => socket.listenerCount === 0 && socket.readyState === 3)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("retains the app's same-origin service restriction", async () => {
  const f = lwsServer();
  f.foreignService();
  const stop = await f.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(f.doFetch.mock.calls.some(([url]) => String(url).includes("foreign.example"))).toBe(
      false,
    );
    expect(f.sockets).toHaveLength(0);
  } finally {
    stop();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("honors cancellation during discovery without leaving transports behind", async () => {
  const pending = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const doFetch = vi.fn<typeof fetch>(() => pending.promise);
  const changed = vi.fn();
  const subscribing = subscribeToResource("https://cancel.example/pod/", changed, {
    fetchImpl: doFetch,
    signal: controller.signal,
  });
  controller.abort();
  pending.resolve(new Response(null, { status: 404 }));
  const stop = await subscribing;
  stop();
  expect(doFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
