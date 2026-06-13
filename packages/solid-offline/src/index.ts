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

import type {
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
  const listeners = new Set<UpdatedListener>();

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

    return registration;
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

  function close(): void {
    listeners.clear();
    channel?.close();
    channel = undefined;
    warmer?.stop();
    warmer = undefined;
  }

  return {
    register,
    warm,
    close,
    onUpdated,
    config: resolved,
  };
}
