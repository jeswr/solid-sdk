// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/// <reference lib="webworker" />
/**
 * `solid-offline/worker` — the service-worker script (P0 install/intercept
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

import { createPodClient, type StorageClient } from '@jeswr/storage-client';
import { createLwsBackend } from '@jeswr/storage-client/lws';
import { createSolidBackend } from '@jeswr/storage-client/solid';
import {
  assetConfigCandidates,
  cleanupOldShellCaches,
  handleNavigation,
  handlePrecachedAsset,
  isPrecachedAsset,
  precacheAppShell,
  type ResolvedAppShellConfig,
  resolveAppShellConfig,
  resolveAssetShellConfig,
  resolveServingShellConfig,
  type ShellCacheStorage,
  type ShellDeps,
  sameShellConfig,
  shellBucketComplete,
} from './app-shell.js';
import { isPodCacheRequest, withCacheProvenance } from './cache-policy.js';
import { handleNotification, type InvalidateDeps, resyncSweep } from './invalidation.js';
import { MetadataStore } from './metadata-store.js';
import { isScopeChange } from './scope.js';
import { createPolicyStorage } from './storage.js';
import { type Broadcaster, handleFetch, type SwrDeps } from './swr.js';
import type { AppShellConfig, OfflineClientConfig, PageToWorkerMessage } from './types.js';
import { WARM_REQUEST_HEADER, type WarmStartMessage, WorkerWarmSession } from './warm-transport.js';

declare const self: ServiceWorkerGlobalScope & {
  /**
   * BUILD-TIME app-shell injection. An app can set this on the worker's global
   * BEFORE importing `solid-offline/worker`, so the precache list is available at
   * the `install` event (config postMessage only arrives after activate). A
   * vite/Next build emits the manifest into this slot, e.g.:
   *   self.__SOLID_OFFLINE_SHELL__ = { precache: [...], fallback: '/index.html', version: 'abc123' };
   *   import 'solid-offline/worker';
   * If absent, the shell is precached on the FIRST config message instead (a
   * round-trip later, but still before any offline navigation matters).
   */
  // biome-ignore lint/style/useNamingConvention: fixed service-worker injection key
  __SOLID_OFFLINE_SHELL__?: AppShellConfig;
};

const DEFAULT_CHANNEL_NAME = 'solid-offline';

/** Lazily-opened singletons (the SW may be terminated + revived between events). */
let metaPromise: Promise<MetadataStore> | undefined;
let channel: BroadcastChannel | undefined;
let configuredWebId: string | undefined;
let storageRoot: string | undefined;
let storageBackend: OfflineClientConfig['storageBackend'];
const warmSessions = new Map<string, WorkerWarmSession>();
let invalidationGeneration = 0;
/** Tracks whether `configuredWebId` has ever been set by a config message. */
let webIdConfigured = false;
/** Resolved BroadcastChannel name (#15): the page sends the channel it uses. */
let channelName: string = DEFAULT_CHANNEL_NAME;
/**
 * Resolved app-shell config (P4). Set from the build-time `__SOLID_OFFLINE_SHELL__`
 * injection at module load (so it's available at `install`), or from the first
 * `config` message carrying `appShell`. Drives the navigation/precache fetch path.
 */
let shellConfig: ResolvedAppShellConfig | undefined =
  self.__SOLID_OFFLINE_SHELL__ && self.__SOLID_OFFLINE_SHELL__.precache.length > 0
    ? resolveAppShellConfig(self.__SOLID_OFFLINE_SHELL__)
    : undefined;
/** Whether the precache (addAll) has already run for `shellConfig` this lifetime. */
let shellPrecached = false;
/**
 * The most recently RESOLVED serving config (the last-known-complete shell — see
 * `resolveServingShellConfig`). Cached so the SYNCHRONOUS fetch-routing path can
 * recognise the retained complete bucket's (old-hashed) asset URLs during a
 * half-applied update, without an async resolution before `event.respondWith`.
 * Populated by `servingConfig()` (the navigation that boots the app refreshes it).
 */
