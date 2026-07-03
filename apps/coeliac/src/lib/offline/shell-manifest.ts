// AUTHORED-BY Claude Fable 5
/**
 * The app-shell precache manifest (BUILD-PLAN Brief 4B — "instant offline load
 * everywhere"; cross-app UX invariant #3). This is the single source of truth
 * for WHICH public app-shell documents the service worker (`public/sw.js`)
 * precaches, and the cache version. A drift-guard test asserts `public/sw.js`
 * lists exactly these routes at this version, so the JS worker and this typed
 * module can never silently diverge.
 *
 * SECURITY NOTE: every entry here is a PUBLIC same-origin app-shell route (a
 * client-rendered page whose private pod data is fetched client-side AFTER the
 * shell paints — the Next-16 caching-audit invariant). No private health data
 * is ever part of the precached shell, and the worker never caches cross-origin
 * (pod / Open Food Facts / research-API) or credentialed responses.
 */

/**
 * The versioned shell cache name. Bump the suffix whenever the precached shell
 * set changes so `activate` evicts the stale generation. Mirrors the semantics
 * of `@jeswr/solid-offline`'s `shellCacheName(version)` (validated in tests).
 */
export const SHELL_CACHE_VERSION = "v1";

/** The Cache API bucket name the worker writes the shell into. */
export const SHELL_CACHE_NAME = `coeliac-shell-${SHELL_CACHE_VERSION}`;

/** Prefix shared by every generation of the shell cache (for cleanup on activate). */
export const SHELL_CACHE_PREFIX = "coeliac-shell-";

/**
 * The primary-nav app-shell routes precached on install. These are the pages a
 * signed-in user reaches from the header nav (see `AppChrome`) — precaching
 * their public document shells lets a reopen while offline paint the real page
 * instantly instead of the browser's "no internet" error.
 */
export const APP_SHELL_ROUTES: readonly string[] = Object.freeze([
  "/",
  "/log",
  "/symptoms",
  "/insights",
  "/plan",
  "/protocols",
  "/genetics",
  "/knowledge/research",
  "/community",
]);

/**
 * The navigation fallback: when offline and the exact route is not cached, the
 * worker serves this shell document and the client router renders the target
 * page. It MUST be one of {@link APP_SHELL_ROUTES}.
 */
export const SHELL_FALLBACK_ROUTE = "/";

/**
 * The shape `@jeswr/solid-offline`'s `resolveAppShellConfig` accepts. Producing
 * it here (and round-tripping it through that library helper in tests) keeps the
 * door open to later adopting the full `solid-offline/worker` (which also does
 * WebID-scoped pod-data caching) without re-deriving the shell config.
 */
export interface AppShellManifest {
  version: string;
  precache: string[];
  fallback: string;
}

/** Build the shell manifest for the offline layer. */
export function appShellManifest(): AppShellManifest {
  return {
    version: SHELL_CACHE_VERSION,
    precache: [...APP_SHELL_ROUTES],
    fallback: SHELL_FALLBACK_ROUTE,
  };
}
