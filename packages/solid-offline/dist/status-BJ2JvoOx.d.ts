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
/** Freshness of a single tracked resource. */
type ResourceFreshness = 'fresh' | 'stale' | 'pending' | 'updated';
/** The immutable snapshot a consumer renders. */
interface OfflineStatusSnapshot {
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
type StatusListener = () => void;
/** Minimal BroadcastChannel surface the status surface subscribes to. */
interface StatusChannel {
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    close(): void;
}
/** Minimal window-like target for connectivity events (injectable for tests). */
interface ConnectivityTarget {
    addEventListener(type: 'online' | 'offline', listener: () => void): void;
    removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}
interface StatusSurfaceOptions {
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
interface OfflineStatusSurface {
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
/**
 * Create the offline status surface. Safe to construct in any context: if there
 * is no BroadcastChannel / window it simply reports `online: true` and no
 * resources, and all mark* calls are still recorded.
 */
declare function createStatusSurface(options?: StatusSurfaceOptions): OfflineStatusSurface;

export { type OfflineStatusSurface as O, type ResourceFreshness as R, type StatusSurfaceOptions as S, type OfflineStatusSnapshot as a, type StatusListener as b, createStatusSurface as c };