let lastServingConfig: ResolvedAppShellConfig | undefined;
/**
 * Monotonic token for the LATEST requested shell-config adoption (roborev Medium).
 * Each `adoptShellConfig` change captures the token it bumped to; a slower task
 * whose token is no longer the latest must NOT promote/cleanup — otherwise rapid
 * v2→v3 messages could let a late v2 overwrite v3 and delete v3's bucket.
 */
let shellAdoptToken = 0;

/** The CacheStorage cast to our minimal shell surface. */
function shellCaches(): ShellCacheStorage {
  return self.caches as unknown as ShellCacheStorage;
}

/** Build the shell fetch deps (its OWN, unauthenticated fetch — the shell is public). */
function shellDeps(config: ResolvedAppShellConfig): ShellDeps {
  return {
    caches: shellCaches(),
    fetch: (input, init) => self.fetch(input as RequestInfo, init),
    isOnline: () => self.navigator.onLine,
    config,
  };
}

/**
 * Precache a given config's bucket WITHOUT touching any other bucket. Returns true
 * only if EVERY configured precache entry cached (roborev Medium: boot-completeness
 * — a fallback HTML whose referenced JS/CSS failed to precache would boot to a broken
 * offline page). Does NOT mutate `shellConfig`/`shellPrecached` and does NOT clean up
 * old buckets; the caller promotes + cleans up only AFTER a complete precache, so the
 * old working bucket is never dropped before the new one can fully boot.
 */
async function precacheConfig(config: ResolvedAppShellConfig): Promise<boolean> {
  const { failed } = await precacheAppShell(shellCaches(), config);
  return failed.length === 0;
}

/** Run the install-time precache for the current shellConfig (idempotent). */
async function runPrecache(): Promise<void> {
  if (!shellConfig || shellPrecached) return;
  shellPrecached = true;
  try {
    const complete = await precacheConfig(shellConfig);
    if (!complete) {
      // roborev (Medium): the install/build-time path must honour the same
      // completeness rule as a config CHANGE. An INCOMPLETE precache (some JS/CSS
      // failed) must NOT mark the shell done and must NOT clean up older buckets —
      // otherwise the active worker can strand an offline boot on missing assets.
      // Leave it un-latched so a later activate / config message retries.
      shellPrecached = false;
      return;
    }
    // Complete: shellConfig is already the active version, so cleaning up other
    // (older) buckets here is safe — nothing else is serving.
    await cleanupOldShellCaches(shellCaches(), shellConfig.version).catch(() => []);
  } catch {
    // A precache failure must never abort install — the app still works online.
    shellPrecached = false;
  }
}

/**
 * Adopt an app-shell config delivered by a `config` message (roborev fix: a new
 * deploy's version/manifest must take effect, not be ignored for the active
 * worker's lifetime). A no-op when the incoming config is byte-equivalent.
 *
 * PROMOTE-AFTER-COMPLETE-PRECACHE, LATEST-WINS (roborev Mediums): the new shell is
 * precached into its OWN versioned bucket (buckets are version-keyed, so the old,
 * still-serving bucket is untouched) BEFORE `shellConfig` is switched. We promote
 * only once EVERY configured entry cached (not just the fallback — boot-completeness)
 * AND only if this task is still the LATEST requested adoption (a monotonic token, so
 * a slow v2 finishing after v3 can't overwrite v3 or delete its bucket). On any
 * failure / supersession we keep the old working shell config + bucket.
 */
