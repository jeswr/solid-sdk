/// <reference lib="webworker" />
/**
 * `@jeswr/offline/worker` — the service-worker script (P0 install/intercept
 * plumbing + P1 read cache).
 *
 * P0: install + activate + claim, page↔SW `postMessage`, and a network-only
 * passthrough that *proves* fetch interception works.
 * P1: route cacheable GET/HEAD through the never-authoritative SWR engine
 * ({@link handleFetch}); everything else passes through untouched.
 *
 * The decision logic lives in `cache-policy.ts` + `swr.ts` (fully unit-tested).
 * This file is the thin browser-only adapter and is intentionally excluded from
 * coverage — it cannot be exercised without a real SW lifecycle.
 */

import { type InvalidateDeps, handleNotification, resyncSweep } from './invalidation.js';
import { MetadataStore } from './metadata-store.js';
import { cacheNameForWebId, isScopeChange } from './scope.js';
import { type Broadcaster, type ByteCache, type SwrDeps, handleFetch } from './swr.js';
import type { PageToWorkerMessage } from './types.js';

declare const self: ServiceWorkerGlobalScope;

const DEFAULT_CHANNEL_NAME = 'solid-offline';

/** Lazily-opened singletons (the SW may be terminated + revived between events). */
let metaPromise: Promise<MetadataStore> | undefined;
let channel: BroadcastChannel | undefined;
let configuredWebId: string | undefined;
/** Tracks whether `configuredWebId` has ever been set by a config message. */
let webIdConfigured = false;
/** Resolved BroadcastChannel name (#15): the page sends the channel it uses. */
let channelName: string = DEFAULT_CHANNEL_NAME;

function getMeta(): Promise<MetadataStore> {
  if (!metaPromise) {
    metaPromise = MetadataStore.open(configuredWebId);
  }
  return metaPromise;
}

/** Close + drop the cached metadata handle so the next access re-opens the scoped DB. */
function resetMeta(): void {
  const prev = metaPromise;
  metaPromise = undefined;
  // Close the previous handle once it resolves (best-effort; never throws).
  void prev?.then((store) => store.close()).catch(() => undefined);
}

/**
 * The WebID-scoped Cache API name (§7). Derived from `configuredWebId` so the
 * bytes cache matches the metadata DB scope and logout-purge can drop exactly
 * one identity's cache. Falls back to the anonymous scope before config arrives.
 */
function cacheName(): string {
  return cacheNameForWebId(configuredWebId);
}

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(channelName);
  }
  return channel;
}

/** Re-open the channel under a new name (#15) if it changed. */
function setChannelName(name: string | undefined): void {
  const resolved = name ?? DEFAULT_CHANNEL_NAME;
  if (resolved === channelName) return;
  channelName = resolved;
  channel?.close();
  channel = undefined;
}

self.addEventListener('install', (event: ExtendableEvent) => {
  // Activate the new SW immediately (no waiting for old tabs to close).
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  // Take control of open clients so interception starts without a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as PageToWorkerMessage | undefined;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'config') {
    // #15: adopt the page's resolved channel name (custom channels must work).
    setChannelName(data.config.channelName);
    // #4: treat `undefined` as a VALID scope change. After a logged-in user, an
    // anonymous client (webId === undefined) MUST be able to clear the previous
    // identity scope; the old code only updated on a truthy webId, so the SW kept
    // reading/writing the departed user's scoped cache. Compare-and-assign even
    // when undefined, and reset (close) the metadata handle on ANY change.
    const nextWebId = data.config.webId;
    const changed = isScopeChange(webIdConfigured, configuredWebId, nextWebId);
    if (changed) {
      configuredWebId = nextWebId;
      webIdConfigured = true;
      // WebId scope changed → close + drop the store handle so we re-open the
      // newly-scoped DB, and drop the channel so a renamed channel is re-opened.
      resetMeta();
    }
    event.source?.postMessage({ type: 'ready' });
  } else if (data.type === 'ping') {
    event.source?.postMessage({ type: 'pong' });
  } else if (data.type === 'notification') {
    // P3: the page forwarded a change frame from its WebSocket. Run the
    // (unauthenticated) invalidation pipeline; keep it alive past the handler.
    const frame = data.frame;
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await handleNotification(frame, deps);
    });
  } else if (data.type === 'resync') {
    // P3: reconnect ETag-resync sweep over the whole warmed set.
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await resyncSweep(deps);
    });
  } else if (data.type === 'poll') {
    // P3: disconnected slow-poll — one conditional pass over the warmed set.
    keepAlive(event, async () => {
      const deps = await invalidateDeps();
      await resyncSweep(deps);
    });
  }
});

/** Keep the SW alive for an async task triggered by a message (best-effort). */
function keepAlive(event: ExtendableMessageEvent, task: () => Promise<void>): void {
  const p = task().catch(() => undefined);
  if (typeof event.waitUntil === 'function') event.waitUntil(p);
}

/** Build the invalidation deps (the SW's OWN, unauthenticated fetch — see invalidation.ts). */
async function invalidateDeps(): Promise<InvalidateDeps> {
  const cache = await self.caches.open(cacheName());
  const meta = await getMeta();
  return {
    cache: cache as unknown as ByteCache,
    meta,
    fetch: (input, init) => self.fetch(input as RequestInfo, init),
    broadcast: getChannel() as unknown as Broadcaster,
    now: () => Date.now(),
  };
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Only GET/HEAD can be cached; anything else is a pure passthrough. We still
  // intercept (to prove plumbing) but do not touch it.
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return; // let the browser handle it normally
  }

  event.respondWith(respond(event));
});

async function respond(event: FetchEvent): Promise<Response> {
  const cache = await self.caches.open(cacheName());
  const meta = await getMeta();
  const deps: SwrDeps = {
    cache: cache as unknown as ByteCache,
    meta,
    fetch: (input, init) => self.fetch(input as RequestInfo, init),
    broadcast: getChannel() as unknown as Broadcaster,
    now: () => Date.now(),
    isOnline: () => self.navigator.onLine,
  };

  try {
    const result = await handleFetch(event.request, deps);
    // Keep background revalidation alive past the response if the SW supports it.
    if (result.revalidation && typeof event.waitUntil === 'function') {
      event.waitUntil(result.revalidation.then(() => undefined));
    }
    return result.response;
  } catch {
    // Never-authoritative: on any engine error, fall back to the live network so
    // the page still gets an authoritative answer.
    return self.fetch(event.request);
  }
}
