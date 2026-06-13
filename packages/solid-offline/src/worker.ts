/// <reference lib="webworker" />
/**
 * `@solid/offline/worker` — the service-worker script (P0 install/intercept
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

import { MetadataStore } from './metadata-store.js';
import { type Broadcaster, type ByteCache, type SwrDeps, handleFetch } from './swr.js';
import type { PageToWorkerMessage } from './types.js';

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'solid-offline-v1';
const CHANNEL_NAME = 'solid-offline';

/** Lazily-opened singletons (the SW may be terminated + revived between events). */
let metaPromise: Promise<MetadataStore> | undefined;
let channel: BroadcastChannel | undefined;
let configuredWebId: string | undefined;

function getMeta(): Promise<MetadataStore> {
  if (!metaPromise) {
    metaPromise = MetadataStore.open(configuredWebId);
  }
  return metaPromise;
}

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
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
    if (data.config.webId && data.config.webId !== configuredWebId) {
      configuredWebId = data.config.webId;
      // WebId changed → drop the cached store handle so we re-open the scoped DB.
      metaPromise = undefined;
    }
    event.source?.postMessage({ type: 'ready' });
  } else if (data.type === 'ping') {
    event.source?.postMessage({ type: 'pong' });
  }
});

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
  const cache = await self.caches.open(CACHE_NAME);
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