function adoptShellConfig(next: AppShellConfig, event: ExtendableMessageEvent): void {
  if (next.precache.length === 0) return;
  const resolved = resolveAppShellConfig(next);
  if (shellConfig && sameShellConfig(shellConfig, resolved)) {
    // Same manifest as the current one. Normally a no-op — but if a previous
    // (install-time) precache was left INCOMPLETE (`!shellPrecached`), this is the
    // retry opportunity roborev (Low) asks for: re-run the precache so a transiently
    // failed asset can be fetched now. `runPrecache` is idempotent + completeness-gated.
    if (!shellPrecached) keepAlive(event, runPrecache);
    return;
  }

  // FIRST config (no current shell): promote immediately + precache (the SW had
  // nothing to serve anyway, so there's no working shell to protect).
  if (!shellConfig) {
    shellConfig = resolved;
    shellPrecached = false;
    shellAdoptToken += 1;
    keepAlive(event, runPrecache);
    return;
  }

  // CHANGE: claim the latest-request token, precache the NEW version's bucket first
  // (its own version key, so the old still-serving bucket is untouched), then promote
  // ONLY if (a) the precache was COMPLETE and (b) we are STILL the latest request;
  // clean up the now-stale old bucket(s) only AFTER promotion.
  shellAdoptToken += 1;
  const myToken = shellAdoptToken;
  keepAlive(event, async () => {
    try {
      const complete = await precacheConfig(resolved);
      if (complete && myToken === shellAdoptToken) {
        shellConfig = resolved;
        shellPrecached = true;
        await cleanupOldShellCaches(shellCaches(), resolved.version).catch(() => []);
      }
      // else: superseded by a newer config, or incomplete precache — keep the old
      // config + bucket serving; the latest request's own task will promote.
    } catch {
      // Keep the old, working shell config on any precache failure.
    }
  });
}

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

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(channelName);
  }
  return channel;
}

/**
 * Re-open the channel under a new name (#15) if it changed. The old channel is
 * dropped, not closed: an in-flight revalidation captured it in its deps and must
 * still deliver its terminal event there, or listeners that saw its start stay
 * `pending`. The worker never listens on it, so an unreferenced old channel is
 * garbage-collectable.
 */
function setChannelName(name: string | undefined): void {
  const resolved = name ?? DEFAULT_CHANNEL_NAME;
  if (resolved === channelName) return;
  channelName = resolved;
  channel = undefined;
}

