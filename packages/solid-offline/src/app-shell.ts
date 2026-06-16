// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * App-shell precache (P4 — the missing half of "works COMPLETELY offline").
 *
 * The P1–P3 layer (swr.ts / warmer.ts / invalidation.ts) makes the user's *pod
 * data* available offline. But an app that can read its data offline still can't
 * *boot* offline unless its STATIC SHELL — the HTML document the browser loads
 * plus the JS/CSS bundles it pulls — is served without the network. This module
 * is that half: it precaches the app shell at SW `install` and serves it on a
 * navigation request when the network is unavailable, so the app paints from the
 * SW cache after the first visit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DESIGN — framework-agnostic, two app shapes (the GOAL's "Next out/ + vite dist/"):
 *   - A **vite** SPA emits `dist/index.html` + hashed `dist/assets/*.js|css`. There
 *     is ONE HTML document; every client route resolves to it. The navigation
 *     fallback therefore serves the single precached `index.html`.
 *   - A **Next static export** emits `out/` with PER-ROUTE HTML (`out/index.html`,
 *     `out/files/index.html`, …) + hashed `out/_next/static/**`. A navigation to a
 *     known route can serve that route's own HTML; an unknown route falls back to
 *     a configured `appShellFallback` (typically `/index.html` or `/404.html`).
 *   So the precache is just a LIST OF URLS the app passes in (its build tool emits
 *   them — `vite-plugin-pwa`/`workbox manifest`/a tiny glob), plus a fallback URL.
 *   This module does NOT know or care which framework produced them.
 *
 * SEPARATION FROM THE DATA CACHE (decisive, prevents the two layers fighting):
 *   The app shell lives in its OWN Cache API bucket (`solid-offline-shell-<ver>`),
 *   NOT the WebID-scoped pod-data cache. The shell is identity-independent + public
 *   (it's the app's own static assets), so it is NOT purged on logout and NOT
 *   re-fetched per identity. The pod-data SWR engine (swr.ts) owns same-origin pod
 *   reads; this module owns ONLY navigations + precached static assets. A request
 *   is routed to exactly one of them (see `isPrecachedAsset` / navigation check in
 *   worker.ts) so they never double-handle a request.
 *
 * NEVER-AUTHORITATIVE, BUT NETWORK-FIRST FOR THE SHELL:
 *   The shell is served network-first (so a deploy ships immediately when online)
 *   with a cache fallback (so it boots offline). Precached *assets* are
 *   cache-first (they are content-hashed and immutable — a new deploy emits new
 *   filenames, which miss the cache and fetch fresh). This mirrors the standard
 *   PWA app-shell model and composes with — does not duplicate — the in-app
 *   durable-cache/SWR that renders the data model.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { AppShellConfig } from './types.js';

// The public `AppShellConfig` (the shape the page passes to the SW) lives in
// `types.js` alongside the other config types and is re-exported from the package
// root. This module owns only the PURE app-shell logic + its internal/dep types.
export type { AppShellConfig } from './types.js';

/** Minimal Cache-API surface this module depends on (mockable in tests). */
export interface ShellCache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  addAll(requests: string[]): Promise<void>;
}

