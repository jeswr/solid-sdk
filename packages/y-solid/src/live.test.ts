// AUTHORED-BY Codex GPT-6.1-Sol
import { EventEmitter } from "node:events";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import * as encoding from "lib0/encoding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";
import type { SyncSocket } from "./live.js";
import { type YSolidOptions, YSolidProvider } from "./provider.js";
import { SolidUpdateStore } from "./store.js";
import { ENDPOINT, FakeSyncServer, message, SSD, TEMPLATE } from "./testSyncServer.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});
async function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ protocol, root: "https://pod.example/" });
  const { url: container } = await storage.create(storage.root, null, {
    kind: "container",
    name: "doc",
  });
  const server = new FakeSyncServer(storage, container);
  cleanups.push(() => server.destroy());
  const create = vi.fn(server.storage.create);
  const clientStorage = { ...server.storage, create };
  const provider = (options: Partial<YSolidOptions> = {}) => {
    const doc = options.doc ?? new Y.Doc();
    const instance = new YSolidProvider({
      doc,
      storage: clientStorage,
      container,
      fetch: server.fetch,
      description: server.description,
      socketFactory: server.socketFactory,
      reconnectDelayMs: 20,
      ...options,
    });
    cleanups.push(() => {
      instance.destroy();
      doc.destroy();
    });
    return instance;
  };
  return { storage, container, server, provider, create };
}
const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 450, interval: 1 });

