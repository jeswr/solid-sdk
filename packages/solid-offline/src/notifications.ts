// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Page-side notifications client (P3, §5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE WEBSOCKET LIVES IN THE PAGE (decision 5), NEVER THE SW:
 *   The service worker is event-driven and terminated at will, so it cannot hold
 *   a long-lived socket. The PAGE owns the WebSocket (and the auth that the
 *   subscribe POST needs); on every change frame it `postMessage`s the SW, which
 *   runs the (unauthenticated) invalidation pipeline (`invalidation.ts`). This is
 *   consistent with P2: the page holds the socket + auth; the SW only invalidates.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * FLOW (§5):
 *   discovery (storage-description / `/.well-known/solid`) → subscribe PER
 *   CONTAINER (capped by the warm budget) + per-resource for hot resources →
 *   open the `receiveFrom` socket → forward frames to the SW.
 *
 *   Reconnect = exponential backoff + RE-SUBSCRIBE (channels are one-shot). While
 *   disconnected we slow-poll the warmed set with `If-None-Match`; on reconnect we
 *   run ONE ETag-resync sweep (see `invalidation.resyncSweep`, driven via the SW).
 *
 * The client is written against injected `fetch` + a `WebSocket` factory + a
 * timer set + an SW-postMessage sink, so the whole lifecycle is unit-testable
 * with a fake socket and fake fetch — no real network. Browser wiring (binding to
 * the real `WebSocket`, `navigator.onLine`, the active SW) is done by the caller
 * (`index.ts`).
 */

import type { NotificationActivityType, NotificationFrame } from './types.js';
import { parseTurtle } from './warmer-rdf.js';

const NOTIFY_SUBSCRIPTION = 'http://www.w3.org/ns/solid/notifications#subscription';
const STORAGE_DESCRIPTION_REL = 'http://www.w3.org/ns/solid/terms#storageDescription';
const WEBSOCKET_CHANNEL_2023 = 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023';
const KNOWN_ACTIVITY_TYPES: NotificationActivityType[] = [
  'Create',
  'Update',
  'Delete',
  'Add',
  'Remove',
];

/** The minimal WebSocket surface we depend on (so tests can supply a fake). */
export interface SocketLike {
  send?(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (ev: unknown) => void,
  ): void;
}

/** A factory that opens a socket for a `receiveFrom` URL. */
export type SocketFactory = (url: string) => SocketLike;

/** Timer surface (injected so tests drive backoff deterministically). */
export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface NotificationsDeps {
  /** The page's (DPoP-decorated) fetch — used for discovery, subscribe POSTs, and slow-poll GETs. */
  fetch: typeof fetch;
  /** Opens a WebSocket for a `receiveFrom` URL. */
  socketFactory: SocketFactory;
  /** Forward a parsed frame to the service worker (which runs the invalidation pipeline). */
  postToWorker(frame: NotificationFrame): void;
  /** Ask the SW to run the reconnect ETag-resync sweep (it owns the cache/meta). */
  requestResync(): void;
  /** Ask the SW to run one disconnected slow-poll pass over the warmed set. */
  requestPoll(): void;
  /** Whether the browser believes it is online (defaults to navigator.onLine via the caller). */
  isOnline?(): boolean;
  timers?: Timers;
  now?(): number;
}

export interface NotificationsConfig {
  /** Containers to subscribe to (one channel each). Capped by {@link maxChannels}. */
  containers: string[];
  /** Hot resources to subscribe to individually (e.g. the currently-open doc). */
  resources?: string[];
  /** Max channels (≈ the warm budget's resource cap, but channels are pricier). Default 50. */
  maxChannels?: number;
  /** Backoff base (ms). Default 1000. */
  backoffBaseMs?: number;
  /** Backoff cap (ms). Default 30_000. */
  backoffMaxMs?: number;
  /** Disconnected slow-poll interval (ms). Default 60_000. */
  pollIntervalMs?: number;
}

const DEFAULTS = {
  maxChannels: 50,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  pollIntervalMs: 60_000,
} as const;

/**
 * Discover the subscription-service endpoint for a resource on its server.
 *
 * Strategy (§5 / prod-solid-server `src/http/discovery.ts`):
 *  1. Follow the `storageDescription` Link rel on the resource (or `/.well-known/solid`)
 *     to the storage-description document.
 *  2. Read `notify:subscription` from the (Turtle) storage description.
 * Returns the subscription POST URL, or undefined if discovery fails.
 */
