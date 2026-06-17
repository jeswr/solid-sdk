import { describe, it, expect, vi, afterEach } from "vitest";
import { subscriptionRequest, changedResource, watchContainer } from "./notifications";
import { WEBSOCKET_CHANNEL_TYPE } from "./notification-discovery";

/** A controllable mock WebSocket that records listeners + emit/teardown. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  closed = false;
  listeners: Record<string, Set<() => void>> = {};
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= new Set()).add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners[type]?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
  listenerCount(type: string) {
    return this.listeners[type]?.size ?? 0;
  }
}

const OWN = ["https://pod.example/alice/"];
const CONTAINER = "https://pod.example/alice/issues/";

/** Build a mocked own-pod fetch: HEAD → Link → storage desc → POST → receiveFrom. */
function ownPodFetch(receiveFrom: string | undefined, subscriptionService = "https://pod.example/alice/.notifications/WebSocketChannel2023/") {
  const descTtl = `
    @prefix notify: <http://www.w3.org/ns/solid/notifications#> .
    <https://pod.example/alice/.well-known/solid>
      notify:subscription <${subscriptionService}> .
    <${subscriptionService}> notify:channelType notify:WebSocketChannel2023 .
  `;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return new Response(null, {
        headers: { link: '</alice/.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"' },
      });
    }
    if (String(url).endsWith("/.well-known/solid")) {
      return new Response(descTtl, { headers: { "content-type": "text/turtle" } });
    }
    if (init?.method === "POST") {
      return new Response(JSON.stringify(receiveFrom ? { receiveFrom } : {}), {
        status: 201,
        headers: { "content-type": "application/ld+json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("notifications helpers", () => {
  it("builds a WebSocketChannel2023 subscription request", () => {
    const body = JSON.parse(subscriptionRequest("http://localhost:3000/alice/issue-tracker/issues/"));
    // The POST `type` MUST be the plural `notifications#` namespace — the same
    // channel-type IRI discovery matches on — or a conforming server rejects it.
    expect(body.type).toBe("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023");
    expect(body.topic).toBe("http://localhost:3000/alice/issue-tracker/issues/");
    expect(body["@context"]).toContain("notifications-context");
  });

  it("posts the SAME channel-type IRI that discovery matches on (no namespace drift)", () => {
    // Round-trip guard: the discovered/matched channel type and the subscription
    // POST body's `type` are one and the same exported constant, so they cannot
    // drift into the singular `notification#` vs plural `notifications#` mismatch.
    const body = JSON.parse(subscriptionRequest("http://x/c/"));
    expect(body.type).toBe(WEBSOCKET_CHANNEL_TYPE);
    expect(WEBSOCKET_CHANNEL_TYPE).toBe("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023");
  });

  it("extracts the changed resource from a notification (string or object)", () => {
    expect(changedResource({ type: "Update", object: "http://x/issues/1.ttl" })).toBe("http://x/issues/1.ttl");
    expect(changedResource({ type: "Add", object: { id: "http://x/issues/2.ttl" } })).toBe("http://x/issues/2.ttl");
    expect(changedResource({ type: "Delete" })).toBeUndefined();
  });
});

describe("watchContainer (WebSocket live-sync, mocked)", () => {
  afterEach(() => {
    MockWebSocket.instances.length = 0;
    vi.useRealTimers();
  });

  it("subscribes to the OWN-pod channel and invalidates the cache on a message", async () => {
    const onChange = vi.fn();
    const doFetch = ownPodFetch("wss://pod.example/socket?auth=tok");
    const sync = watchContainer(CONTAINER, onChange, {
      ownStorageUrls: OWN,
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await flush();
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.url).toBe("wss://pod.example/socket?auth=tok");
    // An incoming notification → refetch (the board invalidate-and-refetch).
    expect(onChange).not.toHaveBeenCalled();
    ws.emit("message");
    expect(onChange).toHaveBeenCalledTimes(1);
    sync.close();
  });

  it("tears down the socket + listeners on close (no leaks)", async () => {
    const doFetch = ownPodFetch("wss://pod.example/socket");
    const sync = watchContainer(CONTAINER, vi.fn(), {
      ownStorageUrls: OWN,
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await flush();
    const ws = MockWebSocket.instances[0];
    expect(ws.listenerCount("message")).toBe(1);
    sync.close();
    expect(ws.closed).toBe(true);
    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.listenerCount("error")).toBe(0);
    expect(ws.listenerCount("close")).toBe(0);
  });

  it("falls back to polling (never connects) when the server advertises NO channel", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    // /.well-known/solid exists but advertises no WebSocketChannel2023.
    const doFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { headers: {} });
      return new Response("@prefix x: <#> .\n", { headers: { "content-type": "text/turtle" } });
    }) as unknown as typeof fetch;
    const sync = watchContainer(CONTAINER, onChange, {
      ownStorageUrls: OWN,
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(MockWebSocket.instances.length).toBe(0); // never opened a socket
    // The poll fires onChange after the interval.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(onChange).toHaveBeenCalled();
    sync.close();
  });

  it("SSRF guard: a FOREIGN subscription endpoint degrades to polling (no token sent off-pod)", async () => {
    vi.useFakeTimers();
    // Discovery returns a subscription endpoint on a FOREIGN origin.
    const doFetch = ownPodFetch("wss://pod.example/socket", "https://evil.example/.notifications/WebSocketChannel2023/");
    const postSpy = doFetch as unknown as ReturnType<typeof vi.fn>;
    const sync = watchContainer(CONTAINER, vi.fn(), {
      ownStorageUrls: OWN,
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await vi.runOnlyPendingTimersAsync();
    // No POST to the foreign endpoint, no socket opened.
    const posted = postSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posted).toBe(false);
    expect(MockWebSocket.instances.length).toBe(0);
    sync.close();
  });

  it("SSRF guard: a FOREIGN receiveFrom socket URL degrades to polling (no cross-origin socket)", async () => {
    vi.useFakeTimers();
    const doFetch = ownPodFetch("wss://evil.example/socket"); // own endpoint, foreign socket
    const sync = watchContainer(CONTAINER, vi.fn(), {
      ownStorageUrls: OWN,
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(MockWebSocket.instances.length).toBe(0); // never opened the foreign socket
    sync.close();
  });

  it("fail-closed: with NO own-storage allow-list it polls, never subscribes", async () => {
    vi.useFakeTimers();
    const doFetch = ownPodFetch("wss://pod.example/socket");
    const postSpy = doFetch as unknown as ReturnType<typeof vi.fn>;
    const sync = watchContainer(CONTAINER, vi.fn(), {
      ownStorageUrls: [],
      fetch: doFetch,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    await vi.runOnlyPendingTimersAsync();
    const posted = postSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posted).toBe(false);
    expect(MockWebSocket.instances.length).toBe(0);
    sync.close();
  });
});