for (const protocol of ["solid", "lws"] as const)
  describe(`${protocol} live sync`, () => {
    it("converges two providers under 500 ms, propagates awareness, and leaves persistence to the relay", async () => {
      const { provider, server, create, storage, container } = await setup(protocol);
      const a = provider();
      const b = provider({ mode: "live" });
      await Promise.all([a.whenSynced, b.whenSynced]);
      expect(a.mode).toBe("live");
      expect(b.mode).toBe("live");
      const started = performance.now();
      a.doc.getText("text").insert(0, "hello");
      b.doc.getMap("meta").set("remote", 42);
      a.awareness.setLocalState({ user: "Alice" });
      await eventually(() => {
        expect(b.doc.getText("text").toString()).toBe("hello");
        expect(a.doc.getMap("meta").get("remote")).toBe(42);
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: "Alice" });
        expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
      });
      expect(performance.now() - started).toBeLessThan(500);
      expect(await a.compact()).toBeUndefined();
      expect(await a.persistFullState()).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
      await a.flush();
      await b.flush();
      expect(create).toHaveBeenCalledTimes(2);
      await server.writes;
      const reader = provider({ storage, mode: "log" });
      await reader.whenSynced;
      expect(reader.doc.getText("text").toString()).toBe("hello");
      expect(reader.doc.getMap("meta").get("remote")).toBe(42);
      expect(
        (await new SolidUpdateStore({ storage, container }).loadUpdates()).length,
      ).toBeGreaterThan(0);
    });

    it("posts authenticated room JSON and expands RDF roomTemplate without appending another room", async () => {
      const { provider, server, container } = await setup(protocol);
      const service = server.description.services[0];
      const a = provider({
        description: {
          ...server.description,
          services: [
            {
              ...(service as NonNullable<typeof service>),
              extra: { [`${SSD}roomTemplate`]: `${TEMPLATE}?profile=1` },
            },
          ],
        },
        fetch: async (input, init) => {
          const response = await server.fetch(input, init);
          const ticket = (await response.json()) as { url: string; expires: number };
          const url = `${ticket.url}&profile=1`;
          // Verify the URL independently, then use the ordinary fake socket URL.
          return Response.json({ ...ticket, url });
        },
        socketFactory: (url) => {
          expect(new URL(url).pathname).toBe(`/sync/${encodeURIComponent(container)}`);
          expect(new URL(url).searchParams.get("profile")).toBe("1");
          return server.socketFactory(url.replace("&profile=1", ""));
        },
      });
      await a.whenSynced;
      expect(a.mode).toBe("live");
      expect(server.requests[0]).toMatchObject({
        url: ENDPOINT,
        init: {
          method: "POST",
          body: JSON.stringify({ room: container }),
          redirect: "error",
        },
      });
      expect(new Headers(server.requests[0]?.init?.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(server.sockets[0]?.binaryType).toBe("arraybuffer");
    });

    it("persists edits during loss, ingests log-only edits, reconnects with a fresh ticket, and resyncs", async () => {
      const { provider, server, create, storage } = await setup(protocol);
      const a = provider();
      const b = provider();
      await Promise.all([a.whenSynced, b.whenSynced]);
      a.doc.getMap("data").set("before-close", "kept");
      // Close before the queued frame can reach the server: loss must checkpoint it.
      server.drop();
      expect(a.mode).toBe("log");
      expect(b.mode).toBe("log");
      a.doc.getMap("data").set("offline-a", true);
      b.doc.getMap("data").set("offline-b", true);
      await a.flush();
      await b.flush();
      expect(create).toHaveBeenCalled();
      const log = provider({ storage, mode: "log" });
      await log.whenSynced;
      expect(log.doc.getMap("data").get("before-close")).toBe("kept");
      log.doc.getMap("data").set("log-only", true);
      await log.flush();
      server.online = true;
      await eventually(() => {
        expect(a.mode).toBe("live");
        expect(b.mode).toBe("live");
        expect(a.doc.getMap("data").toJSON()).toEqual({
          "before-close": "kept",
          "offline-a": true,
          "offline-b": true,
          "log-only": true,
        });
        expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
      });
      expect(new Set(server.opened).size).toBe(server.opened.length);
      expect(server.opened.length).toBeGreaterThanOrEqual(4);
      const count = create.mock.calls.length;
      a.doc.getMap("data").set("after-reconnect", true);
      await eventually(() => expect(b.doc.getMap("data").get("after-reconnect")).toBe(true));
      await a.flush();
      expect(create).toHaveBeenCalledTimes(count + 1);
    });

    it.each([
      "flush",
      "disconnect",
    ] as const)("checkpoints live edits on %s before a delayed socket close", async (method) => {
      const { provider, server, storage } = await setup(protocol);
      const a = provider();
      await a.whenSynced;
      const socket = server.sockets[0];
      if (!socket) throw new Error("missing socket");
      // The socket accepts sends but the interrupted relay never receives them
      // and its close event has not reached the provider yet.
      vi.spyOn(socket, "send").mockImplementation(() => {});
      a.doc.getText("text").insert(0, "durable");
      expect(a.mode).toBe("live");
      await a[method]();
      a.destroy();
      expect(server.doc.getText("text").toString()).toBe("");
      const reader = provider({ storage, mode: "log" });
      await reader.whenSynced;
      expect(reader.doc.getText("text").toString()).toBe("durable");
    });

    it.each([
      "loss",
      "disconnect",
    ] as const)("restores both peers' awareness promptly after one provider's %s", async (kind) => {
      const { provider, server } = await setup(protocol);
      const a = provider();
      const b = provider();
      a.awareness.setLocalState({ user: "A" });
      b.awareness.setLocalState({ user: "B" });
      await Promise.all([a.whenSynced, b.whenSynced]);
      await eventually(() => {
        expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ user: "B" });
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: "A" });
      });
      const peerClock = b.awareness.meta.get(b.doc.clientID)?.clock;
      if (kind === "loss") server.sockets[0]?.close();
      else await a.disconnect();
      expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);
      await eventually(() => expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false));
      if (kind === "disconnect") await a.connect();
      await eventually(() => {
        expect(a.mode).toBe("live");
        expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ user: "B" });
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: "A" });
      });
      // B did not reconnect or send a heartbeat to restore its presence at A.
      expect(b.awareness.meta.get(b.doc.clientID)?.clock).toBe(peerClock);
    });
  });

it.each([
  "unknown",
  "unavailable",
] as const)("auto uses log mode when realtimeCollab is %s", async (state) => {
  const { provider, server, create } = await setup();
  const a = provider({
    storage: {
      ...server.storage,
      create,
      features: {
        ...server.storage.features,
        realtimeCollab: { ...server.storage.features.realtimeCollab, state },
      },
    },
  });
  await a.whenSynced;
  expect(a.mode).toBe("log");
  a.doc.getText("t").insert(0, "log");
  await a.flush();
  expect(create).toHaveBeenCalledOnce();
  expect(server.requests).toHaveLength(0);
});

