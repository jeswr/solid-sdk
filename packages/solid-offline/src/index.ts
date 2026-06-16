/**
 * `solid-offline` — framework-agnostic page client (P0–P2).
 *
 * `createOfflineClient(config)` returns a handle whose `register()`:
 *   1. registers the service worker (`navigator.serviceWorker.register`),
 *   2. opens a `BroadcastChannel` for `{url, event:'updated'}` invalidation events,
 *   3. sets up page↔SW `postMessage` and hands the SW its config,
 *   4. (P2) starts the PAGE-DRIVEN warmer if `warm` is configured.
 *
 * PAGE-DRIVEN WARMER (P2, decision 1): the warmer runs in the page and issues its
 * fetches through the page's own (DPoP-decorated) `fetch`, so the SW merely
 * intercepts + caches them. The SW is NEVER authenticated. Notifications (P3) are
 * still config-only.
 *
 * NO React. (The `solid-offline/react` entry is P5.)
 */

import { type PurgeResult, purgeForWebId } from './logout.js';
import { type NotificationsClient, createNotificationsClient } from './notifications.js';
import { type OfflineStatusSurface, createStatusSurface } from './status.js';
import type {
  NotificationFrame,
  OfflineClient,
  OfflineClientConfig,
  PageToWorkerMessage,
  UpdatedEvent,
  WarmConfig,
} from './types.js';
import {
  type WarmController,
  type WarmResult,
  createWarmController,
  resolveBudget,
} from './warmer.js';

export type {
  OfflineClient,
  OfflineClientConfig,
  UpdatedEvent,
  CacheMetadata,
  WarmConfig,
  WarmBudget,
  AppShellConfig,
} from './types.js';
// P4 — app-shell precache pure logic (consumable by apps + the SW, unit-tested).
export {
  resolveAppShellConfig,
  sameShellConfig,
  shellCacheName,
  shellBucketComplete,
  resolveServingShellConfig,
  resolveAssetShellConfig,
  assetConfigCandidates,
  precacheAppShell,
  cleanupOldShellCaches,
  isPrecachedAsset,
  handleNavigation,
  handlePrecachedAsset,
} from './app-shell.js';
export type {
  ResolvedAppShellConfig,
  ShellCache,
  ShellCacheStorage,
  ShellDeps,
  ShellResult,
  ShellServeSource,
} from './app-shell.js';
export {
  warm,
  createWarmController,
  resolveBudget,
  DEFAULT_WARM_BUDGET,
  onIdle,
} from './warmer.js';
export type {
  WarmDeps,
  WarmVisit,
  WarmController,
  WarmResult,
  ResolvedWarmBudget,
} from './warmer.js';
export {
  deriveSeeds,
  containerChildren,
  typeIndexTargets,
  parseWacAllow,
  userCanRead,
} from './warmer-rdf.js';
export {
  createNotificationsClient,
  discoverSubscriptionUrl,
  subscribe,
  parseFrame,
  backoffDelay,
  storageDescriptionFromLink,
} from './notifications.js';
export type {
  NotificationsClient,
  NotificationsConfig,
  NotificationsDeps,
  SocketLike,
  SocketFactory,
} from './notifications.js';
export type {
  NotificationFrame,
  NotificationActivityType,
  NotificationsClientConfig,
  PageToWorkerMessage,
} from './types.js';
export { handleNotification, resyncSweep } from './invalidation.js';
export type { InvalidateDeps, InvalidateOutcome, SweepResult } from './invalidation.js';
// P5 — WebID cache scoping (§7), logout-purge, and the status surface.
export {
  scopeHash,
  scopeFor,
  dbNameForWebId,
  cacheNameForWebId,
  isScopeChange,
  DEFAULT_DB_NAME,
  DEFAULT_CACHE_NAME,
  DB_PREFIX,
  CACHE_PREFIX,
  ANONYMOUS_SCOPE,
} from './scope.js';
export { purgeForWebId } from './logout.js';
export type { PurgeResult, PurgeDeps, CacheStorageLike } from './logout.js';
export { createStatusSurface } from './status.js';
export type {
  OfflineStatusSurface,
  OfflineStatusSnapshot,
  ResourceFreshness,
  StatusSurfaceOptions,
  StatusListener,
} from './status.js';

const DEFAULTS = {
  workerUrl: '/solid-offline-worker.js',
  scope: '/',
  channelName: 'solid-offline',
} as const;

