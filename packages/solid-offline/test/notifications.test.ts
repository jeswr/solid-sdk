// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * §5 page-side notifications client.
 *
 * Drives discovery + subscribe + the socket lifecycle with a fake WebSocket + a
 * URL-routed fake fetch + injected timers — no real network. Covers:
 *   - discovery: Link rel=storageDescription → notify:subscription (Turtle)
 *   - discovery fallback: /.well-known/solid → storageDescription
 *   - subscribe POST → receiveFrom
 *   - parseFrame: {id} vs bare-IRI object/target, state, unknown types
 *   - message → postToWorker forwarding
 *   - open → requestResync (the reconnect ETag-resync sweep)
 *   - reconnect: exponential backoff + RE-SUBSCRIBE on close (one-shot channels)
 *   - disconnected slow-poll (requestPoll) while down
 *   - backoffDelay growth + cap
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type NotificationsDeps,
  type SocketLike,
  type Timers,
  backoffDelay,
  createNotificationsClient,
  discoverSubscriptionUrl,
  parseFrame,
  storageDescriptionFromLink,
  subscribe,
} from '../src/notifications.js';
import type { NotificationFrame } from '../src/types.js';

const BASE = 'https://alice.example';
const CONTAINER = `${BASE}/notes/`;
const DESC = `${BASE}/.well-known/solid/storage`;
const SUBSCRIBE_URL = `${BASE}/.notifications/WebSocketChannel2023/`;
const RECEIVE_FROM = 'wss://alice.example/.notifications/WebSocketChannel2023/abc123';

const STORAGE_DESC_TURTLE = `@prefix notify: <http://www.w3.org/ns/solid/notifications#> .
<${DESC}> notify:subscription <${SUBSCRIBE_URL}> ;
  notify:channelType <http://www.w3.org/ns/solid/notifications#WebSocketChannel2023> .`;

/** A URL+method routed fake fetch. */
function routedFetch(handler: (url: string, method: string, body?: string) => Response): {
  fetch: typeof fetch;
  calls: Array<{ url: string; method: string; body?: string }>;
} {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = req.method === 'POST' ? await req.clone().text() : undefined;
    calls.push({ url: req.url, method: req.method, body });
    return handler(req.url, req.method, body);
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

/** A controllable fake WebSocket. */
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  url: string;
  closed = false;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(listener);
    this.listeners[type] = list;
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, ev?: unknown): void {
    for (const l of this.listeners[type] ?? []) l(ev);
  }
}