it("explicit log never requests a ticket even with an advertised service", async () => {
  const { provider, server } = await setup();
  const a = provider({ mode: "log", fetch: undefined });
  await a.whenSynced;
  expect(a.mode).toBe("log");
  expect(server.requests).toHaveLength(0);
});

it("refuses unavailable/unsupported explicit live and missing authenticated fetch", async () => {
  const { provider, server } = await setup();
  expect(() => provider({ fetch: undefined })).toThrow(/authenticated fetch/);
  expect(() =>
    provider({
      mode: "live",
      storage: {
        ...server.storage,
        features: {
          ...server.storage.features,
          realtimeCollab: {
            state: "available",
            evidence: "test",
            detail: { endpoint: ENDPOINT, protocols: ["urn:other"] },
          },
        },
      },
    }),
  ).toThrow(/live mode/);
  expect(server.requests).toHaveLength(0);
});

it("accepts a same-host ticket URL without a roomTemplate and ISO expiry", async () => {
  const { provider, server } = await setup();
  const a = provider({
    description: undefined,
    fetch: async (input, init) => {
      const response = await server.fetch(input, init);
      const ticket = (await response.json()) as { url: string; expires: number };
      return Response.json({
        url: ticket.url.replace("relay.example", "pod.example"),
        expires: new Date(ticket.expires).toISOString(),
      });
    },
    socketFactory: (url) => server.socketFactory(url.replace("pod.example", "relay.example")),
  });
  await a.whenSynced;
  expect(a.mode).toBe("live");
});

it.each([
  { url: "wss://relay.example/foreign?ticket=private", expires: Date.now() + 60_000 },
  { url: "ws://relay.example/sync/room?ticket=private", expires: Date.now() + 60_000 },
  { url: "wss://user:private@relay.example/room", expires: Date.now() + 60_000 },
  { url: "wss://relay.example/room#private", expires: Date.now() + 60_000 },
  { url: "not-a-url-private", expires: Date.now() + 60_000 },
  { url: "wss://relay.example/room", expires: 0 },
  { url: "wss://relay.example/room" },
  null,
])("rejects unsafe or invalid tickets without opening a socket or leaking response bytes (%#)", async (ticket) => {
  const { provider, server } = await setup();
  const socketFactory = vi.fn(server.socketFactory);
  const a = provider({ fetch: async () => Response.json(ticket), socketFactory });
  const errors: Error[] = [];
  a.on("error", (error) => errors.push(error));
  await a.whenSynced;
  expect(a.mode).toBe("log");
  expect(socketFactory).not.toHaveBeenCalled();
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).not.toContain("private");
});

it.each([401, 403, 500, 302])("falls back on a failed ticket POST (%i)", async (status) => {
  const { provider, server } = await setup();
  const a = provider({ fetch: async () => new Response(null, { status }) });
  await a.whenSynced;
  expect(a.mode).toBe("log");
  expect(server.opened).toHaveLength(0);
});

it("rejects oversized ticket bodies", async () => {
  const { provider, server } = await setup();
  const a = provider({ fetch: async () => new Response(" ".repeat(65_537)) });
  await a.whenSynced;
  expect(a.mode).toBe("log");
  expect(server.opened).toHaveLength(0);
});

it("fences a late ticket after destroy and preserves supplied awareness", async () => {
  const { provider, server } = await setup();
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<Response>((r) => {
    resolve = r;
  });
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  cleanups.push(() => {
    awareness.destroy();
    doc.destroy();
  });
  const destroy = vi.spyOn(awareness, "destroy");
  const a = provider({
    doc,
    awareness,
    fetch: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return pending;
    },
  });
  await eventually(() => expect(signal).toBeDefined());
  a.destroy();
  expect(signal?.aborted).toBe(true);
  resolve(await server.fetch(ENDPOINT, { body: JSON.stringify({ room: server.container }) }));
  await a.whenSynced;
  expect(server.opened).toHaveLength(0);
  expect(destroy).not.toHaveBeenCalled();
  awareness.setLocalState({ still: "usable" });
});

