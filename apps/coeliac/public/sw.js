/*
 * Coeliac Diary — app-shell offline service worker.
 * AUTHORED-BY Claude Fable 5
 *
 * Delivers cross-app UX invariant #3 (instant offline load): a reopen while
 * offline paints the real app shell from cache instead of the browser's
 * "no internet" page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY INVARIANT (load-bearing — do not weaken):
 *   This worker caches ONLY same-origin GET responses for the PUBLIC app shell —
 *   our own route documents (client-rendered; private pod data is fetched
 *   client-side AFTER paint) and hashed `/_next/static` build output.
 *
 *   It NEVER intercepts, reads, or caches:
 *     • cross-origin requests — the Solid pod, Open Food Facts, ClinicalTrials,
 *       Europe PMC, community hosts (these `return` un-touched so the browser
 *       makes its normal, credentialed request and nothing is written to cache);
 *     • non-GET requests (writes always go to the network);
 *   so PRIVATE HEALTH DATA never enters any Cache API bucket via this layer and
 *   stays client-fetched (the Next-16 caching-audit invariant).
 *
 *   Pod-data offline READ caching (WebID-scoped + logout-purged) is a deliberately
 *   separate, larger increment via `@jeswr/solid-offline`'s worker — NOT shipped
 *   here (it needs browser E2E to verify the cross-WebID isolation safely).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Keep the constants below in lock-step with `src/lib/offline/shell-manifest.ts`
 * — a drift-guard test fails the build if they diverge.
 */

const SHELL_CACHE_VERSION = "v1";
const SHELL_CACHE_NAME = `coeliac-shell-${SHELL_CACHE_VERSION}`;
const SHELL_CACHE_PREFIX = "coeliac-shell-";
const APP_SHELL_ROUTES = [
  "/",
  "/log",
  "/symptoms",
  "/insights",
  "/plan",
  "/protocols",
  "/genetics",
  "/knowledge/research",
  "/community",
];
const SHELL_FALLBACK_ROUTE = "/";

/**
 * Fail-closed cacheability check: only store OK, non-opaque, same-origin
 * responses. This is defence-in-depth on top of the same-origin request gate in
 * the fetch handler — even if a same-origin request redirected to a foreign
 * origin, its (opaque/cross-origin) response is never written to the shell cache.
 */
function isCacheableResponse(response) {
  if (!response || !response.ok) return false;
  const type = response.type;
  if (type === "opaque" || type === "opaqueredirect" || type === "cors") return false;
  if (response.url) {
    try {
      if (new URL(response.url).origin !== self.location.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** True for immutable same-origin build assets safe to serve cache-first. */
function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  return /\.(?:js|css|woff2?|ttf|otf|png|svg|ico|webp|jpe?g|gif|avif)$/i.test(url.pathname);
}

/** Precache the public shell documents. Best-effort: one 404/offline URL must
 *  not abort install (a partial shell still beats no shell). */
async function precacheShell() {
  const cache = await self.caches.open(SHELL_CACHE_NAME);
  await Promise.all(
    APP_SHELL_ROUTES.map((route) =>
      cache.add(new Request(route, { cache: "reload" })).catch(() => undefined),
    ),
  );
}

/** Evict every earlier generation of the shell cache. */
async function cleanupOldShellCaches() {
  const names = await self.caches.keys();
  await Promise.all(
    names.map((name) =>
      name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE_NAME
        ? self.caches.delete(name)
        : Promise.resolve(false),
    ),
  );
}

/** Network-first for navigations: fresh when online, cached shell when not. */
async function handleNavigation(request) {
  const cache = await self.caches.open(SHELL_CACHE_NAME);
  try {
    const fresh = await self.fetch(request);
    // Cache successful navigations (public shells) for exact-route offline use.
    if (isCacheableResponse(fresh)) {
      cache.put(request, fresh.clone()).catch(() => undefined);
    }
    return fresh;
  } catch {
    const exact = await cache.match(request, { ignoreSearch: true });
    if (exact) return exact;
    const fallback = await cache.match(SHELL_FALLBACK_ROUTE);
    if (fallback) return fallback;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Offline</title><p>You are offline and this page is not cached yet.",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

/** Cache-first + background revalidate for immutable public assets. */
async function handleStaticAsset(request) {
  const cache = await self.caches.open(SHELL_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    // Stale-while-revalidate: refresh in the background, never block the paint.
    self
      .fetch(request)
      .then((fresh) => {
        if (isCacheableResponse(fresh)) {
          return cache.put(request, fresh.clone());
        }
        return undefined;
      })
      .catch(() => undefined);
    return cached;
  }
  const fresh = await self.fetch(request);
  if (isCacheableResponse(fresh)) {
    cache.put(request, fresh.clone()).catch(() => undefined);
  }
  return fresh;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupOldShellCaches().then(() => self.clients.claim()));
});

// Defensive purge hook (defence-in-depth): a page can ask the worker to drop the
// shell cache on sign-out. The shell holds only PUBLIC assets, so this is not a
// privacy requirement — private pod data was never cached here — but it keeps the
// cache tidy across account switches on a shared device.
self.addEventListener("message", (event) => {
  const data = event && event.data;
  if (data && data.type === "purge-shell") {
    event.waitUntil(self.caches.delete(SHELL_CACHE_NAME));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Non-GET (writes) → passthrough, never cached.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin (pod, Open Food Facts, research APIs, community) → passthrough.
  // These may carry credentials and MUST NOT be read or cached by this worker.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  // Any other same-origin GET (e.g. dynamic API-ish routes) → passthrough.
});
