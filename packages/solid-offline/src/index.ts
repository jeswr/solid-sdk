/**
 * `@solid/offline` — framework-agnostic page client (P0–P2).
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
 * NO React. (The `@solid/offline/react` entry is P5.)
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
} from './types.js';
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
    const message: PageToWorkerMessage = { type: 'config', config };
    target.postMessage(message);
  }

  async function register(): Promise<ServiceWorkerRegistration | undefined> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      // Non-browser / unsupported context: no-op, the app still works online.
      return undefined;
    }

    ensureChannel();

    registration = await navigator.serviceWorker.register(resolved.workerUrl, {
      scope: resolved.scope,
    });

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
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      postConfig(navigator.serviceWorker.controller);
    });

    // P2: kick off the page-driven warmer (it self-schedules on idle).
    startWarmer();

    // P3: start the page-side notifications client (decision 5: socket in the page).
    // If explicit containers are configured, start immediately; otherwise derive
    // the container set from a warm pass (the warmed containers) and start then.
    if (config.notifications) {
      const nCfg = config.notifications === true ? {} : config.notifications;
      if (nCfg.containers && nCfg.containers.length > 0) {
        startNotifications(nCfg.containers);
      } else {
        void warm().then((result) => {
          if (!result) return;
          startNotifications(containersFromWarm(result));
        });
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
    return w.run();
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
   * app passes this to `useOfflineStatus` (`@solid/offline/react`).
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
    listeners.clear();
    channel?.close();
    channel = undefined;
    warmer?.stop();
    warmer = undefined;
    notifications?.stop();
    notifications = undefined;
    status?.close();
    status = undefined;
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