it("times out an unresponsive handshake, persists pending edits, then reconnects", async () => {
  const { provider, server, create } = await setup();
  server.handshake = false;
  const a = provider({ connectTimeoutMs: 15 });
  a.doc.getText("t").insert(0, "queued");
  await a.whenSynced;
  expect(a.mode).toBe("log");
  await a.flush();
  expect(create).toHaveBeenCalled();
  server.handshake = true;
  await eventually(() => expect(a.mode).toBe("live"));
  expect(server.doc.getText("t").toString()).toBe("queued");
});

it("rejects partial-integrating sync frames without changing the live document", async () => {
  const { provider, server } = await setup();
  const a = provider();
  await a.whenSynced;
  const malicious = new Y.Doc();
  cleanups.push(() => malicious.destroy());
  malicious.getText("bad").insert(0, "partial");
  malicious.getMap("meta").set("bad", "tail");
  const update = Y.encodeStateAsUpdate(malicious);
  const truncated = update.slice(0, -1);
  const before = Y.encodeStateAsUpdate(a.doc);
  const errors = vi.fn();
  a.on("error", errors);
  server.sockets[0]?.deliver(message(0, (encoder) => sync.writeUpdate(encoder, truncated)));
  await eventually(() => expect(a.mode).toBe("log"));
  expect(Y.encodeStateAsUpdate(a.doc)).toEqual(before);
  expect(errors).toHaveBeenCalledOnce();
});

it("handles permission denial, removes stale awareness, releases listeners, and stops retries on disconnect", async () => {
  const { provider, server } = await setup();
  const a = provider();
  const b = provider();
  await Promise.all([a.whenSynced, b.whenSynced]);
  b.awareness.setLocalState({ user: "B" });
  await eventually(() => expect(a.awareness.getStates().has(b.doc.clientID)).toBe(true));
  const socket = server.sockets[0];
  if (!socket) throw new Error("missing socket");
  socket.deliver(
    message(2, (encoder) => {
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarString(encoder, "private reason");
    }),
  );
  await eventually(() => expect(a.mode).toBe("log"));
  expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false);
  expect(socket.listenerCount()).toBe(0);
  await a.disconnect();
  const requests = server.requests.length;
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(100);
  expect(server.requests).toHaveLength(requests);
  vi.useRealTimers();
  await a.connect();
  expect(a.mode).toBe("live");
  const final = server.sockets.at(-1);
  if (!final) throw new Error("missing socket");
  a.destroy();
  expect(final.listenerCount()).toBe(0);
});

it("reconnects even when fallback writes fail, sending the retained edits to the relay", async () => {
  const { provider, server, create } = await setup();
  const a = provider();
  await a.whenSynced;
  server.drop();
  create.mockRejectedValue(new Error("pod writes unavailable"));
  a.doc.getText("t").insert(0, "retained");
  await expect(a.flush()).rejects.toThrow("pod writes unavailable");
  server.online = true;
  await eventually(() => expect(a.mode).toBe("live"));
  await eventually(() => expect(server.doc.getText("t").toString()).toBe("retained"));
  // Live recovery does not acknowledge durable storage for an explicit flush.
  await expect(a.flush()).rejects.toThrow("pod writes unavailable");
  create.mockImplementation(server.storage.create);
  await a.flush();
});

it("retains a failed live checkpoint and edits sent during an in-flight flush", async () => {
  const { provider, server, create, storage } = await setup();
  const a = provider();
  await a.whenSynced;
  const socket = server.sockets[0];
  if (!socket) throw new Error("missing socket");
  vi.spyOn(socket, "send").mockImplementation(() => {});
  a.doc.getMap("m").set("first", true);
  create.mockRejectedValueOnce(new Error("checkpoint failed"));
  await expect(a.flush()).rejects.toThrow("checkpoint failed");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  create.mockImplementationOnce(async (...args) => {
    await gate;
    return server.storage.create(...args);
  });
  const flushing = a.flush();
  await eventually(() => expect(create).toHaveBeenCalledTimes(2));
  a.doc.getMap("m").set("during", true);
  release();
  await flushing;
  await a.flush();
  expect(create).toHaveBeenCalledTimes(3);
  await a.flush();
  expect(create).toHaveBeenCalledTimes(3);
  a.destroy();
  const reader = provider({ storage, mode: "log" });
  await reader.whenSynced;
  expect(reader.doc.getMap("m").toJSON()).toEqual({ first: true, during: true });
});

