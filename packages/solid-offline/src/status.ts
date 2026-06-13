// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Offline / stale / pending STATUS SURFACE (P5).
 *
 * A tiny, framework-agnostic observable that turns the signals the offline layer
 * already produces into a snapshot a UI can render:
 *
 *   - CONNECTIVITY  — online vs offline, from `navigator.onLine` + the `online` /
 *     `offline` window events.
 *   - PER-RESOURCE FRESHNESS — for each URL the consumer cares about:
 *       'pending'  a (re)validation is in flight (the consumer marked it),
 *       'stale'    the last read was served from cache while offline / unconfirmed
 *                  (the SWR engine tagged it `X-Offline: stale`),
 *       'fresh'    a revalidation confirmed it (304) or the consumer marked a 200,
 *       'updated'  the SW broadcast `{event:'updated'}` for it — a newer version
 *                  is available (the consumer should re-read).
 *
 * It is deliberately a *plain* `subscribe`/`getSnapshot` store (no framework) so
 * the React hooks (`react.ts`) can wrap it with `useSyncExternalStore` and a
 * vanilla app can use it directly. It listens to the same `BroadcastChannel` the
 * SWR engine broadcasts `updated` events on, so any tab's revalidation flips the
 * status for every tab.
 *
 * It holds NO bytes and is NOT authoritative — it only reflects events. Tearing
 * it down (`close()`) drops listeners + the channel; it never touches the cache.
 */

import type { UpdatedEvent } from './types.js';

/** Freshness of a single tracked resource. */
export type ResourceFreshness = 'fresh' | 'stale' | 'pending' | 'updated';

/** The immutable snapshot a consumer renders. */
export interface OfflineStatusSnapshot {
  /** Whether the browser believes it is online. */
  online: boolean;
  /** Number of resources currently marked `pending` (a revalidation is in flight). */
  pending: number;
  /** Number of resources currently marked `stale` (served unconfirmed / offline). */
  stale: number;
  /** Number of resources for which a newer version was broadcast (`updated`). */
  updated: number;
  /** Per-URL freshness for every resource the consumer has touched. */
  resources: Readonly<Record<string, ResourceFreshness>>;
}

/** A change listener (no args — call `getSnapshot()` to read). */
export type StatusListener = () => void;

/** Minimal BroadcastChannel surface the status surface subscribes to. */
export interface StatusChannel {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

/** Minimal window-like target for connectivity events (injectable for tests). */
export interface ConnectivityTarget {
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

export interface StatusSurfaceOptions {
  /** BroadcastChannel name the SW broadcasts `updated` events on. Default: 'solid-offline'. */
  channelName?: string;
  /** Inject a channel (tests). Falls back to a real `BroadcastChannel` when available. */
  channel?: StatusChannel;
  /** Inject connectivity event source (tests). Falls back to `globalThis`/`window`. */
  connectivity?: ConnectivityTarget;
  /** Inject the initial/current online flag (tests). Falls back to `navigator.onLine`. */
  isOnline?: () => boolean;
}

/** The handle returned by {@link createStatusSurface}. */
export interface OfflineStatusSurface {
  /** Subscribe to changes. Returns an unsubscribe fn. Used by `useSyncExternalStore`. */
  subscribe(listener: StatusListener): () => void;
  /** Read the current immutable snapshot. Stable identity until something changes. */
  getSnapshot(): OfflineStatusSnapshot;
  /** Mark a resource as having a revalidation in flight. */
  markPending(url: string): void;
  /** Mark a resource confirmed fresh (e.g. a 304, or a fresh read). */
  markFresh(url: string): void;
  /** Mark a resource served from cache while unconfirmed / offline. */
  markStale(url: string): void;
  /** Stop tracking a resource entirely (drops it from the snapshot). */
  forget(url: string): void;
  /** Tear down listeners + the channel. Does not touch the cache. */
  close(): void;
}

const DEFAULT_CHANNEL_NAME = 'solid-offline';

function defaultIsOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

function defaultConnectivity(): ConnectivityTarget | undefined {
  if (typeof window !== 'undefined') return window as unknown as ConnectivityTarget;
  if (typeof globalThis !== 'undefined' && 'addEventListener' in globalThis) {
    return globalThis as unknown as ConnectivityTarget;
  }
  return undefined;
}

function defaultChannel(name: string): StatusChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  return new BroadcastChannel(name) as unknown as StatusChannel;
}

/**
 * Create the offline status surface. Safe to construct in any context: if there
 * is no BroadcastChannel / window it simply reports `online: true` and no
 * resources, and all mark* calls are still recorded.
 */
export function createStatusSurface(options: StatusSurfaceOptions = {}): OfflineStatusSurface {
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const channel = options.channel ?? defaultChannel(channelName);
  const connectivity = options.connectivity ?? defaultConnectivity();

  const listeners = new Set<StatusListener>();
  const resources = new Map<string, ResourceFreshness>();
  let online = isOnline();

  // Cached immutable snapshot — `useSyncExternalStore` REQUIRES `getSnapshot` to
  // return a referentially-stable value when nothing changed (else it loops).
  let snapshot: OfflineStatusSnapshot = computeSnapshot();

  function computeSnapshot(): OfflineStatusSnapshot {
    let pending = 0;
    let stale = 0;
    let updated = 0;
    const map: Record<string, ResourceFreshness> = {};
    for (const [url, freshness] of resources) {
      map[url] = freshness;
      if (freshness === 'pending') pending += 1;
      else if (freshness === 'stale') stale += 1;
      else if (freshness === 'updated') updated += 1;
    }
    return { online, pending, stale, updated, resources: map };
  }

  function emit(): void {
    snapshot = computeSnapshot();
    for (const listener of listeners) listener();
  }

  function setFreshness(url: string, freshness: ResourceFreshness): void {
    if (resources.get(url) === freshness) return;
    resources.set(url, freshness);
    emit();
  }

  const onMessage = (event: MessageEvent): void => {
    const data = event.data as UpdatedEvent | undefined;
    if (!data || data.event !== 'updated') return;
    // A newer version exists for this URL. Only flag resources the consumer is
    // already tracking — we don't want to grow the map for every change in the
    // pod, only the ones a view is actually showing.
    if (resources.has(data.url)) setFreshness(data.url, 'updated');
  };

  const onOnline = (): void => {
    if (online) return;
    online = true;
    emit();
  };
  const onOffline = (): void => {
    if (!online) return;
    online = false;
    emit();
  };

  channel?.addEventListener('message', onMessage);
  connectivity?.addEventListener('online', onOnline);
  connectivity?.addEventListener('offline', onOffline);

  return {
    subscribe(listener: StatusListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): OfflineStatusSnapshot {
      return snapshot;
    },
    markPending(url: string): void {
      setFreshness(url, 'pending');
    },
    markFresh(url: string): void {
      setFreshness(url, 'fresh');
    },
    markStale(url: string): void {
      setFreshness(url, 'stale');
    },
    forget(url: string): void {
      if (!resources.delete(url)) return;
      emit();
    },
    close(): void {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      connectivity?.removeEventListener('online', onOnline);
      connectivity?.removeEventListener('offline', onOffline);
      listeners.clear();
      resources.clear();
    },
  };
}
