// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Fine-grained branch coverage for startWatch — discovery fallbacks, subscribe
// failures, socket-open failure, and notification payload shapes.

import { DataFactory, Writer } from "n3";
import type { WatchEvent } from "unstorage";
import { describe, expect, it, vi } from "vitest";
import { startWatch, type WatchSocket } from "../src/watch.js";

const { namedNode, quad } = DataFactory;
const BASE = "https://pod.example/kv/";
const SERVICE = "https://pod.example/.notifications/WebSocketChannel2023/";
const DESC = "https://pod.example/desc";
const RECEIVE_FROM = "wss://pod.example/n/tok";

class FakeSocket implements WatchSocket {
  static last: FakeSocket | undefined;
  closed = false;
  private listeners: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void {
    const list = this.listeners[type] ?? [];
    this.listeners[type] = list;
    list.push(listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(data: unknown): void {
    for (const l of this.listeners.message ?? []) {
      l({ data });
    }
  }
  error(): void {
    for (const l of this.listeners.error ?? []) {
      l({});
    }
  }
}

async function descTurtle(shape: "channelType" | "subscriptionOnly" | "none"): Promise<string> {
  const w = new Writer({ format: "text/turtle" });
  if (shape === "channelType") {
    w.addQuad(
      quad(
        namedNode(SERVICE),
        namedNode("http://www.w3.org/ns/solid/notifications#channelType"),
        namedNode("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"),
      ),
    );
  } else if (shape === "subscriptionOnly") {
    w.addQuad(
      quad(
        namedNode("https://pod.example/storage"),
        namedNode("http://www.w3.org/ns/solid/notifications#subscription"),
        namedNode(SERVICE),
      ),
    );
  }
  return new Promise<string>((res, rej) => w.end((e, r) => (e ? rej(e) : res(r))));
}

function discoveryFetch(opts: {
  rel?: string;
  descOk?: boolean;
  shape?: "channelType" | "subscriptionOnly" | "none";
  subStatus?: number;
  subBody?: unknown;
}): typeof globalThis.fetch {
  const rel = opts.rel ?? "http://www.w3.org/ns/solid/terms#storageDescription";
  return (async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD" && url === BASE) {
      const headers = new Headers();
      if (rel !== "NONE") {
        headers.set("link", `<${DESC}>; rel="${rel}"`);
      }
      return new Response(null, { status: 200, headers });
    }
    if (method === "GET" && url === DESC) {
      if (opts.descOk === false) {
        return new Response(null, { status: 500 });
      }
      const body = await descTurtle(opts.shape ?? "channelType");
      return new Response(body, {
        status: 200,
        headers: new Headers({ "content-type": "text/turtle" }),
      });
    }
    if (method === "POST" && url === SERVICE) {
      return new Response(JSON.stringify(opts.subBody ?? { receiveFrom: RECEIVE_FROM }), {
        status: opts.subStatus ?? 201,
        headers: new Headers({ "content-type": "application/ld+json" }),
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof globalThis.fetch;
}

describe("startWatch SSRF / credential-leak guard (same-origin)", () => {
  it("degrades (no request) when the storage-description URL is cross-origin", async () => {
    const onDegrade = vi.fn();
    const fetched: string[] = [];
    // The HEAD advertises a FOREIGN description URL — discovery must refuse it.
    const foreignDescUrl = "https://attacker.example/desc";
    const fetchImpl: typeof globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();
      fetched.push(`${method} ${url}`);
      if (method === "HEAD" && url === BASE) {
        const headers = new Headers();
        headers.set(
          "link",
          `<${foreignDescUrl}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        );
        return new Response(null, { status: 200, headers });
      }
      return new Response(null, { status: 200 });
    }) as typeof globalThis.fetch;
    await startWatch({
      base: BASE,
      fetch: fetchImpl,
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("no WebSocketChannel2023"));
    // We must NOT have fetched the foreign description doc.
    expect(fetched.some((f) => f.includes("attacker.example"))).toBe(false);
  });

  it("degrades when the subscription service URL is cross-origin", async () => {
    const onDegrade = vi.fn();
    const fetched: string[] = [];
    const foreignServiceUrl = "https://attacker.example/sub";
    // The description doc advertises a FOREIGN subscription service.
    const foreignDesc = async () => {
      const w = new Writer({ format: "text/turtle" });
      w.addQuad(
        quad(
          namedNode(foreignServiceUrl),
          namedNode("http://www.w3.org/ns/solid/notifications#channelType"),
          namedNode("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"),
        ),
      );
      return new Promise<string>((res, rej) => w.end((e, r) => (e ? rej(e) : res(r))));
    };
    const fetchImpl: typeof globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();
      fetched.push(`${method} ${url}`);
      if (method === "HEAD" && url === BASE) {
        const headers = new Headers();
        headers.set("link", `<${DESC}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`);
        return new Response(null, { status: 200, headers });
      }
      if (method === "GET" && url === DESC) {
        return new Response(await foreignDesc(), {
          status: 200,
          headers: new Headers({ "content-type": "text/turtle" }),
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch;
    await startWatch({
      base: BASE,
      fetch: fetchImpl,
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("no WebSocketChannel2023"));
    // We must NOT have POSTed to the foreign subscription service.
    expect(fetched.some((f) => f.startsWith("POST") && f.includes("attacker.example"))).toBe(false);
  });
});

describe("startWatch discovery", () => {
  it("uses the describedby rel as a fallback", async () => {
    const w = await startWatch({
      base: BASE,
      fetch: discoveryFetch({ rel: "describedby" }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
    });
    expect(FakeSocket.last?.url).toBe(RECEIVE_FROM);
    w.unwatch();
  });

  it("degrades when no link rel is present", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({ rel: "NONE" }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("no WebSocketChannel2023"));
  });

  it("degrades when the description doc fetch fails", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({ descOk: false }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalled();
  });

  it("falls back to a notify:subscription object when no channelType quad", async () => {
    const w = await startWatch({
      base: BASE,
      fetch: discoveryFetch({ shape: "subscriptionOnly" }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
    });
    expect(FakeSocket.last?.url).toBe(RECEIVE_FROM);
    w.unwatch();
  });

  it("degrades when the description has neither channelType nor subscription", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({ shape: "none" }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("no WebSocketChannel2023"));
  });
});

describe("startWatch subscribe", () => {
  it("degrades when subscribe returns non-ok", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({ subStatus: 403 }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("subscribe failed"));
  });

  it("degrades when the subscription response has no receiveFrom", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({ subBody: { nope: true } }),
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("no `receiveFrom`"));
  });

  it("degrades when the subscribe request throws", async () => {
    const onDegrade = vi.fn();
    const fetchImpl: typeof globalThis.fetch = (async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST") {
        throw new Error("post boom");
      }
      return discoveryFetch({})(input, init);
    }) as typeof globalThis.fetch;
    await startWatch({
      base: BASE,
      fetch: fetchImpl,
      callback: () => {},
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("subscribe request failed"));
  });
});

describe("startWatch socket open", () => {
  it("degrades when the socket factory throws", async () => {
    const onDegrade = vi.fn();
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({}),
      callback: () => {},
      wsFactory: () => {
        throw new Error("ctor boom");
      },
      onDegrade,
    });
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("opening notification socket"));
  });

  it("degrades when no WebSocket implementation is available", async () => {
    const onDegrade = vi.fn();
    const original = globalThis.WebSocket;
    // @ts-expect-error simulate an environment with no WebSocket
    globalThis.WebSocket = undefined;
    try {
      await startWatch({
        base: BASE,
        fetch: discoveryFetch({}),
        callback: () => {},
        onDegrade,
      });
      expect(onDegrade).toHaveBeenCalledWith(
        expect.stringContaining("no WebSocket implementation"),
      );
    } finally {
      globalThis.WebSocket = original;
    }
  });
});

describe("notification payload shapes", () => {
  async function startAndGet(): Promise<{
    sock: FakeSocket;
    events: [WatchEvent, string][];
  }> {
    const events: [WatchEvent, string][] = [];
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({}),
      callback: (e, k) => events.push([e, k]),
      wsFactory: (u) => new FakeSocket(u),
    });
    return { sock: FakeSocket.last as FakeSocket, events };
  }

  it("treats an array `type` containing Delete as a removal", async () => {
    const { sock, events } = await startAndGet();
    sock.emit(JSON.stringify({ type: ["Activity", "Delete"], object: `${BASE}x` }));
    expect(events).toEqual([["remove", "x"]]);
  });

  it("decodes a Uint8Array payload", async () => {
    const { sock, events } = await startAndGet();
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "Update", object: `${BASE}y` }));
    sock.emit(bytes);
    expect(events).toEqual([["update", "y"]]);
  });

  it("ignores a payload that is neither string nor bytes", async () => {
    const onDegrade = vi.fn();
    const events: [WatchEvent, string][] = [];
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({}),
      callback: (e, k) => events.push([e, k]),
      wsFactory: (u) => new FakeSocket(u),
      onDegrade,
    });
    (FakeSocket.last as FakeSocket).emit({ not: "a string" });
    expect(events).toEqual([]);
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("neither string nor bytes"));
  });

  it("ignores a notification with no object url", async () => {
    const { sock, events } = await startAndGet();
    sock.emit(JSON.stringify({ type: "Update" }));
    expect(events).toEqual([]);
  });

  it("survives a throwing consumer callback", async () => {
    await startWatch({
      base: BASE,
      fetch: discoveryFetch({}),
      callback: () => {
        throw new Error("consumer boom");
      },
      wsFactory: (u) => new FakeSocket(u),
    });
    const sock = FakeSocket.last as FakeSocket;
    // Should not throw out of the handler.
    expect(() => sock.emit(JSON.stringify({ type: "Update", object: `${BASE}z` }))).not.toThrow();
    sock.error(); // error listener is a no-op; must not throw
  });
});