it("keeps an earlier background drain from sending an explicit checkpoint only to the relay", async () => {
  const { provider, create } = await setup();
  vi.useFakeTimers();
  const a = provider();
  // This batch waits for hydration and the handshake before its debounce starts.
  a.doc.getText("text").insert(0, "queued");
  await a.whenSynced;
  expect(a.mode).toBe("live");
  // Queue the background drain without running its promise continuation yet.
  vi.advanceTimersByTime(300);
  await a.flush();
  expect(create).toHaveBeenCalledOnce();
});

it.each([
  "disconnect",
  "destroy",
] as const)("handles asynchronous Node socket errors when %s cancels connection setup", async (method) => {
  const { provider } = await setup();
  const events = new EventEmitter();
  const unhandled: unknown[] = [];
  let readyState = 0;
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const socket: SyncSocket = {
    get readyState() {
      return readyState;
    },
    binaryType: "",
    send: vi.fn(),
    close: () => {
      if (readyState !== 0) return;
      readyState = 2;
      // Node ws emits error asynchronously when close() cancels its handshake.
      // EventEmitter throws for an error with no listener; capture that throw
      // here so the regression fails without terminating the test process.
      queueMicrotask(() => {
        try {
          events.emit("error", new Error("connection cancelled"));
        } catch (cause) {
          unhandled.push(cause);
        }
        readyState = 3;
        events.emit("close", {});
        finish();
      });
    },
    addEventListener: (type, listener) => {
      events.on(type, listener);
    },
    removeEventListener: (type, listener) => {
      events.off(type, listener);
    },
  };
  const socketFactory = vi.fn(() => socket);
  const a = provider({ socketFactory });
  const error = vi.fn();
  a.on("error", error);
  await eventually(() => expect(socketFactory).toHaveBeenCalledOnce());
  await a[method]();
  await closed;
  await a.whenSynced;
  expect(unhandled).toEqual([]);
  expect(error).not.toHaveBeenCalled();
  expect(events.eventNames()).toEqual([]);
  expect(a.synced).toBe(false);
});

it("hydrates existing log state and a prepopulated document before live sync", async () => {
  const { provider, server, storage, container, create } = await setup();
  const seed = new Y.Doc();
  cleanups.push(() => seed.destroy());
  seed.getMap("m").set("log", true);
  await new SolidUpdateStore({ storage, container }).appendUpdate(Y.encodeStateAsUpdate(seed));
  const doc = new Y.Doc();
  doc.getMap("m").set("preexisting", true);
  const a = provider({ doc });
  await a.whenSynced;
  await eventually(() =>
    expect(server.doc.getMap("m").toJSON()).toEqual({ log: true, preexisting: true }),
  );
  expect(a.doc.getMap("m").toJSON()).toEqual({ log: true, preexisting: true });
  expect(create).not.toHaveBeenCalled();
});

it("does not apply stale socket frames after disconnect, and queues disconnected edits for reconnect", async () => {
  const { provider, server } = await setup();
  const a = provider();
  await a.whenSynced;
  const socket = server.sockets[0];
  if (!socket) throw new Error("missing socket");
  const source = new Y.Doc();
  cleanups.push(() => source.destroy());
  source.getMap("m").set("stale", true);
  socket.deliver(message(0, (encoder) => sync.writeUpdate(encoder, Y.encodeStateAsUpdate(source))));
  const disconnect = a.disconnect();
  a.destroy();
  await disconnect;
  await Promise.resolve();
  expect(a.doc.getMap("m").has("stale")).toBe(false);
  expect(socket.listenerCount()).toBe(0);
});