/** Minimal CacheStorage surface (open named caches + enumerate for cleanup). */
export interface ShellCacheStorage {
  open(name: string): Promise<ShellCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** Internal: the precache bucket name for a version. */
const SHELL_CACHE_PREFIX = 'solid-offline-shell-';

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

/** Resolve the config's defaults (fallback = first .html in precache; version = v1). */
export interface ResolvedAppShellConfig {
  precache: string[];
  fallback: string | undefined;
  version: string;
}

export function resolveAppShellConfig(config: AppShellConfig): ResolvedAppShellConfig {
  const version = config.version ?? 'v1';
  // De-dupe while preserving order (a manifest can list the HTML twice).
  const precache = [...new Set(config.precache)];
  const fallback =
    config.fallback ??
    precache.find((u) => {
      const path = pathOf(u);
      return path.endsWith('.html') || path.endsWith('/');
    });
  return { precache, fallback, version };
}

/**
 * True if two resolved shell configs are equivalent (same version + fallback +
 * ordered precache set). The SW uses this to decide whether a `config` message
 * carries a NEW deploy's manifest (→ replace + re-precache) or just re-sends the
 * current one (→ no-op), so a long-lived active worker doesn't pin the old shell.
 */
export function sameShellConfig(a: ResolvedAppShellConfig, b: ResolvedAppShellConfig): boolean {
  return (
    a.version === b.version &&
    a.fallback === b.fallback &&
    a.precache.length === b.precache.length &&
    a.precache.every((url, i) => url === b.precache[i])
  );
}

/** The pathname of a (possibly root-relative) URL, lowercased, '' on parse failure. */
function pathOf(url: string): string {
  try {
    // Root-relative URLs need a base; the base origin is irrelevant (we only read path).
    return new URL(url, 'https://x.invalid/').pathname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * INSTALL: open the versioned precache bucket and add every shell URL.
 *
 * Returns the resolved config so the worker can stash the fallback for the fetch
 * handler. A precache failure (one bad URL) must NOT abort install — the app still
 * works online, and a navigation simply falls through to the network. We therefore
 * add entries individually and swallow per-URL errors (logging via `onError`),
 * rather than `addAll` which rejects atomically on any single 404.
 */
export async function precacheAppShell(
  caches: ShellCacheStorage,
  config: ResolvedAppShellConfig,
  onError?: (url: string, error: unknown) => void,
): Promise<{ cached: string[]; failed: string[] }> {
  const cache = await caches.open(shellCacheName(config.version));
  const cached: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    config.precache.map(async (url) => {
      try {
        // `addAll`-equivalent for one URL: fetch + put, so a single 404 doesn't
        // sink the whole precache (the atomic `addAll` would).
        await cache.addAll([url]);
        cached.push(url);
      } catch (error) {
        failed.push(url);
        onError?.(url, error);
      }
    }),
  );
  return { cached, failed };
}

/**
 * ACTIVATE: delete every shell precache bucket that is NOT the current version, so
 * an old deploy's shell can't be served after an update. Only touches buckets with
 * our `solid-offline-shell-` prefix — never the pod-data caches or another app's.
 */
export async function cleanupOldShellCaches(
  caches: ShellCacheStorage,
  currentVersion: string,
): Promise<string[]> {
  const keep = shellCacheName(currentVersion);
  const names = await caches.keys();
  const removed: string[] = [];
  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith(SHELL_CACHE_PREFIX) && name !== keep) {
        const ok = await caches.delete(name);
        if (ok) removed.push(name);
      }
    }),
  );
  return removed;
}

/**
 * Is this request for one of the precached static assets (NOT a navigation)?
 *
 * We match on the request URL's pathname against the precache list's pathnames, so
 * a precached `/_next/static/abc.js` (or `/assets/index-abc.js`) is served from the
 * shell cache cache-first. The navigation document itself is handled separately
 * (`handleNavigation`) — this is only for the JS/CSS/font assets the shell pulls.
 */
export function isPrecachedAsset(requestUrl: string, config: ResolvedAppShellConfig): boolean {
  const reqPath = pathOf(requestUrl);
  if (!reqPath) return false;
  for (const url of config.precache) {
    if (pathOf(url) === reqPath) return true;
  }
  return false;
}

/** Outcome classifier for tests + observability. */
export type ShellServeSource =
  | 'shell-network' // navigation/asset served from a live network fetch (online)
  | 'shell-network-cached' // network fetch succeeded AND refreshed the cached shell
  | 'shell-cache-offline' // navigation served the cached shell because the network failed
  | 'shell-cache-fallback' // navigation served the configured fallback (unknown route, offline)
  | 'asset-cache-first' // precached asset served from cache without touching the network
  | 'asset-network' // precached asset missed the cache → network
  | 'shell-miss'; // navigation offline + nothing cached → network error surfaces

export interface ShellResult {
  response: Response;
  source: ShellServeSource;
}

/** Dependencies for the shell fetch handlers (all injectable for headless tests). */
export interface ShellDeps {
  caches: ShellCacheStorage;
  fetch: typeof fetch;
  /** Whether the browser believes it is online (navigator.onLine in the SW). */
  isOnline(): boolean;
  config: ResolvedAppShellConfig;
}

/**
 * Is this navigation URL one of the CONFIGURED shell documents (a precache entry
 * or the fallback)? Only configured shell docs may be WRITTEN to the shell cache.
 *
 * SECURITY (roborev Medium): the shell cache is identity-independent and survives
 * logout, so it must hold ONLY the app's declared public shell documents. Without
 * this gate, `handleNavigation` would cache ANY successful same-origin `text/html`
 * navigation — including an authenticated/private server-rendered page — into a
 * cache the next user of the browser can read. We therefore match the navigation
 * URL's pathname against the precache list + the fallback (origin-agnostic, like
 * `isPrecachedAsset`); an unknown route is served live but NEVER cached.
 */
