// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// watch() tests against a MOCK notification channel: a fake WebSocket the driver
// opens via the internal `wsFactory` seam, plus a fetch stub that advertises (or
// does not advertise) a WebSocketChannel2023 subscription service.

import { DataFactory, Writer } from "n3";
import type { WatchEvent } from "unstorage";
import { describe, expect, it, vi } from "vitest";
import solidDriver from "../src/index.js";
import type { WatchSocket } from "../src/watch.js";

const { namedNode, quad } = DataFactory;
const BASE = "https://pod.example/kv/";
const SERVICE = "https://pod.example/.notifications/WebSocketChannel2023/";
const DESC = "https://pod.example/.well-known/solid";
const RECEIVE_FROM = "wss://pod.example/notifications/abc123";

/** A controllable fake WebSocket. */
class FakeSocket implements WatchSocket {
  static last: FakeSocket | undefined;
  url: string;
  closed = false;
  private listeners: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
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
}

async function descriptionTurtle(): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuad(
    quad(
      namedNode(SERVICE),
      namedNode("http://www.w3.org/ns/solid/notifications#channelType"),
      namedNode("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"),
    ),
  );
  return new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/** A fetch stub modelling discovery + subscription. */
function notificationFetch(opts: { advertise: boolean }): typeof globalThis.fetch {
  return (async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD" && url === BASE) {
      const headers = new Headers();
      if (opts.advertise) {
        headers.set("link", `<${DESC}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`);
      }
      return new Response(null, { status: 200, headers });
    }
    if (method === "GET" && url === DESC) {
      const turtle = await descriptionTurtle();
      return new Response(turtle, {
        status: 200,
        headers: new Headers({ "content-type": "text/turtle" }),
      });
    }
    if (method === "POST" && url === SERVICE) {
      return new Response(JSON.stringify({ receiveFrom: RECEIVE_FROM }), {
        status: 201,
        headers: new Headers({ "content-type": "application/ld+json" }),
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof globalThis.fetch;
}

describe("watch", () => {
  it("fires the callback with (update, key) on a notification", async () => {
    const events: [WatchEvent, string][] = [];
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
    });
    const unwatch = await driver.watch?.((event, key) => events.push([event, key]));
    expect(FakeSocket.last?.url).toBe(RECEIVE_FROM);

    FakeSocket.last?.emit(
      JSON.stringify({
        type: "Update",
        object: `${BASE}foo/bar`,
      }),
    );
    expect(events).toEqual([["update", "foo:bar"]]);

    FakeSocket.last?.emit(JSON.stringify({ type: "Delete", object: { id: `${BASE}gone` } }));
    expect(events).toEqual([
      ["update", "foo:bar"],
      ["remove", "gone"],
    ]);

    await unwatch?.();
    expect(FakeSocket.last?.closed).toBe(true);
  });

  it("ignores a notification for a resource outside the key space", async () => {
    const events: [WatchEvent, string][] = [];
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
    });
    await driver.watch?.((event, key) => events.push([event, key]));
    FakeSocket.last?.emit(JSON.stringify({ type: "Update", object: BASE }));
    FakeSocket.last?.emit(JSON.stringify({ type: "Update", object: "https://evil.example/x" }));
    expect(events).toEqual([]);
  });

  it("degrades to a no-op (no throw) when the server advertises no channel", async () => {
    const onDegrade = vi.fn();
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: false }),
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
      onWatchDegrade: onDegrade,
    });
    const unwatch = await driver.watch?.(() => {});
    expect(onDegrade).toHaveBeenCalled();
    // A no-op unwatch resolves cleanly (returns undefined, does not throw).
    expect(typeof unwatch).toBe("function");
    await expect(Promise.resolve(unwatch?.())).resolves.toBeUndefined();
  });

  it("degrades when discovery fetch throws", async () => {
    const onDegrade = vi.fn();
    const driver = solidDriver({
      base: BASE,
      fetch: (async () => {
        throw new Error("network down");
      }) as typeof globalThis.fetch,
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
      onWatchDegrade: onDegrade,
    });
    await driver.watch?.(() => {});
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("discovery failed"));
  });

  it("is a no-op when watch is not enabled", async () => {
    const onDegrade = vi.fn();
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      watch: false,
      wsFactory: (url) => new FakeSocket(url),
      onWatchDegrade: onDegrade,
    });
    await driver.watch?.(() => {});
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("watch disabled"));
  });

  it("applies driver `headers` to notification discovery + subscribe requests", async () => {
    const seen: Record<string, string | null>[] = [];
    const fetchImpl: typeof globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();
      seen.push({
        method: `${method} ${url}`,
        auth: new Headers(init?.headers).get("authorization"),
      });
      return notificationFetch({ advertise: true })(input, init);
    }) as typeof globalThis.fetch;
    const driver = solidDriver({
      base: BASE,
      fetch: fetchImpl,
      headers: { authorization: "Bearer tok" },
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
    });
    await driver.watch?.(() => {});
    // The HEAD (discovery), GET (description) and POST (subscribe) all carry the
    // driver header.
    const methods = seen.map((s) => s.method);
    expect(methods.some((m) => m.startsWith("HEAD"))).toBe(true);
    expect(methods.some((m) => m.startsWith("POST"))).toBe(true);
    for (const s of seen) {
      expect(s.auth).toBe("Bearer tok");
    }
  });

  it("refuses a same-origin description doc that redirects off-origin (no header forwarded off-origin)", async () => {
    const onDegrade = vi.fn();
    const seen: string[] = [];
    const Off = "https://evil.example/steal";
    // The HEAD advertises a SAME-ORIGIN description doc; GETting it answers with a
    // 302 to a foreign origin. The watch fetch must refuse the redirect rather than
    // follow it and forward the driver `authorization` header to evil.example.
    const fetchImpl: typeof globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const method = (init?.method ?? "GET").toUpperCase();
      seen.push(`${method} ${url}`);
      if (method === "HEAD" && url === BASE) {
        return new Response(null, {
          status: 200,
          headers: new Headers({
            link: `<${DESC}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
          }),
        });
      }
      if (method === "GET" && url === DESC) {
        return new Response(null, { status: 302, headers: new Headers({ location: Off }) });
      }
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch;
    const driver = solidDriver({
      base: BASE,
      fetch: fetchImpl,
      headers: { authorization: "Bearer tok" },
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
      onWatchDegrade: onDegrade,
    });
    const unwatch = await driver.watch?.(() => {});
    // The redirect was refused → watch degraded to a no-op (no throw out of watch()).
    expect(onDegrade).toHaveBeenCalled();
    expect(typeof unwatch).toBe("function");
    // The foreign origin was NEVER requested — the guard refused before following.
    expect(seen.some((s) => s.includes("evil.example"))).toBe(false);
  });

  it("a normal (non-redirecting) same-origin watch still connects", async () => {
    const events: [WatchEvent, string][] = [];
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      headers: { authorization: "Bearer tok" },
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
    });
    await driver.watch?.((event, key) => events.push([event, key]));
    // Discovery + subscribe succeeded through the same-origin redirect-refusing
    // fetch and the socket opened at the advertised receiveFrom.
    expect(FakeSocket.last?.url).toBe(RECEIVE_FROM);
    FakeSocket.last?.emit(JSON.stringify({ type: "Update", object: `${BASE}foo` }));
    expect(events).toEqual([["update", "foo"]]);
  });

  it("dispose() closes open sockets", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
    });
    await driver.watch?.(() => {});
    const sock = FakeSocket.last;
    await driver.dispose?.();
    expect(sock?.closed).toBe(true);
  });

  it("ignores a malformed (non-JSON) notification payload", async () => {
    const events: unknown[] = [];
    const onDegrade = vi.fn();
    const driver = solidDriver({
      base: BASE,
      fetch: notificationFetch({ advertise: true }),
      watch: true,
      wsFactory: (url) => new FakeSocket(url),
      onWatchDegrade: onDegrade,
    });
    await driver.watch?.((e, k) => events.push([e, k]));
    FakeSocket.last?.emit("not json {{{");
    expect(events).toEqual([]);
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
  });
});