/** Listener for `updated` invalidation events broadcast by the SW. */
export type UpdatedListener = (event: UpdatedEvent) => void;

/**
 * Create an offline client. Does not touch the network or register anything
 * until you call `register()` — safe to construct during render.
 */
export function createOfflineClient(config: OfflineClientConfig = {}): OfflineClient & {
  onUpdated(listener: UpdatedListener): () => void;
  /** The offline/stale/pending status surface for this client (lazily created). */
  readonly status: OfflineStatusSurface;
} {
  const resolved = {
    ...config,
    workerUrl: config.workerUrl ?? DEFAULTS.workerUrl,
    scope: config.scope ?? DEFAULTS.scope,
    channelName: config.channelName ?? DEFAULTS.channelName,
  };

  let channel: BroadcastChannel | undefined;
  let registration: ServiceWorkerRegistration | undefined;
  let warmer: WarmController | undefined;
  let notifications: NotificationsClient | undefined;
  let status: OfflineStatusSurface | undefined;
  // The `controllerchange` listener `register()` adds. Kept so `close()` can
  // remove it — otherwise a delayed controllerchange after logout/account-switch
  // would re-post this (departed) identity's config and re-scope the SW to it.
  let onControllerChange: (() => void) | undefined;
  // CLOSED GUARD: every async registration callback (statechange on an installing
  // worker, controllerchange) checks this before posting config. After close()
  // (logout / account-switch) a delayed lifecycle event must NOT re-post this
  // departed identity's config — removing the controllerchange listener isn't
  // enough on its own because the `statechange` listener on an installing worker
  // can still fire on activation. The guard covers every such path.
  let closed = false;
  const listeners = new Set<UpdatedListener>();

  /** Post a control message to the active service worker (P3 invalidation path). */
  function postToWorker(message: PageToWorkerMessage): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const target = registration?.active ?? navigator.serviceWorker.controller;
    target?.postMessage(message);
  }

  /**
   * Start the page-side notifications client (P3, decision 5: the socket lives in
   * the PAGE). Discovers + subscribes per-container (capped by the warm budget),
   * opens sockets, and forwards each change frame to the SW for invalidation.
   * Reconnect/backoff/poll/resync are all driven from here via `postToWorker`.
   */
  function startNotifications(containers: string[]): NotificationsClient | undefined {
    if (closed) return undefined; // closed during a delayed warm .then() — don't start
    if (notifications) return notifications;
    if (!config.notifications) return undefined;
    if (typeof WebSocket === 'undefined') return undefined; // non-browser context
    const pageFetch =
      config.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (!pageFetch) return undefined;
    const nCfg = config.notifications === true ? {} : config.notifications;
    const topics = nCfg.containers ?? containers;
    if (topics.length === 0 && !nCfg.resources?.length) return undefined;
    notifications = createNotificationsClient(
      {
        fetch: pageFetch,
        socketFactory: (url) =>
          new WebSocket(url) as unknown as import('./notifications.js').SocketLike,
        postToWorker: (frame: NotificationFrame) => postToWorker({ type: 'notification', frame }),
        requestResync: () => postToWorker({ type: 'resync' }),
        requestPoll: () => postToWorker({ type: 'poll' }),
        isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      },
      {
        containers: topics,
        ...(nCfg.resources ? { resources: nCfg.resources } : {}),
        ...(nCfg.maxChannels !== undefined ? { maxChannels: nCfg.maxChannels } : {}),
        ...(nCfg.backoffBaseMs !== undefined ? { backoffBaseMs: nCfg.backoffBaseMs } : {}),
        ...(nCfg.backoffMaxMs !== undefined ? { backoffMaxMs: nCfg.backoffMaxMs } : {}),
        ...(nCfg.pollIntervalMs !== undefined ? { pollIntervalMs: nCfg.pollIntervalMs } : {}),
      },
    );
    void notifications.start();
    return notifications;
  }

  /**
   * Start the page-driven warmer (P2). Uses the page's own fetch (config.fetch
   * if supplied — typically the app's DPoP-decorated fetch — else the global
   * `fetch`), so the SW intercepts + caches; the SW is never authenticated.
   */
  function startWarmer(): WarmController | undefined {
    if (closed) return undefined; // closed during/after register() — don't start a crawl
    if (warmer) return warmer;
    if (config.warm === false || config.warm === undefined) return undefined;
    if (!config.webId) return undefined; // no identity → nothing to warm
    const pageFetch =
      config.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    if (!pageFetch) return undefined;
    const warmCfg = config.warm === true ? {} : config.warm;
    warmer = createWarmController({
      webId: config.webId,
      deps: { fetch: pageFetch },
      budget: resolveBudget(warmCfg.budget),
      warmOnLogin: warmCfg.warmOnLogin,
      rewarmOnReconnect: warmCfg.rewarmOnReconnect,
      // #16: pass through custom seeds (WarmConfig.seeds) when an explicit array
      // is supplied ('auto' / undefined keep pure profile derivation).
      ...(Array.isArray(warmCfg.seeds) ? { seeds: warmCfg.seeds } : {}),
      // P3 (P2-gap refactor): on reconnect, run the dedicated ETag-resync sweep in
      // the SW instead of re-issuing the full BFS. Only wired when notifications
      // are enabled (otherwise the warmer keeps its P2 full re-warm fallback).
      ...(config.notifications ? { onReconnect: () => postToWorker({ type: 'resync' }) } : {}),
    });
    return warmer;
  }

  function ensureChannel(): BroadcastChannel | undefined {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') return undefined;
    channel = new BroadcastChannel(resolved.channelName);
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as UpdatedEvent | undefined;
      if (data && data.event === 'updated') {
        for (const listener of listeners) listener(data);
      }
    });
    return channel;
  }

  function postConfig(target: ServiceWorker | null | undefined): void {
    if (!target) return;
    // Closed guard (roborev): after close() a delayed registration callback
    // (statechange/controllerchange) must NOT re-post the departed config.
    if (closed) return;
    // Send the RESOLVED channelName (#15) so the worker's update + invalidation
    // BroadcastChannel matches the one the page client/status surface listens on —
    // a custom `channelName` otherwise never receives the SW's events.
    //
    // STRIP PAGE-ONLY, NON-CLONEABLE fields before posting: `config.fetch` is a
    // function and `postMessage` structured-clones its argument, so leaving it in
    // throws `DataCloneError` and the SW is never configured. The SW never uses
    // the page's fetch anyway (decision 1: it authenticates nothing) — only the
    // page-side warmer/notifications do. We drop `fetch` (and any other function
    // value, defensively) so the config is always cloneable.
    const { fetch: _pageFetch, ...cloneableConfig } = config;
    const message: PageToWorkerMessage = {
      type: 'config',
      config: { ...cloneableConfig, channelName: resolved.channelName },
    };
    target.postMessage(message);
  }

  async function register(): Promise<ServiceWorkerRegistration | undefined> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      // Non-browser / unsupported context: no-op, the app still works online.
      return undefined;
    }

    // A (re-)register after a previous close() re-opens the client for posting.
    closed = false;

    ensureChannel();

    registration = await navigator.serviceWorker.register(resolved.workerUrl, {
      scope: resolved.scope,
    });

    // CLOSE-VS-REGISTER RACE (roborev High): if close() ran while we were awaiting
    // register(), bail NOW — before adding any listeners or starting the warmer/
    // notifications. Otherwise the continuation would attach listeners close()
    // already ran past (a leak it can't undo) and start departed-identity
    // background fetches. The `postConfig` closed-guard alone is not enough.
    if (closed) return registration;

    // Hand the SW its config (webId for cache scoping; warm/notifications for
    // later phases). Cover both "already active" and "installing" cases.
    const active = registration.active ?? navigator.serviceWorker.controller;
    if (active) {
      postConfig(active);
    }
    const installing = registration.installing ?? registration.waiting;
    if (installing) {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'activated') postConfig(installing);
      });
    }

    // Re-send config whenever a new SW takes control (e.g. after an update).
    // Stored + de-duplicated so `close()` can remove it (a delayed controllerchange
    // after logout must NOT re-post the departed identity's config).
    if (!onControllerChange) {
      onControllerChange = () => postConfig(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }

    // P2: kick off the page-driven warmer (it self-schedules on idle).
    startWarmer();

    // P3: start the page-side notifications client (decision 5: socket in the page).
    // If explicit containers are configured, start immediately; otherwise derive
    // the container set from a warm pass.
    if (config.notifications) {
      const nCfg = config.notifications === true ? {} : config.notifications;
      const hasExplicitTopics =
        (nCfg.containers && nCfg.containers.length > 0) ||
        (nCfg.resources && nCfg.resources.length > 0);
      if (hasExplicitTopics) {
        // Explicit topics (containers AND/OR resources) → start immediately. Pass
        // whatever containers were configured (possibly none — `startNotifications`
        // + the client still subscribe the explicit `resources`). This is the fix
        // for a resources-only config, which previously never started when
        // auto-warm was off/unavailable.
        startNotifications(nCfg.containers ?? []);
      } else {
        // #13: do NOT force a fresh full crawl here. `startWarmer()` already
        // scheduled the post-login idle warm; REUSE its result via `result()` so
        // we don't trigger a duplicate crawl. And if auto-warm is OFF
        // (`warm.warmOnLogin === false`), there is no scheduled warm to ride on —
        // forcing one would be a surprise full crawl, so we require explicit
        // `notifications.containers` instead of crawling.
        const w = startWarmer();
        const autoWarmOff =
          config.warm !== undefined &&
          config.warm !== true &&
          config.warm !== false &&
          (config.warm as WarmConfig).warmOnLogin === false;
        if (w && !autoWarmOff) {
          void w
            .result()
            .then((result) => {
              startNotifications(containersFromWarm(result));
            })
            .catch(() => {
              // The scheduled warm failed/was stopped before producing topics.
              // Notifications simply don't auto-start; an explicit `containers`
              // config or a later manual `warm()` still wires them.
            });
        }
      }
    }

    return registration;
  }

  /** The container URLs a warm pass visited — the natural per-container subscription set. */
  function containersFromWarm(result: WarmResult): string[] {
    const seen = new Set<string>();
    for (const visit of result.visits) {
      try {
        if (new URL(visit.url).pathname.endsWith('/')) seen.add(visit.url);
      } catch {
        /* skip unparseable */
      }
    }
    return [...seen];
  }

  /** Run (or re-run) the warmer now. See {@link OfflineClient.warm}. */
  async function warm(): Promise<WarmResult | undefined> {
    const w = startWarmer();
    if (!w) return undefined;
    const result = await w.run();
    // If notifications are enabled with AUTO-derived topics and aren't already
    // running, start them from this warm's result (the re-review corrective for
    // manual-warm users: `register()` doesn't auto-warm when `warmOnLogin: false`,
    // so the only signal to derive topics is this manual `warm()`).
    if (config.notifications && !notifications) {
      const nCfg = config.notifications === true ? {} : config.notifications;
      const hasExplicitTopics =
        (nCfg.containers && nCfg.containers.length > 0) ||
        (nCfg.resources && nCfg.resources.length > 0);
      if (!hasExplicitTopics) {
        startNotifications(containersFromWarm(result));
      }
    }
    return result;
  }

  function onUpdated(listener: UpdatedListener): () => void {
    listeners.add(listener);
    ensureChannel();
    return () => listeners.delete(listener);
  }

  /**
   * The offline status surface (offline/stale/pending) for this client. Lazily
   * created on first access; shares the client's `channelName` so it reflects
   * `updated` broadcasts. A vanilla app renders `status.getSnapshot()`; a React
   * app passes this to `useOfflineStatus` (`solid-offline/react`).
   */
  function getStatus(): OfflineStatusSurface {
    if (!status) {
      status = createStatusSurface({ channelName: resolved.channelName });
    }
    return status;
  }

  /**
   * MANDATORY logout-purge (§7): drop this WebID's Cache API cache + IndexedDB
   * metadata store, then tear the client down. Runs page-side (the `caches` /
   * `indexedDB` globals are same-origin) — no SW round-trip needed.
   */
  async function logout(): Promise<PurgeResult> {
    const result = await purgeForWebId(config.webId);
    close();
    return result;
  }

  function close(): void {
    // Mark closed FIRST so any in-flight registration callback (statechange/
    // controllerchange) that fires during/after teardown short-circuits in
    // postConfig and cannot re-scope the SW to this departed identity.
    closed = true;
    listeners.clear();
    channel?.close();
    channel = undefined;
    warmer?.stop();
    warmer = undefined;
    notifications?.stop();
    notifications = undefined;
    status?.close();
    status = undefined;
    // Remove the `controllerchange` listener so a SW lifecycle event arriving
    // AFTER close (logout / account-switch before the new SW activated) can't
    // re-post this (now departed) identity's config and re-scope the worker to it.
    if (onControllerChange && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }
    onControllerChange = undefined;
  }

  return {
    register,
    warm,
    close,
    logout,
    onUpdated,
    get status(): OfflineStatusSurface {
      return getStatus();
    },
    config: resolved,
  };
}