self.addEventListener('install', (event: ExtendableEvent) => {
  // P4: precache the app shell at install (when injected via __SOLID_OFFLINE_SHELL__)
  // so the very next offline navigation can boot. Then activate immediately.
  event.waitUntil(runPrecache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  // P4: drop any stale shell precache buckets from a previous version, then take
  // control of open clients so interception starts without a reload.
  event.waitUntil(
    (async () => {
      // roborev (Medium): clean up old buckets ONLY when the current version's
      // precache is actually COMPLETE — checked DURABLY against the Cache API
      // (`shellBucketComplete`), not the transient in-memory `shellPrecached` flag
      // (which is unreliable after a restart). If the new bucket is incomplete,
      // deleting the previous COMPLETE bucket would strand offline boot — keep it
      // until a complete precache (a later config-message retry) cleans up.
      if (shellConfig && (await shellBucketComplete(shellCaches(), shellConfig))) {
        shellPrecached = true; // recover the flag from durable state too
        await cleanupOldShellCaches(shellCaches(), shellConfig.version).catch(() => []);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as PageToWorkerMessage | WarmStartMessage | undefined;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'warm-start') {
    const port = event.ports?.[0];
    const client = event.source as Client | null;
    if (!port) return;
    if (
      !client?.id ||
      warmSessions.has(client.id) ||
      data.root !== storageRoot ||
      !Number.isSafeInteger(data.maxBytes) ||
      data.maxBytes < 0 ||
      typeof data.token !== 'string' ||
      !data.token
    ) {
      port.postMessage({ id: 0, error: 'Worker warming scope unavailable or already active' });
      port.close();
      return;
    }
    const session = new WorkerWarmSession(data.root, data.maxBytes, data.token);
    warmSessions.set(client.id, session);
    event.waitUntil(
      new Promise<void>((resolve) => {
        port.onmessage = (message) => {
          const command = message.data;
          port.postMessage({ id: command.id, snapshot: session.command(command) });
          if (command.type === 'close') {
            if (warmSessions.get(client.id) === session) warmSessions.delete(client.id);
            port.close();
            resolve();
          }
        };
        port.postMessage({ id: 0, snapshot: session.command({ type: 'inspect' }) });
      }),
    );
    return;
  }
  if (data.type === 'config') {
    // #15: adopt the page's resolved channel name (custom channels must work).
    setChannelName(data.config.channelName);
    if (storageRoot !== data.config.storageRoot || configuredWebId !== data.config.webId)
      for (const session of warmSessions.values()) session.close();
    storageRoot = data.config.storageRoot;
    storageBackend = data.config.storageBackend;
    invalidationGeneration += 1;
    // P4: if the page sent an app-shell config, adopt it. `adoptShellConfig` is a
    // no-op when it equals the current one, and (roborev) REPLACES + re-precaches
    // when a new deploy ships a changed version/manifest — so a long-lived active
    // worker doesn't pin the old shell. The shell is identity-independent, so this
    // is independent of the webId scope below.
    if (data.config.appShell) {
      adoptShellConfig(data.config.appShell, event);
    }
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
    }
    // Logout deletes the database and closes our connection via versionchange.
    // Even a same-account login must reopen that handle, not reuse a closed DB.
    resetMeta();
    event.source?.postMessage({ type: 'ready' });
  } else if (data.type === 'ping') {
    event.source?.postMessage({ type: 'pong' });
  } else if (data.type === 'notification') {
    // P3: the page forwarded a change frame from its notification transport. Run the
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

/**
 * The deps shared by the SWR engine and the invalidation pipeline (the SW's OWN,
 * unauthenticated fetch — see invalidation.ts): the WebID-scoped byte cache + the
 * scoped metadata store + the SW fetch + the broadcast channel + the clock. The
 * SWR path adds `isOnline` on top (see `respond`).
 */
async function baseDeps(): Promise<Omit<SwrDeps, 'isOnline'>> {
  const generation = invalidationGeneration;
  const meta = (await getMeta()).withFence(() => {
    if (generation !== invalidationGeneration) throw new Error('Offline account changed');
  });
  return {
    cache: meta.bytes,
    meta,
    fetch: (input, init) => self.fetch(input as RequestInfo, init),
    broadcast: getChannel() as unknown as Broadcaster,
    now: () => Date.now(),
  };
}

/** Discover only for network operations; local invalidation needs just the storage boundary. */
async function invalidateDeps(): Promise<InvalidateDeps> {
  const root = storageRoot;
  const backend = storageBackend;
  const generation = invalidationGeneration;
  function checkScope(): void {
    if (generation !== invalidationGeneration)
      throw new Error('Offline invalidation scope changed');
  }
  if (!root) throw new Error('Offline invalidation requires a storage root');
  const { fetch: transport, ...deps } = await baseDeps();
  checkScope();
  const local = createSolidBackend({ root, fetch: transport });
  let discovered: Promise<StorageClient> | undefined;
  const networkStorage = (): Promise<StorageClient> => {
    checkScope();
    discovered ??= createPolicyStorage(async (fetch) => {
      if (backend?.protocol === 'solid') return createSolidBackend({ root, fetch });
      if (backend?.protocol === 'lws')
        return createLwsBackend({ root, fetch, storage: backend.id });
      return (await createPodClient({ storage: root, fetch })).storage;
    }, transport);
    return discovered;
  };
  return {
    ...deps,
    storage: {
      ...local,
      read: async (url, opts) => {
        const storage = await networkStorage();
        checkScope();
        const result = await storage.read(url, {
          ...opts,
          accept: storage.protocol === 'lws' ? '*/*' : opts?.accept,
        });
        if (generation !== invalidationGeneration) {
          await result.body?.cancel();
          checkScope();
        }
        return result;
      },
      head: async (url, opts) => {
        const storage = await networkStorage();
        checkScope();
        const result = await storage.head(url, opts);
        checkScope();
        return result;
      },
    },
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

  // P4 — APP-SHELL ROUTING (before the pod-data SWR engine). A request is handled
  // by EXACTLY ONE layer so they never double-handle it:
  //   - a NAVIGATION (the browser loading a document) → the shell network-first /
  //     cache-fallback handler, so the app boots offline;
  //   - a request for a PRECACHED, SAME-ORIGIN STATIC ASSET (hashed JS/CSS) →
  //     cache-first;
  //   - everything else (pod data, etc.) → the pod-data SWR engine in `respond`.
  //
  // SECURITY: the asset branch is gated on SAME-ORIGIN. The app shell is always
  // the app's own same-origin static files; `isPrecachedAsset` matches on PATHNAME
  // (origin-agnostic by design, so it's headless-testable), so without this gate a
  // CROSS-ORIGIN pod resource that merely shares a pathname with a precached asset
  // (e.g. `https://pod.example/assets/x.js`) would be diverted from the WebID-scoped
  // pod-data SWR path into the public shell handler. Cross-origin requests therefore
  // never reach the shell asset handler — they stay on the pod-data path.
  //
  // ROUTING (whether the shell layer handles a request AT ALL) is gated on
  // `shellConfig` ALONE — never the transient `shellPrecached` flag (roborev): that
  // flag resets when the SW is terminated/restarted, so gating routing on it would
  // make an offline COLD START bypass a FULLY-cached shell and fail to boot. The
  // Cache API is the durable truth.
  //
  // WHICH BUCKET is served, though, is the LAST KNOWN COMPLETE shell version, NOT
  // necessarily `shellConfig` (roborev Medium). If a half-applied update left the
  // current `shellConfig` bucket INCOMPLETE (the HTML cached but a referenced JS/CSS
  // entry failed), serving from it would boot the new HTML then 404 its missing
  // asset offline — even though an older COMPLETE bucket is retained. So both shell
  // handlers resolve the serving config via `resolveServingShellConfig` (current if
  // complete, else the newest retained complete bucket) so offline boot always
  // serves a COMPLETE shell, switching to the new bucket the moment it finishes
  // precaching. Both handlers also still degrade gracefully (network-first
  // navigation / network-fallback asset) when nothing complete exists yet.
  if (shellConfig && !request.headers.has(WARM_REQUEST_HEADER)) {
    if (request.mode === 'navigate' && method === 'GET') {
      event.respondWith(respondShellNavigation(event));
      return;
    }
    // Route a same-origin GET to the shell asset handler when its pathname matches a
    // precached asset of EITHER the current config OR the last-known-complete serving
    // config (roborev Medium). The second clause matters during a half-applied update:
    // we serve the OLD complete HTML, whose referenced (old-hashed) asset URLs are NOT
    // in the incomplete new `shellConfig` — without it those assets would route to the
    // pod-data path and fail offline. SECURITY: the same-origin gate is unchanged — a
    // cross-origin pod resource sharing a pathname never reaches the shell handler.
    if (
      method === 'GET' &&
      isSameOrigin(request.url) &&
      (isPrecachedAsset(request.url, shellConfig) ||
        (lastServingConfig !== undefined && isPrecachedAsset(request.url, lastServingConfig)))
    ) {
      event.respondWith(respondShellAsset(event));
      return;
    }
  }

  // Pod caching/provenance applies only inside the configured storage boundary.
  // Marked warming reads are scoped by their acknowledged session in `respond`.
  if (
    !request.headers.has(WARM_REQUEST_HEADER) &&
    (!storageRoot ||
      !isPodCacheRequest(
        request,
        createSolidBackend({ root: storageRoot, fetch: self.fetch.bind(self) }).isWithinStorage,
      ))
  )
    return;

  event.respondWith(respond(event));
});

/** True if `url` is same-origin as the service worker (the app's own assets). */
function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolve the shell config the handlers should SERVE FROM: the current `shellConfig`
 * if its bucket is durably complete, else the newest RETAINED COMPLETE bucket
 * (roborev Medium — never serve offline boot from a half-applied update). Falls back
 * to `shellConfig` itself if nothing complete exists (the handlers then degrade
 * gracefully). Returns `undefined` only when there is no shell config at all.
 */
async function servingConfig(): Promise<ResolvedAppShellConfig | undefined> {
  if (!shellConfig) return undefined;
  try {
    const resolved = await resolveServingShellConfig(shellCaches(), shellConfig);
    lastServingConfig = resolved;
    return resolved;
  } catch {
    // Resolution itself must never crash a fetch — fall back to the current config.
    return shellConfig;
  }
}

/** Serve a navigation through the shell handler (network-first, cache fallback). */
async function respondShellNavigation(event: FetchEvent): Promise<Response> {
  const config = await servingConfig();
  if (!config) return self.fetch(event.request);
  try {
    const result = await handleNavigation(event.request, shellDeps(config));
    return result.response;
  } catch {
    // Never let the shell layer crash a navigation — fall back to the live network.
    return self.fetch(event.request);
  }
}

/** Serve a precached static asset cache-first. */
async function respondShellAsset(event: FetchEvent): Promise<Response> {
  // SNAPSHOT BOTH route-time configs the SYNC router could have matched this asset
  // against, BEFORE the `await` (roborev Medium): the router routes a same-origin GET
  // when it matches EITHER `lastServingConfig` (`routedServing`) OR `shellConfig`
  // (`routedCurrent`) as they stood when the fetch fired. `await servingConfig()` (or
  // a concurrent `message`/`activate` promotion running during it) can ADVANCE both
  // `lastServingConfig` and `shellConfig` to the newly-complete version, dropping the
  // route-time bucket that actually holds the asset. Capturing both snapshots keeps
  // every bucket the router could have routed for in the candidate list.
  const routedServing = lastServingConfig;
  const routedCurrent = shellConfig;
  const serving = await servingConfig();
  if (!serving) return self.fetch(event.request);
  // An asset may live ONLY in the retained complete bucket (an OLD-hashed file the
  // OLD HTML pulls) or ONLY in the current bucket — different version buckets. Build
  // the de-duped candidate set (its ordering/de-dup contract is the pure, tested
  // `assetConfigCandidates`), then pick the config whose bucket actually HOLDS the
  // asset.
  const candidates = assetConfigCandidates(serving, routedServing, routedCurrent, shellConfig);
  const config =
    (await resolveAssetShellConfig(shellCaches(), event.request.url, candidates).catch(
      () => serving,
    )) ?? serving;
  try {
    const result = await handlePrecachedAsset(event.request, shellDeps(config));
    return result.response;
  } catch {
    return self.fetch(event.request);
  }
}

async function respond(event: FetchEvent): Promise<Response> {
  const generation = invalidationGeneration;
  const check = () => {
    if (generation !== invalidationGeneration) throw new Error('Offline account changed');
  };
  const networkResponse = (response: Response) =>
    event.request.method === 'GET' ? withCacheProvenance(response, 'miss') : response;
  const warming = warmSessions.get(event.clientId);
  const marked = event.request.headers.has(WARM_REQUEST_HEADER);
  const guarded =
    warming?.matches(event.request) &&
    createSolidBackend({ root: warming.root, fetch: self.fetch.bind(self) }).isWithinStorage(
      event.request.url,
    )
      ? warming
      : undefined;
  if (marked && !guarded) return networkResponse(new Response(null, { status: 413 }));
  const headers = new Headers(event.request.headers);
  headers.delete(WARM_REQUEST_HEADER);
  // Warming must finish fresh reads before closing its guard. Foreground reads
  // retain SWR; a marked GET uses the existing synchronous revalidation path.
  if (guarded && !headers.get('cache-control')?.toLowerCase().includes('no-store'))
    headers.set('cache-control', 'no-cache');
  const request = marked ? new Request(event.request, { headers }) : event.request;
  // The SWR engine's deps are the shared base + the online flag (the only field
  // the invalidation pipeline doesn't need).
  try {
    const deps: SwrDeps = {
      ...(await baseDeps()),
      isOnline: () => self.navigator.onLine,
    };
    check();
    const fetch = deps.fetch;
    deps.fetch = async (input, init) => {
      check();
      const response = await fetch(input, init);
      check();
      return response;
    };
    if (guarded) {
      const transport = deps.fetch;
      deps.fetch = (input, init) => guarded.fetch(new Request(input, init), transport);
    }
    const result = await handleFetch(request, deps);
    check();
    // Keep background revalidation alive past the response if the SW supports it.
    if (result.revalidation && typeof event.waitUntil === 'function') {
      event.waitUntil(result.revalidation.then(() => undefined));
    }
    return result.response;
  } catch {
    check();
    // A warming failure must never retry outside the transport budget.
    if (guarded) return networkResponse(new Response(null, { status: 413 }));
    // Never-authoritative: on any engine error, fall back to the live network so
    // the page still gets an authoritative answer.
    return networkResponse(await self.fetch(event.request));
  }
}