export async function discoverSubscriptionUrl(
  resourceUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  // 1. Find the storage-description document.
  let descriptionUrl: string | undefined;
  try {
    const head = await fetchImpl(new Request(resourceUrl, { method: 'HEAD' }));
    descriptionUrl = storageDescriptionFromLink(resourceUrl, head.headers.get('link'));
  } catch {
    descriptionUrl = undefined;
  }
  if (!descriptionUrl) {
    // Fall back to the origin's `/.well-known/solid`.
    descriptionUrl = await wellKnownStorageDescription(resourceUrl, fetchImpl);
  }
  if (!descriptionUrl) return undefined;

  // 2. Read notify:subscription from the storage description (Turtle).
  try {
    const res = await fetchImpl(
      new Request(descriptionUrl, { method: 'GET', headers: { accept: 'text/turtle' } }),
    );
    if (!res.ok) return undefined;
    const quads = parseTurtle(await res.text(), descriptionUrl);
    for (const q of quads) {
      if (q.predicate.value === NOTIFY_SUBSCRIPTION && q.object.termType === 'NamedNode') {
        return q.object.value;
      }
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

/** Extract a `rel="…storageDescription"` (or `rel="storageDescription"`) target from a Link header. */
export function storageDescriptionFromLink(
  base: string,
  linkHeader: string | null | undefined,
): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*(.*)/);
    if (!m) continue;
    const target = m[1];
    const params = (m[2] ?? '').toLowerCase();
    if (
      target &&
      (params.includes(STORAGE_DESCRIPTION_REL.toLowerCase()) ||
        /rel\s*=\s*"?storagedescription"?/.test(params))
    ) {
      try {
        return new URL(target, base).toString();
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Read the `storageDescription` URL out of the origin's `/.well-known/solid` (JSON-LD). */
async function wellKnownStorageDescription(
  resourceUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  let wellKnown: string;
  try {
    wellKnown = new URL('/.well-known/solid', resourceUrl).toString();
  } catch {
    return undefined;
  }
  try {
    const res = await fetchImpl(new Request(wellKnown, { method: 'GET' }));
    if (!res.ok) return undefined;
    const doc = (await res.json()) as { storageDescription?: unknown };
    return typeof doc.storageDescription === 'string' ? doc.storageDescription : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Subscribe to a topic via a WebSocketChannel2023 subscription POST, returning
 * the `receiveFrom` ws(s) URL. Channels are ONE-SHOT — a reconnect must re-subscribe.
 */
export async function subscribe(
  subscriptionUrl: string,
  topic: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(
      new Request(subscriptionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/ld+json' },
        body: JSON.stringify({
          '@context': ['https://www.w3.org/ns/solid/notification/v1'],
          type: 'WebSocketChannel2023',
          topic,
        }),
      }),
    );
    if (!res.ok) return undefined;
    const doc = (await res.json()) as { receiveFrom?: unknown };
    return typeof doc.receiveFrom === 'string' ? doc.receiveFrom : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a raw WebSocket message payload into a normalized {@link NotificationFrame}. */
export function parseFrame(data: unknown): NotificationFrame | undefined {
  let doc: unknown;
  if (typeof data === 'string') {
    try {
      doc = JSON.parse(data);
    } catch {
      return undefined;
    }
  } else if (data && typeof data === 'object') {
    doc = data;
  } else {
    return undefined;
  }
  const obj = doc as Record<string, unknown>;
  const type = obj.type;
  const activity = (Array.isArray(type) ? type : [type]).find((t) =>
    KNOWN_ACTIVITY_TYPES.includes(t as NotificationActivityType),
  ) as NotificationActivityType | undefined;
  if (!activity) return undefined;
  const object = flattenRef(obj.object);
  if (!object) return undefined;
  const frame: NotificationFrame = { type: activity, object };
  const target = flattenRef(obj.target);
  if (target !== undefined) frame.target = target;
  if (typeof obj.state === 'string') frame.state = obj.state;
  return frame;
}

/** A reference is either a bare IRI string or an object with an `id` (the server emits `{ id }`). */
function flattenRef(ref: unknown): string | undefined {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') {
    return (ref as { id: string }).id;
  }
  return undefined;
}

/** Exponential backoff with a cap. Attempt 0 → base; doubles each attempt; capped. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxMs);
}

/** A single per-topic channel the client maintains (re-subscribed on reconnect). */
interface Channel {
  topic: string;
  socket?: SocketLike;
  closed: boolean;
}

export interface NotificationsClient {
  /** Discover + subscribe + open sockets for every configured topic. */
  start(): Promise<void>;
  /** Close all sockets + cancel timers (does not unsubscribe server-side; channels expire). */
  stop(): void;
  /** True while at least one socket is open. */
  readonly connected: boolean;
}

/**
 * Create the page-side notifications client. Page-driven and unauthenticated-SW
 * consistent (decision 1 & 5): the page's fetch carries auth; the SW only
 * invalidates via the forwarded frames + the resync/poll requests.
 */
export function createNotificationsClient(
  deps: NotificationsDeps,
  config: NotificationsConfig,
): NotificationsClient {
  const timers: Timers = deps.timers ?? globalThis;
  const isOnline = deps.isOnline ?? (() => true);
  const maxChannels = config.maxChannels ?? DEFAULTS.maxChannels;
  const backoffBase = config.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  const backoffMax = config.backoffMaxMs ?? DEFAULTS.backoffMaxMs;
  const pollInterval = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;

  // Subscribe per-container (capped by the warm budget) + per-resource for hot resources.
  const topics = [...config.containers, ...(config.resources ?? [])].slice(0, maxChannels);
  const channels: Channel[] = topics.map((topic) => ({ topic, closed: false }));

  let subscriptionUrlCache: string | undefined;
  let openSockets = 0;
  let pollTimer: unknown;
  let stopped = false;

  async function discover(): Promise<string | undefined> {
    if (subscriptionUrlCache) return subscriptionUrlCache;
    const seed = topics[0];
    if (!seed) return undefined;
    subscriptionUrlCache = await discoverSubscriptionUrl(seed, deps.fetch);
    return subscriptionUrlCache;
  }

  /** Subscribe + open a socket for one channel, wiring reconnect on close. */
  async function connectChannel(channel: Channel, attempt: number): Promise<void> {
    if (stopped || channel.closed) return;
    if (!isOnline()) {
      // Offline: don't hammer; the `online` reconnect path (caller) restarts us,
      // and the SW slow-polls the warmed set meanwhile.
      schedulePoll();
      return;
    }
    const subscriptionUrl = await discover();
    if (!subscriptionUrl) {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    const receiveFrom = await subscribe(subscriptionUrl, channel.topic, deps.fetch);
    if (!receiveFrom) {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    openSocket(channel, receiveFrom, attempt);
  }

  function openSocket(channel: Channel, receiveFrom: string, attempt: number): void {
    if (stopped || channel.closed) return;
    let socket: SocketLike;
    try {
      socket = deps.socketFactory(receiveFrom);
    } catch {
      scheduleReconnect(channel, attempt + 1);
      return;
    }
    channel.socket = socket;

    socket.addEventListener('open', () => {
      openSockets += 1;
      cancelPoll();
      // On (re)connect: one ETag-resync sweep to catch up on frames missed while down.
      deps.requestResync();
    });
    socket.addEventListener('message', (ev: unknown) => {
      const data = (ev as { data?: unknown })?.data ?? ev;
      const frame = parseFrame(data);
      if (frame) deps.postToWorker(frame);
    });
    socket.addEventListener('close', () => {
      if (channel.socket === socket) channel.socket = undefined;
      openSockets = Math.max(0, openSockets - 1);
      // Channels are one-shot: a closed socket means re-subscribe from scratch.
      scheduleReconnect(channel, attempt + 1);
    });
    socket.addEventListener('error', () => {
      // Treat like a close; some environments fire error then close, some only error.
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    });
  }

  function scheduleReconnect(channel: Channel, attempt: number): void {
    if (stopped || channel.closed) return;
    schedulePoll(); // while we're down, slow-poll the warmed set
    const delay = backoffDelay(attempt, backoffBase, backoffMax);
    timers.setTimeout(() => {
      void connectChannel(channel, attempt);
    }, delay);
  }

  function schedulePoll(): void {
    if (stopped || pollTimer !== undefined || openSockets > 0) return;
    pollTimer = timers.setTimeout(function tick() {
      if (stopped || openSockets > 0) {
        pollTimer = undefined;
        return;
      }
      deps.requestPoll();
      pollTimer = timers.setTimeout(tick, pollInterval);
    }, pollInterval);
  }

  function cancelPoll(): void {
    if (pollTimer !== undefined) {
      timers.clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  return {
    async start(): Promise<void> {
      stopped = false;
      await Promise.all(channels.map((c) => connectChannel(c, 0)));
    },
    stop(): void {
      stopped = true;
      cancelPoll();
      for (const channel of channels) {
        channel.closed = true;
        try {
          channel.socket?.close();
        } catch {
          /* ignore */
        }
        channel.socket = undefined;
      }
      openSockets = 0;
    },
    get connected(): boolean {
      return openSockets > 0;
    },
  };
}
