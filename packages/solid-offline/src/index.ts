/**
 * `@solid/offline` — framework-agnostic page client (P0).
 *
 * `createOfflineClient(config)` returns a handle whose `register()`:
 *   1. registers the service worker (`navigator.serviceWorker.register`),
 *   2. opens a `BroadcastChannel` for `{url, event:'updated'}` invalidation events,
 *   3. sets up page↔SW `postMessage` and hands the SW its config.
 *
 * The warmer (P2) and notifications (P3) are NOT implemented here — their config
 * is accepted, validated, and forwarded to the SW so the wire is ready. In P0/P1
 * the SW is a network-only passthrough + never-authoritative read cache.
 *
 * NO React. (The `@solid/offline/react` entry is P5.)
 */

import type {
  OfflineClient,
  OfflineClientConfig,
  PageToWorkerMessage,
  UpdatedEvent,
} from './types.js';

export type {
  OfflineClient,
  OfflineClientConfig,
  UpdatedEvent,
  CacheMetadata,
  WarmConfig,
  WarmBudget,
} from './types.js';

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
  const listeners = new Set<UpdatedListener>();

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

    return registration;
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
  }

  return {
    register,
    close,
    onUpdated,
    config: resolved,
  };
}
