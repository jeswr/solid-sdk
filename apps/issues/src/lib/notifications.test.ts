// AUTHORED-BY Codex GPT-6.1-Sol
import { FakeWebSocket } from "@jeswr/pod-notifications/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchContainer } from "./notifications";

let sequence = 0;
function server(push: boolean | "stream" = true) {
  const root = `https://issues-${++sequence}.example/alice/`;
  const topic = `${root}issues/one.ttl`;
  const description = `${root}description`;
  let service = new URL("/.notifications/subscribe", root).href;
  let receiveFrom =
    push === "stream" ? `${root}stream` : new URL("/socket", root).href.replace("https:", "wss:");
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const cancel = vi.fn();
  let etag = '"one"';
  let members: string[] = [];
  const sockets: FakeWebSocket[] = [];
  const pending = Promise.withResolvers<Response>();
  let delayPost = false;
  const doFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (init?.method === "POST") {
      if (delayPost) return pending.promise;
      return Response.json({ receiveFrom }, { status: 201 });
    }
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          etag,
          link: `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"${url === root ? ', <http://www.w3.org/ns/pim/space#Storage>; rel="type"' : ""}`,
        },
      });
    if (init?.method === "OPTIONS") return new Response(null);
    if (url === `${root}issues/`)
      return Response.json(
        {
          "@id": url,
          "http://www.w3.org/ns/ldp#contains": members.map((id) => ({ "@id": id })),
        },
        { headers: { "content-type": "application/ld+json" } },
      );
    if (url === `${root}stream`)
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            streams.push(controller);
          },
          cancel,
        }),
      );
    if (url === description)
      return Response.json(
        [
          {
            "@id": root,
            "http://www.w3.org/ns/solid/notifications#subscription": push
              ? [{ "@id": service }]
              : [],
          },
          {
            "@id": service,
            "http://www.w3.org/ns/solid/notifications#channelType": [
              {
                "@id": `http://www.w3.org/ns/solid/notifications#${push === "stream" ? "StreamingHTTPChannel2023" : "WebSocketChannel2023"}`,
              },
            ],
          },
        ].slice(0, push ? 2 : 1),
        { headers: { "content-type": "application/ld+json" } },
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  class Socket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  }
  const start = (onChange = vi.fn(), ownStorageUrls = [root], watched = topic) => {
    const sync = watchContainer(watched, onChange, {
      fetch: doFetch,
      ownStorageUrls,
      WebSocketImpl: Socket as unknown as typeof WebSocket,
    });
    return { sync, onChange };
  };
  return {
    root,
    topic,
    doFetch,
    sockets,
    streams,
    cancel,
    start,
    pending,
    setService: (url: string) => {
      service = url;
    },
    setSocket: (url: string) => {
      receiveFrom = url;
    },
    edit: () => {
      etag = '"two"';
    },
    setMembers: (urls: string[]) => {
      members = urls;
    },
    delay: () => {
      delayPost = true;
    },
  };
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Issues notification integration", () => {
  it("refreshes container membership even when its ETag stays unchanged", async () => {
    const f = server(false);
    const { sync, onChange } = f.start(vi.fn(), [f.root], `${f.root}issues/`);
    try {
      await settle();
      expect(onChange).toHaveBeenCalledTimes(1);
      f.setMembers([f.topic]);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(onChange).toHaveBeenCalledTimes(2);
      f.setMembers([]);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(onChange).toHaveBeenCalledTimes(3);
    } finally {
      sync.close();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses StreamingHTTP when advertised and cancels its reader on cleanup", async () => {
    const f = server("stream");
    const { sync, onChange } = f.start();
    try {
      await settle();
      expect(f.streams).toHaveLength(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      f.streams[0].enqueue(
        new TextEncoder().encode(`${JSON.stringify({ type: "Update", object: f.topic })}\n`),
      );
      await settle();
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(f.sockets).toHaveLength(0);
    } finally {
      sync.close();
    }
    await settle();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refreshes on first live, scoped changes and reconnect, ignoring malformed/foreign frames", async () => {
    const f = server();
    const { sync, onChange } = f.start();
    try {
      await settle();
      expect(f.sockets).toHaveLength(1);
      const socket = f.sockets[0];
      socket.open();
      expect(onChange).toHaveBeenCalledTimes(1);
      socket.message("ping");
      socket.message(JSON.stringify({ type: "Update", object: "https://foreign.example/note" }));
      expect(onChange).toHaveBeenCalledTimes(1);
      for (const type of ["Create", "Update", "Delete", "Add", "Remove"]) {
        socket.message(JSON.stringify({ type, object: { id: f.topic } }));
      }
      expect(onChange).toHaveBeenCalledTimes(6);
      socket.error();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f.sockets).toHaveLength(2);
      f.sockets[1].open();
      expect(onChange).toHaveBeenCalledTimes(7);
    } finally {
      sync.close();
    }
    expect(f.sockets.every((socket) => socket.listenerCount === 0 && socket.readyState === 3)).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls ETags every 25 seconds and stops invalidating after close", async () => {
    const f = server(false);
    const { sync, onChange } = f.start();
    try {
      await settle();
      expect(onChange).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(onChange).toHaveBeenCalledTimes(1);
      f.edit();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      sync.close();
    }
    await vi.advanceTimersByTimeAsync(25_000);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "service",
    "socket",
    "no roots",
    "sibling",
  ])("keeps %s outside the own-pod push boundary", async (kind) => {
    const f = server();
    if (kind === "service") f.setService("https://foreign.example/subscribe");
    if (kind === "socket") f.setSocket("wss://foreign.example/socket");
    const roots =
      kind === "no roots" ? [] : kind === "sibling" ? [new URL("../bob/", f.root).href] : [f.root];
    const { sync } = f.start(vi.fn(), roots);
    try {
      await settle();
      expect(f.sockets).toHaveLength(0);
      expect(f.doFetch.mock.calls.some(([url]) => String(url).includes("foreign.example"))).toBe(
        false,
      );
      if (kind !== "socket")
        expect(f.doFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    } finally {
      sync.close();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts setup and cannot open a late socket after close", async () => {
    const f = server();
    f.delay();
    const { sync, onChange } = f.start();
    await settle();
    const post = f.doFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    sync.close();
    expect(post?.[1]?.signal?.aborted).toBe(true);
    f.pending.resolve(
      Response.json({ receiveFrom: new URL("/late", f.root).href.replace("https:", "wss:") }),
    );
    await settle();
    expect(f.sockets).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