function isConfiguredShellDoc(requestUrl: string, config: ResolvedAppShellConfig): boolean {
  const reqPath = pathOf(requestUrl);
  if (!reqPath) return false;
  if (config.fallback && pathOf(config.fallback) === reqPath) return true;
  for (const url of config.precache) {
    if (pathOf(url) === reqPath) return true;
  }
  return false;
}

/**
 * NAVIGATION HANDLER — the load-bearing piece for "the app boots offline".
 *
 * A navigation request (`request.mode === 'navigate'`, i.e. the browser loading a
 * document) is served NETWORK-FIRST so a fresh deploy ships immediately; on a
 * network failure (offline, or the server is down) it falls back to:
 *   1. the cached HTML for THIS exact route (a Next per-route export), else
 *   2. the configured `fallback` HTML (the vite SPA single document, or Next's
 *      index/404), which boots the app and lets client routing take over.
 * Only if NOTHING is cached does the network error surface (first-ever visit while
 * offline — unavoidable, the shell was never fetched).
 *
 * When online and the network succeeds, we refresh the cached copy of the route's
 * HTML — but ONLY for a CONFIGURED shell document (a precache entry / the
 * fallback), never an arbitrary same-origin route — so the offline fallback tracks
 * the latest deploy without ever caching a private/authenticated page (best-effort;
 * a put failure never affects the response).
 */
export async function handleNavigation(request: Request, deps: ShellDeps): Promise<ShellResult> {
  const cache = await deps.caches.open(shellCacheName(deps.config.version));

  if (deps.isOnline()) {
    try {
      const fresh = await deps.fetch(request);
      // Refresh the cached copy of this route's document so the offline fallback
      // stays current — but ONLY a real HTML doc that is a CONFIGURED shell URL
      // (never an arbitrary same-origin, possibly-authenticated, navigation answer).
      if (fresh.ok && isHtmlResponse(fresh) && isConfiguredShellDoc(request.url, deps.config)) {
        try {
          await cache.put(request, fresh.clone());
          return { response: fresh, source: 'shell-network-cached' };
        } catch {
          /* cache write failed (quota) — still return the live response */
        }
      }
      return { response: fresh, source: 'shell-network' };
    } catch {
      // Online flag was stale / the server is unreachable — fall through to cache.
    }
  }

  // OFFLINE (or the network just failed): serve a cached document so the app boots.
  const routeHit = await cache.match(request);
  if (routeHit) return { response: routeHit, source: 'shell-cache-offline' };

  if (deps.config.fallback) {
    const fallbackHit = await cache.match(deps.config.fallback);
    if (fallbackHit) return { response: fallbackHit, source: 'shell-cache-fallback' };
  }

  // Nothing cached (first-ever visit while offline). Let the real network error
  // surface — there is genuinely nothing we can serve.
  const response = await deps.fetch(request);
  return { response, source: 'shell-miss' };
}

/**
 * PRECACHED-ASSET HANDLER — cache-first for the immutable, content-hashed JS/CSS/
 * fonts the shell pulls. They never change under a fixed URL (a deploy emits new
 * hashed filenames), so a cache hit is authoritative and avoids the network. A miss
 * (e.g. precache failed for this one) goes to the network and is opportunistically
 * cached.
 */
export async function handlePrecachedAsset(
  request: Request,
  deps: ShellDeps,
): Promise<ShellResult> {
  const cache = await deps.caches.open(shellCacheName(deps.config.version));
  const hit = await cache.match(request);
  if (hit) return { response: hit, source: 'asset-cache-first' };

  // Miss: fetch and (best-effort) cache it for next time.
  const fresh = await deps.fetch(request);
  if (fresh.ok) {
    try {
      await cache.put(request, fresh.clone());
    } catch {
      /* quota — fine, it's never-authoritative */
    }
  }
  return { response: fresh, source: 'asset-network' };
}

/** True if a response looks like an HTML document (so we only cache real shells). */
function isHtmlResponse(response: Response): boolean {
  const ct = response.headers.get('content-type') ?? '';
  return ct.toLowerCase().includes('text/html');
}
