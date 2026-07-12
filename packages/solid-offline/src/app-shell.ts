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
  /**
   * Enumerate the requests cached in this bucket (the real `Cache.keys()`).
   * Used by {@link resolveServingShellConfig} to reconstruct the precache list of
   * a RETAINED complete bucket on a cold start, when the in-memory config that
   * produced it has been lost. Optional only so existing mocks needn't implement
   * it; the real Cache API always provides it.
   */
  keys?(): Promise<readonly Request[]>;
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
 * DURABLE completeness check: is EVERY configured precache entry actually present
 * in `config`'s versioned bucket RIGHT NOW? The Cache API — not an in-memory flag
 * — is the source of truth, because the in-memory flag resets when the SW is
 * terminated/restarted. An INCOMPLETE bucket (the HTML cached but a JS/CSS entry
 * failed to precache) is the exact "half-applied update" the boot-completeness
 * rule guards against: serving from it would boot the new HTML then 404 a missing
 * asset offline. A bucket with no entries is trivially complete only when the
 * config has no precache entries; an empty config is never "complete enough" to
 * serve (it has no fallback to boot), so a missing bucket / missing entry → false.
 */
export async function shellBucketComplete(
  caches: ShellCacheStorage,
  config: ResolvedAppShellConfig,
): Promise<boolean> {
  if (config.precache.length === 0) return false;
  try {
    const cache = await caches.open(shellCacheName(config.version));
    for (const url of config.precache) {
      if (!(await cache.match(url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconstruct a serving config from a RETAINED complete bucket's cached contents.
 *
 * On a cold start after a half-applied update, the in-memory `ResolvedAppShellConfig`
 * that produced the previous COMPLETE bucket is gone — only its Cache API bucket
 * survives. To keep serving offline boot from that complete bucket we rebuild a
 * config from what it holds: every cached request URL becomes a precache entry, the
 * fallback is derived the same way `resolveAppShellConfig` does (first `.html`/`/`),
 * and the version is the bucket's. A bucket that can't be enumerated (no `keys()`)
 * or holds nothing yields `undefined` — it can't serve a navigation.
 */
async function configFromBucket(
  caches: ShellCacheStorage,
  version: string,
): Promise<ResolvedAppShellConfig | undefined> {
  let cache: ShellCache;
  try {
    cache = await caches.open(shellCacheName(version));
  } catch {
    return undefined;
  }
  if (typeof cache.keys !== 'function') return undefined;
  let requests: readonly Request[];
  try {
    requests = await cache.keys();
  } catch {
    return undefined;
  }
  const precache = [...new Set(requests.map((r) => r.url))];
  if (precache.length === 0) return undefined;
  // `Cache.keys()` reflects INSERTION order, not the original manifest order, so
  // "first .html" would be non-deterministic across cold starts and could pick an
  // arbitrary route as the fallback when several HTML pages were precached (roborev
  // Medium). Prefer a DETERMINISTIC conventional fallback — the canonical root
  // documents apps actually configure (`/index.html`, then `/`, `/404.html`) — and
  // only when none of those is present fall back to the first HTML-ish entry (sorted
  // so the choice is stable regardless of insertion order).
  const htmlish = precache.filter((u) => {
    const path = pathOf(u);
    return path.endsWith('.html') || path.endsWith('/');
  });
  const fallback = pickConventionalFallback(htmlish);
  return { precache, fallback, version };
}

/**
 * Deterministically choose a navigation fallback from a bucket's HTML-ish entries.
 * Preference order (each within the candidate set, matched by lowercased pathname):
 *   1. an EXACT canonical root — `/index.html` → `/` → `/404.html`;
 *   2. for a BASE-PATH deploy (roborev Low — `/app/index.html`, `/app/404.html`),
 *      the SHORTEST `…/index.html` (the root-most index), preferred over any
 *      `404.html` so an under-base app boots its index, not its 404 page;
 *   3. the SHORTEST `…/` directory route;
 *   4. otherwise the lexicographically-first HTML-ish entry (stable regardless of
 *      `Cache.keys()` insertion order).
 * Returns `undefined` only for an empty set.
 */
function pickConventionalFallback(htmlish: string[]): string | undefined {
  if (htmlish.length === 0) return undefined;
  // 1. exact canonical roots.
  for (const conv of ['/index.html', '/', '/404.html']) {
    const hit = htmlish.find((u) => pathOf(u) === conv);
    if (hit) return hit;
  }
  // 2. base-path index.html — the shortest path ending in `/index.html` (root-most).
  const indexes = htmlish
    .filter((u) => pathOf(u).endsWith('/index.html'))
    .sort((a, b) => pathOf(a).length - pathOf(b).length || (pathOf(a) < pathOf(b) ? -1 : 1));
  if (indexes.length > 0) return indexes[0];
  // 3. a directory route (`…/`) — the shortest, root-most.
  const dirs = htmlish
    .filter((u) => pathOf(u).endsWith('/'))
    .sort((a, b) => pathOf(a).length - pathOf(b).length || (pathOf(a) < pathOf(b) ? -1 : 1));
  if (dirs.length > 0) return dirs[0];
  // 4. stable last resort.
  return [...htmlish].sort()[0];
}

/**
 * The shell config the fetch handlers should actually SERVE FROM — the LAST KNOWN
 * COMPLETE shell version (roborev Medium: never serve offline boot from a
 * half-applied update).
 *
 * Routing in the worker is gated on whether ANY shell config exists, but the
 * BUCKET a navigation/asset is served from must be a COMPLETE one, so offline boot
 * is never stranded by an update that cached the HTML but failed a referenced
 * JS/CSS entry. Resolution, in order:
 *   1. If `current`'s bucket is durably COMPLETE → serve from `current` (the steady
 *      state, and the moment a new deploy finishes precaching it switches here).
 *   2. Otherwise the new bucket is INCOMPLETE — find the most-recent RETAINED
 *      COMPLETE shell bucket (cleanup keeps it until the new one completes) and
 *      serve from it, reconstructed from its cached contents. "Most recent" =
 *      lexicographically-greatest version among the complete retained buckets; the
 *      caller versions buckets with a build hash/incrementing tag so the newest
 *      complete one wins (and a tie with `current` is impossible — `current` failed
 *      step 1).
 *   3. If nothing complete exists (first-ever install still precaching, or every
 *      bucket incomplete) → return `current` so the handlers still degrade
 *      gracefully (network-first navigation / network-fallback asset), exactly as
 *      before — routing to an incomplete shell is never WORSE than no shell.
 */
export async function resolveServingShellConfig(
  caches: ShellCacheStorage,
  current: ResolvedAppShellConfig,
): Promise<ResolvedAppShellConfig> {
  if (await shellBucketComplete(caches, current)) return current;

  // `current` is incomplete: prefer the newest RETAINED complete bucket.
  let names: string[];
  try {
    names = await caches.keys();
  } catch {
    return current;
  }
  const versions = names
    .filter((n) => n.startsWith(SHELL_CACHE_PREFIX) && n !== shellCacheName(current.version))
    .map((n) => n.slice(SHELL_CACHE_PREFIX.length))
    .sort()
    .reverse();

  for (const version of versions) {
    const candidate = await configFromBucket(caches, version);
    // configFromBucket already returns only the bucket's cached entries, so the
    // reconstructed config is complete-by-construction — but re-check defensively
    // (a concurrent cleanup could have raced it).
    if (candidate && (await shellBucketComplete(caches, candidate))) return candidate;
  }

  // Nothing complete to fall back to — serve from `current` and let the handlers
  // degrade gracefully (network-first / network-fallback) as before.
  return current;
}

/**
 * Build the ORDERED, de-duped candidate list for serving a precached ASSET during a
 * half-applied update (roborev). The caller passes, in PREFERENCE order, every config
 * whose bucket might hold the asset: the (post-resolve) serving config, the two
 * ROUTE-TIME snapshots the sync router could have matched on (`lastServingConfig` and
 * `shellConfig` as they stood when the fetch fired — a concurrent promotion can
 * advance both during the resolve await), and the (post-resolve) current `shellConfig`.
 * `undefined` entries are dropped and configs are de-duped by VERSION (so a bucket is
 * never probed twice), preserving the first/most-preferred occurrence's order.
 *
 * Extracting this as a pure function makes the candidate-construction contract
 * directly testable (the worker's `respondShellAsset` glue is browser-only, excluded
 * from coverage): every distinct route-time + post-resolve config must be considered.
 */
export function assetConfigCandidates(
  ...configs: Array<ResolvedAppShellConfig | undefined>
): ResolvedAppShellConfig[] {
  const seen = new Set<string>();
  const out: ResolvedAppShellConfig[] = [];
  for (const c of configs) {
    if (!c || seen.has(c.version)) continue;
    seen.add(c.version);
    out.push(c);
  }
  return out;
}

/**
 * Choose the shell config whose bucket should serve a precached ASSET request
 * (roborev Medium). The sync fetch-router may route an asset because it matches
 * EITHER the current config OR the last-known-complete (retained) config — but the
 * two map to DIFFERENT version buckets. Blindly opening the serving config's bucket
 * can miss an OLD-hashed asset that lives only in the retained bucket (and vice
 * versa), failing offline. So we pick, among the provided candidate configs (most
 * preferred first — typically [serving, current]), the FIRST whose bucket actually
 * holds the requested asset. If none holds it, return the most-preferred candidate
 * so the handler still attempts cache-first then degrades to the network.
 */
export async function resolveAssetShellConfig(
  caches: ShellCacheStorage,
  requestUrl: string,
  candidates: readonly ResolvedAppShellConfig[],
): Promise<ResolvedAppShellConfig | undefined> {
  const present = candidates.filter((c) => c && isPrecachedAsset(requestUrl, c));
  if (present.length === 0) return candidates[0];
  for (const config of present) {
    try {
      const cache = await caches.open(shellCacheName(config.version));
      if (await cache.match(requestUrl)) return config;
    } catch {
      /* try the next candidate */
    }
  }
  // Configured as a precached asset somewhere but not yet cached in any candidate
  // bucket — serve from the first config that lists it (cache-first → network).
  return present[0];
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
 * The CANONICAL configured shell URL whose pathname matches this navigation URL
 * (ignoring query/hash), or `undefined` if the route is not a configured shell doc.
 *
 * SECURITY (roborev): the shell cache is identity-independent and survives logout,
 * so it must hold — and serve — ONLY the app's declared public shell documents. Two
 * properties make that airtight, and this single resolver gives both:
 *   1. We cache + read under the CANONICAL configured URL (e.g. `/index.html`),
 *      NEVER the live request URL. So a navigation to `/index.html?user=alice`
 *      (a private, server-rendered query variant) maps to the public `/index.html`
 *      key — its private bytes are never stored, and an attacker can't seed a
 *      per-query entry. The fallback (`/index.html`) is preferred over an arbitrary
 *      precache entry so the canonical key is stable.
 *   2. We match on pathname only (query/hash stripped) so client routes still
 *      resolve, but the WRITE/READ key is the canonical URL, not the query variant.
 * An unknown route returns `undefined`: it is served live but never cached, and on
 * the offline path it is NOT read from the cache — it goes straight to the fallback.
 */
function canonicalShellUrl(requestUrl: string, config: ResolvedAppShellConfig): string | undefined {
  const reqPath = pathOf(requestUrl);
  if (!reqPath) return undefined;
  if (config.fallback && pathOf(config.fallback) === reqPath) return config.fallback;
  for (const url of config.precache) {
    if (pathOf(url) === reqPath) return url;
  }
  return undefined;
}

/**
 * The path+search of a (possibly root-relative) URL with the PATHNAME lowercased
 * (matching `pathOf`'s case-insensitive path convention) but the QUERY preserved
 * BYTE-FOR-BYTE — query keys/values are case-sensitive (roborev Low). `null` on a
 * parse failure (distinct from an empty path, so two failures don't compare equal).
 */
function pathAndSearchOf(url: string): string | null {
  try {
    const u = new URL(url, 'https://x.invalid/');
    return `${u.pathname.toLowerCase()}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Is this navigation an EXACT configured shell URL (same path AND query)? Only an
 * exact match may be WRITTEN to the shell cache.
 *
 * SECURITY (roborev): configured shell URLs are static, public documents (typically
 * no query). A navigation that carries a personalizing query (`/index.html?user=alice`)
 * may be a server-rendered PRIVATE variant, so its response must NEVER be stored —
 * even though it resolves to the canonical `/index.html` for the offline READ (so a
 * client route still boots). We gate the WRITE on an exact path+query match against a
 * configured URL (pathname case-insensitive, query byte-exact): a query variant fails
 * it and is served live only.
 */
function isExactConfiguredShellUrl(requestUrl: string, config: ResolvedAppShellConfig): boolean {
  const reqPS = pathAndSearchOf(requestUrl);
  if (reqPS === null) return false;
  if (config.fallback && pathAndSearchOf(config.fallback) === reqPS) return true;
  for (const url of config.precache) {
    if (pathAndSearchOf(url) === reqPS) return true;
  }
  return false;
}

/**
 * NAVIGATION HANDLER — the load-bearing piece for "the app boots offline".
 *
 * A navigation request (`request.mode === 'navigate'`, i.e. the browser loading a
 * document) is served NETWORK-FIRST so a fresh deploy ships immediately; on a
 * network failure (offline, or the server is down) it falls back to:
 *   1. the cached HTML for THIS route — keyed by its CANONICAL configured shell URL
 *      (a Next per-route export), else
 *   2. the configured `fallback` HTML (the vite SPA single document, or Next's
 *      index/404), which boots the app and lets client routing take over.
 * Only if NOTHING is cached does the network error surface (first-ever visit while
 * offline — unavoidable, the shell was never fetched).
 *
 * SECURITY (roborev): the shell cache holds — and serves — ONLY the app's declared
 * public shell documents:
 *   - WRITE is gated on an EXACT configured-URL match (`isExactConfiguredShellUrl`,
 *     path+query): a personalizing query variant (`/index.html?user=alice`) or any
 *     unconfigured route is NEVER stored, so a private/server-rendered page can't
 *     enter the identity-independent, logout-surviving cache.
 *   - READ (offline) is keyed by the CANONICAL configured URL (`canonicalShellUrl`),
 *     never the live request, so client routes still boot AND a poisoned/unconfigured
 *     cache entry is never served (an unknown route skips straight to the fallback).
 * When online + the network succeeds for an exact shell doc, we refresh its cached
 * copy so the offline fallback tracks the latest deploy (best-effort; a put failure
 * never affects the response).
 */
export async function handleNavigation(request: Request, deps: ShellDeps): Promise<ShellResult> {
  const cache = await deps.caches.open(shellCacheName(deps.config.version));
  const canonical = canonicalShellUrl(request.url, deps.config);

  if (deps.isOnline()) {
    try {
      const fresh = await deps.fetch(request);
      // Refresh the cached copy of this route's document so the offline fallback
      // stays current — but ONLY a real HTML doc for an EXACT configured shell URL
      // (a query variant is served live, never stored), keyed under its canonical URL.
      if (
        canonical &&
        isExactConfiguredShellUrl(request.url, deps.config) &&
        fresh.ok &&
        isHtmlResponse(fresh)
      ) {
        try {
          await cache.put(canonical, fresh.clone());
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
  // Read ONLY a configured shell doc, under its CANONICAL key — never an arbitrary
  // (possibly poisoned/private) `cache.match(request)`. An unconfigured route skips
  // straight to the public fallback below.
  if (canonical) {
    const routeHit = await cache.match(canonical);
    if (routeHit) return { response: routeHit, source: 'shell-cache-offline' };
  }

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