it("falls back on socket send failure without losing the edit", async () => {
  const { provider, server } = await setup();
  const a = provider();
  await a.whenSynced;
  const socket = server.sockets[0];
  if (!socket) throw new Error("missing socket");
  vi.spyOn(socket, "send").mockImplementation(() => {
    throw new Error("private socket URL");
  });
  const error = vi.fn();
  a.on("error", error);
  a.doc.getMap("m").set("sent", true);
  expect(a.mode).toBe("log");
  await a.flush();
  const records = await a.store.loadUpdates();
  const read = new Y.Doc();
  cleanups.push(() => read.destroy());
  for (const record of records) Y.applyUpdate(read, record.update);
  expect(read.getMap("m").get("sent")).toBe(true);
  expect(error.mock.calls[0]?.[0].message).not.toContain("private");
});

it.each([
  "text",
  "truncated-awareness",
  "unknown",
  "oversized",
])("rejects malformed %s frames", async (kind) => {
  const { provider, server } = await setup();
  const a = provider();
  await a.whenSynced;
  const socket = server.sockets[0];
  if (!socket) throw new Error("missing socket");
  const error = vi.fn();
  a.on("error", error);
  const bytes =
    kind === "truncated-awareness"
      ? new Uint8Array([1, 1, 2])
      : kind === "unknown"
        ? new Uint8Array([99])
        : new Uint8Array(64 * 1024 * 1024 + 1);
  socket.emit("message", { data: kind === "text" ? "untrusted" : bytes });
  await eventually(() => expect(a.mode).toBe("log"));
  expect(error).toHaveBeenCalledOnce();
});

it("times out a fetch that ignores cancellation and fences its late result", async () => {
  const { provider, server } = await setup();
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((r) => {
    resolve = r;
  });
  const a = provider({ fetch: async () => pending, connectTimeoutMs: 10, reconnectDelayMs: 1_000 });
  await a.whenSynced;
  expect(a.mode).toBe("log");
  resolve(await server.fetch(ENDPOINT, { body: JSON.stringify({ room: server.container }) }));
  await Promise.resolve();
  await Promise.resolve();
  expect(server.opened).toHaveLength(0);
});

it("rejects invalid room templates, timing options, and awareness from another doc", async () => {
  const { provider, server } = await setup();
  for (const template of [
    42,
    "wss://relay.example/no-room",
    "wss://relay.example/{room}/{unknown}",
    "ws://relay.example/{room}",
  ]) {
    expect(() =>
      provider({
        description: {
          ...server.description,
          services: server.description.services.map((entry) => ({
            ...entry,
            extra: { roomTemplate: template },
          })),
        },
      }),
    ).toThrow();
  }
  for (const value of [0, -1, Number.NaN, Infinity]) {
    expect(() => provider({ reconnectDelayMs: value })).toThrow(/timing/);
    expect(() => provider({ connectTimeoutMs: value })).toThrow(/timing/);
  }
  const other = new Y.Doc();
  const awareness = new Awareness(other);
  cleanups.push(() => {
    awareness.destroy();
    other.destroy();
  });
  expect(() => provider({ awareness })).toThrow(/belong/);
  expect(server.requests).toHaveLength(0);
});

it("can stop reconnection reentrantly from an error listener", async () => {
  const { provider } = await setup();
  const a = provider({
    fetch: async () => {
      throw new Error("private endpoint");
    },
  });
  a.on("error", () => a.destroy());
  await a.whenSynced;
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(a.destroyed).toBe(true);
});

it("cancels a stalled ticket response body on timeout", async () => {
  const { provider, server } = await setup();
  const cancel = vi.fn();
  const a = provider({
    fetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel })),
    connectTimeoutMs: 10,
    reconnectDelayMs: 1_000,
  });
  await a.whenSynced;
  expect(cancel).toHaveBeenCalledOnce();
  expect(server.opened).toHaveLength(0);
});

it("uses the canonical document container for both room expansion and the ticket POST", async () => {
  const { provider, server, container } = await setup();
  const a = provider({ container: container.replace(/\/$/u, "") });
  await a.whenSynced;
  expect(a.mode).toBe("live");
  expect(JSON.parse(String(server.requests[0]?.init?.body))).toEqual({ room: container });
});