/** A manual timer queue so backoff/poll fire deterministically. */
function manualTimers(): Timers & { flush(): void; pending: number } {
  let tasks: Array<{ fn: () => void; ms: number }> = [];
  return {
    setTimeout(fn: () => void, ms: number) {
      const t = { fn, ms };
      tasks.push(t);
      return t;
    },
    clearTimeout(handle: unknown) {
      tasks = tasks.filter((t) => t !== handle);
    },
    /** Run all currently-queued tasks once (in order). */
    flush(): void {
      const run = tasks;
      tasks = [];
      for (const t of run) t.fn();
    },
    get pending(): number {
      return tasks.length;
    },
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('discovery', () => {
  it('follows the storageDescription Link rel then reads notify:subscription', async () => {
    const { fetch } = routedFetch((url, method) => {
      if (method === 'HEAD') {
        return new Response(null, {
          headers: {
            link: `<${DESC}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
          },
        });
      }
      if (url === DESC) {
        return new Response(STORAGE_DESC_TURTLE, { headers: { 'content-type': 'text/turtle' } });
      }
      return new Response(null, { status: 404 });
    });
    expect(await discoverSubscriptionUrl(CONTAINER, fetch)).toBe(SUBSCRIBE_URL);
  });

  it('falls back to /.well-known/solid when no Link rel is present', async () => {
    const { fetch } = routedFetch((url, method) => {
      if (method === 'HEAD') return new Response(null);
      if (url === `${BASE}/.well-known/solid`) {
        return new Response(JSON.stringify({ storageDescription: DESC }), {
          headers: { 'content-type': 'application/ld+json' },
        });
      }
      if (url === DESC) return new Response(STORAGE_DESC_TURTLE);
      return new Response(null, { status: 404 });
    });
    expect(await discoverSubscriptionUrl(CONTAINER, fetch)).toBe(SUBSCRIBE_URL);
  });

  it('parses a storageDescription Link header', () => {
    expect(
      storageDescriptionFromLink(
        CONTAINER,
        `<${DESC}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
      ),
    ).toBe(DESC);
    expect(storageDescriptionFromLink(CONTAINER, null)).toBeUndefined();
  });
});

describe('subscribe', () => {
  it('POSTs a WebSocketChannel2023 body and returns receiveFrom', async () => {
    const { fetch, calls } = routedFetch((url) => {
      if (url === SUBSCRIBE_URL) {
        return new Response(JSON.stringify({ receiveFrom: RECEIVE_FROM }), {
          headers: { 'content-type': 'application/ld+json' },
        });
      }
      return new Response(null, { status: 404 });
    });
    const result = await subscribe(SUBSCRIBE_URL, CONTAINER, fetch);
    expect(result).toBe(RECEIVE_FROM);
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.type).toBe('WebSocketChannel2023');
    expect(body.topic).toBe(CONTAINER);
  });

  it('returns undefined on a non-ok subscribe', async () => {
    const { fetch } = routedFetch(() => new Response(null, { status: 403 }));
    expect(await subscribe(SUBSCRIBE_URL, CONTAINER, fetch)).toBeUndefined();
  });
});

describe('parseFrame', () => {
  it('flattens {id} object/target and reads state', () => {
    const frame = parseFrame(
      JSON.stringify({
        type: 'Update',
        object: { id: `${BASE}/notes/1` },
        state: '"v2"',
      }),
    );
    expect(frame).toEqual({ type: 'Update', object: `${BASE}/notes/1`, state: '"v2"' });
  });

  it('accepts a bare-IRI object and an Add target', () => {
    const frame = parseFrame(
      JSON.stringify({ type: 'Add', object: `${BASE}/notes/1`, target: { id: CONTAINER } }),
    );
    expect(frame).toEqual({ type: 'Add', object: `${BASE}/notes/1`, target: CONTAINER });
  });

  it('rejects unknown types and malformed JSON', () => {
    expect(parseFrame(JSON.stringify({ type: 'Like', object: 'x' }))).toBeUndefined();
    expect(parseFrame('not json')).toBeUndefined();
    expect(parseFrame(JSON.stringify({ type: 'Update' }))).toBeUndefined();
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and caps', () => {
    expect(backoffDelay(0, 1000, 30000)).toBe(1000);
    expect(backoffDelay(1, 1000, 30000)).toBe(2000);
    expect(backoffDelay(3, 1000, 30000)).toBe(8000);
    expect(backoffDelay(10, 1000, 30000)).toBe(30000); // capped
  });
});

/** Build a client whose fetch serves discovery + subscribe and whose sockets are FakeSockets. */
function clientHarness(opts: { online?: () => boolean } = {}) {
  const { fetch, calls } = routedFetch((url, method) => {
    if (method === 'HEAD') {
      return new Response(null, {
        headers: { link: `<${DESC}>; rel="storageDescription"` },
      });
    }
    if (url === DESC) return new Response(STORAGE_DESC_TURTLE);
    if (url === SUBSCRIBE_URL) {
      return new Response(JSON.stringify({ receiveFrom: RECEIVE_FROM }));
    }
    return new Response(null, { status: 404 });
  });
  const timers = manualTimers();
  const forwarded: NotificationFrame[] = [];
  const events: string[] = [];
  const deps: NotificationsDeps = {
    fetch,
    socketFactory: (url) => new FakeSocket(url),
    postToWorker: (f) => forwarded.push(f),
    requestResync: () => events.push('resync'),
    requestPoll: () => events.push('poll'),
    isOnline: opts.online ?? (() => true),
    timers,
  };
  return { deps, timers, forwarded, events, calls };
}

describe('socket lifecycle', () => {
  it('subscribes, opens a socket, requests a resync on open, and forwards frames', async () => {
    const h = clientHarness();
    const client = createNotificationsClient(h.deps, { containers: [CONTAINER] });
    await client.start();

    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0];
    expect(socket?.url).toBe(RECEIVE_FROM);

    socket?.emit('open');
    expect(client.connected).toBe(true);
    expect(h.events).toContain('resync'); // reconnect ETag-resync sweep on (re)connect

    socket?.emit('message', {
      data: JSON.stringify({ type: 'Update', object: `${CONTAINER}1`, state: '"v2"' }),
    });
    expect(h.forwarded).toEqual([{ type: 'Update', object: `${CONTAINER}1`, state: '"v2"' }]);
  });

  it('re-subscribes with backoff after the socket closes (channels are one-shot)', async () => {
    const h = clientHarness();
    const client = createNotificationsClient(h.deps, {
      containers: [CONTAINER],
      backoffBaseMs: 1000,
    });
    await client.start();
    const first = FakeSocket.instances[0];
    first?.emit('open');
    first?.emit('close');
    expect(client.connected).toBe(false);

    // A reconnect was scheduled (backoff). Fire timers → re-subscribe → new socket.
    expect(h.timers.pending).toBeGreaterThan(0);
    h.timers.flush();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(2));
    FakeSocket.instances[1]?.emit('open');
    expect(client.connected).toBe(true);
  });

  it('slow-polls (requestPoll) while disconnected', async () => {
    const h = clientHarness();
    const client = createNotificationsClient(h.deps, {
      containers: [CONTAINER],
      pollIntervalMs: 5000,
    });
    await client.start();
    FakeSocket.instances[0]?.emit('open');
    FakeSocket.instances[0]?.emit('close'); // now disconnected → a poll timer is armed
    h.timers.flush(); // fires poll tick(s) + the reconnect attempt
    expect(h.events).toContain('poll');
  });

  it('does not open a socket while offline; arms the slow-poll instead', async () => {
    const h = clientHarness({ online: () => false });
    const client = createNotificationsClient(h.deps, { containers: [CONTAINER] });
    await client.start();
    expect(FakeSocket.instances).toHaveLength(0);
    h.timers.flush();
    expect(h.events).toContain('poll');
  });

  it('stop() closes sockets and cancels timers', async () => {
    const h = clientHarness();
    const client = createNotificationsClient(h.deps, { containers: [CONTAINER] });
    await client.start();
    const socket = FakeSocket.instances[0];
    socket?.emit('open');
    client.stop();
    expect(socket?.closed).toBe(true);
    expect(client.connected).toBe(false);
  });

  it('caps the number of channels at maxChannels', async () => {
    const h = clientHarness();
    const client = createNotificationsClient(h.deps, {
      containers: [`${BASE}/a/`, `${BASE}/b/`, `${BASE}/c/`],
      maxChannels: 2,
    });
    await client.start();
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
