import { O as OfflineStatusSurface, S as StatusSurfaceOptions, a as OfflineStatusSnapshot } from './status-BJ2JvoOx.js';
export { R as ResourceFreshness } from './status-BJ2JvoOx.js';

/**
 * `solid-offline/react` — THIN React hooks (P5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REACT IS AN OPTIONAL / PEER DEPENDENCY. The core (`solid-offline`,
 * `solid-offline/worker`) is framework-agnostic and imports nothing from here.
 * Only an app that already depends on React reaches for this entry, so we list
 * `react` as a (peer) dependency and import it here, never from the core.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * These hooks are intentionally THIN — they own no caching, no fetch policy, no
 * RDF. They bridge two things the rest of the package already produces:
 *
 *   useOfflineStatus()   — wraps the framework-agnostic status surface
 *                          (`status.ts`) with `useSyncExternalStore`, so a
 *                          component re-renders when connectivity flips or a
 *                          tracked resource goes pending/stale/updated. Tear-safe
 *                          across concurrent React.
 *
 *   useOfflineResource() — reads one URL THROUGH the page's fetch (so the SW
 *                          intercepts + caches it — never-authoritative), exposes
 *                          {data, status, online, stale, pending, error, reload},
 *                          and SUBSCRIBES to the `updated` BroadcastChannel event
 *                          for that URL via `useSyncExternalStore`, re-reading
 *                          automatically when the SW broadcasts a new version.
 *
 * `useSyncExternalStore` is the right primitive: it is tear-free under React 18+
 * concurrency and is exactly "subscribe to an external store + read a snapshot",
 * which is what a BroadcastChannel-backed status store is.
 */

/**
 * Subscribe a component to the offline status surface. Pass a surface you already
 * created (recommended — share ONE across the app, e.g. from your offline
 * client), or let the hook create+own an internal one from `options`.
 *
 * Re-renders when: connectivity flips, or any tracked resource's freshness
 * changes (a revalidation, an `updated` broadcast, a mark*).
 */
declare function useOfflineStatus(surfaceOrOptions?: OfflineStatusSurface | StatusSurfaceOptions): OfflineStatusSnapshot;
/** Per-resource lifecycle state surfaced by {@link useOfflineResource}. */
type ResourceState = 'idle' | 'loading' | 'success' | 'error';
interface UseOfflineResourceOptions {
    /**
     * The fetch to read through. Pass your DPoP-decorated / authenticated fetch so
     * the read is authenticated; the SW still intercepts + caches it. Defaults to
     * the global `fetch`.
     */
    fetch?: typeof fetch;
    /** Request init (headers, etc.). `Accept` defaults to `text/turtle` for RDF reads. */
    init?: RequestInit;
    /** Transform the Response into the value you want to render (e.g. parse RDF). */
    select?: (response: Response) => Promise<unknown> | unknown;
    /** BroadcastChannel name to watch for `updated` events. Default: 'solid-offline'. */
    channelName?: string;
    /** Don't fetch on mount (call `reload()` yourself). Default: false. */
    skip?: boolean;
}
interface UseOfflineResourceResult<T> {
    /** The selected value (or the raw `Response` if no `select`), once loaded. */
    data: T | undefined;
    /** Lifecycle state of the current read. */
    state: ResourceState;
    /** True while a read is in flight. */
    pending: boolean;
    /** True if the last served response carried `X-Offline: stale` (cache, unconfirmed). */
    stale: boolean;
    /** True if the SW broadcast a newer version for this URL since the last read. */
    outdated: boolean;
    /** Whether the browser is currently online. */
    online: boolean;
    /** The error from the last failed read, if any. */
    error: unknown;
    /** Re-read the resource now (always hits the offline path → SW → cache/network). */
    reload(): void;
}
/**
 * Read a single resource through the offline layer, re-reading automatically
 * when the SW broadcasts a newer version. THIN: it does the fetch + tracks
 * status; caching/freshness is the SW's job.
 */
declare function useOfflineResource<T = Response>(url: string | undefined, options?: UseOfflineResourceOptions): UseOfflineResourceResult<T>;

export { OfflineStatusSnapshot, OfflineStatusSurface, type ResourceState, type UseOfflineResourceOptions, type UseOfflineResourceResult, useOfflineResource, useOfflineStatus };
