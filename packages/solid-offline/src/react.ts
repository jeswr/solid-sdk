// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * `@solid/offline/react` — THIN React hooks (P5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REACT IS AN OPTIONAL / PEER DEPENDENCY. The core (`@solid/offline`,
 * `@solid/offline/worker`) is framework-agnostic and imports nothing from here.
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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type OfflineStatusSnapshot,
  type OfflineStatusSurface,
  type StatusSurfaceOptions,
  createStatusSurface,
} from './status.js';
import type { UpdatedEvent } from './types.js';

export type { OfflineStatusSnapshot, ResourceFreshness, OfflineStatusSurface } from './status.js';

/**
 * Subscribe a component to the offline status surface. Pass a surface you already
 * created (recommended — share ONE across the app, e.g. from your offline
 * client), or let the hook create+own an internal one from `options`.
 *
 * Re-renders when: connectivity flips, or any tracked resource's freshness
 * changes (a revalidation, an `updated` broadcast, a mark*).
 */
export function useOfflineStatus(
  surfaceOrOptions?: OfflineStatusSurface | StatusSurfaceOptions,
): OfflineStatusSnapshot {
  // If the caller passed a surface, use it as-is and never tear it down here.
  // Otherwise create+own one for this component's lifetime.
  const provided = isSurface(surfaceOrOptions) ? surfaceOrOptions : undefined;
  const optionsRef = useRef<StatusSurfaceOptions | undefined>(
    isSurface(surfaceOrOptions) ? undefined : surfaceOrOptions,
  );

  const ownedRef = useRef<OfflineStatusSurface | undefined>(undefined);
  if (!provided && !ownedRef.current) {
    ownedRef.current = createStatusSurface(optionsRef.current ?? {});
  }
  const surface = provided ?? (ownedRef.current as OfflineStatusSurface);

  useEffect(() => {
    // Only tear down a surface WE own; never one the caller passed in.
    return () => {
      if (!provided) {
        ownedRef.current?.close();
        ownedRef.current = undefined;
      }
    };
  }, [provided]);

  return useSyncExternalStore(
    useCallback((cb) => surface.subscribe(cb), [surface]),
    () => surface.getSnapshot(),
    () => surface.getSnapshot(),
  );
}

function isSurface(x: unknown): x is OfflineStatusSurface {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as OfflineStatusSurface).subscribe === 'function' &&
    typeof (x as OfflineStatusSurface).getSnapshot === 'function'
  );
}

/** Per-resource lifecycle state surfaced by {@link useOfflineResource}. */
export type ResourceState = 'idle' | 'loading' | 'success' | 'error';

export interface UseOfflineResourceOptions {
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

export interface UseOfflineResourceResult<T> {
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

const DEFAULT_CHANNEL_NAME = 'solid-offline';

/**
 * A subscription to "has this URL been broadcast as updated?" backed by the
 * BroadcastChannel. Returns a monotonically-increasing counter; the hook treats
 * any increase as "re-read". Built as an external store so it is tear-free.
 */
function makeUpdatedStore(url: string | undefined, channelName: string) {
  let version = 0;
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;

  const onMessage = (event: MessageEvent) => {
    const data = event.data as UpdatedEvent | undefined;
    if (!data || data.event !== 'updated' || data.url !== url) return;
    version += 1;
    for (const l of listeners) l();
  };

  return {
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      if (!channel && url && typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(channelName);
        channel.addEventListener('message', onMessage);
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && channel) {
          channel.removeEventListener('message', onMessage);
          channel.close();
          channel = undefined;
        }
      };
    },
    getSnapshot(): number {
      return version;
    },
  };
}

/**
 * Read a single resource through the offline layer, re-reading automatically
 * when the SW broadcasts a newer version. THIN: it does the fetch + tracks
 * status; caching/freshness is the SW's job.
 */
export function useOfflineResource<T = Response>(
  url: string | undefined,
  options: UseOfflineResourceOptions = {},
): UseOfflineResourceResult<T> {
  const { fetch: customFetch, init, select, skip } = options;
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;

  const [data, setData] = useState<T | undefined>(undefined);
  const [state, setState] = useState<ResourceState>(skip ? 'idle' : 'loading');
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [reloadNonce, setReloadNonce] = useState(0);

  // Stable across renders; the doc-update store subscribes the component to
  // `updated` events for THIS url.
  const updatedStore = useMemo(() => makeUpdatedStore(url, channelName), [url, channelName]);
  const updatedVersion = useSyncExternalStore(
    updatedStore.subscribe,
    updatedStore.getSnapshot,
    () => 0,
  );
  // Has a newer version been broadcast since our last successful read?
  const readVersionRef = useRef(0);
  const outdated = updatedVersion > readVersionRef.current && state === 'success';

  // Track connectivity for the `online` flag.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  // The read inputs that should NOT, by themselves, trigger a re-read: `init`
  // (callers pass a fresh object each render), `select` and `fetch` (fresh
  // closures). We read the LATEST of each from a ref inside the effect, so a new
  // reference does not thrash the fetch — only url/skip/reload/`updated` do.
  const inputsRef = useRef({ init, select, customFetch });
  inputsRef.current = { init, select, customFetch };

  // `reloadNonce` + `updatedVersion` are the RE-READ TRIGGERS (read in the body);
  // the read INPUTS (init/select/fetch) come from `inputsRef`, so a fresh
  // `init`/`select`/`fetch` reference does not, by itself, re-fetch.
  useEffect(() => {
    if (skip || !url) {
      setState('idle');
      return;
    }
    // Touch the triggers so they are honestly part of this effect's data flow.
    void reloadNonce;
    const versionAtRead = updatedVersion;

    let cancelled = false;
    const { init: curInit, select: curSelect, customFetch: curFetch } = inputsRef.current;
    const doFetch = curFetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!doFetch) {
      setState('error');
      setError(new Error('[solid-offline] no fetch available'));
      return;
    }

    setState('loading');
    setError(undefined);

    const headers = new Headers(curInit?.headers);
    if (!headers.has('accept')) headers.set('accept', 'text/turtle');

    (async () => {
      try {
        const response = await doFetch(url, { ...curInit, headers });
        if (cancelled) return;
        setStale(response.headers.get('x-offline') === 'stale');
        const value = curSelect ? await curSelect(response.clone()) : (response as unknown as T);
        if (cancelled) return;
        setData(value as T);
        setState('success');
        // Mark the broadcast version we've now caught up to, so `outdated`
        // becomes false until the NEXT `updated` for this url.
        readVersionRef.current = versionAtRead;
      } catch (err) {
        if (cancelled) return;
        setError(err);
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, skip, reloadNonce, updatedVersion]);

  return {
    data,
    state,
    pending: state === 'loading',
    stale,
    outdated,
    online,
    error,
    reload,
  };
}
