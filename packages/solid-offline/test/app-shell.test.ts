/**
 * P4 — app-shell precache + offline navigation (the "boots offline" half).
 *
 * These are the OFFLINE tests the goal calls for. With a mocked CacheStorage +
 * fetch we simulate offline (fetch rejects / isOnline=false) and assert:
 *   1. the app shell is precached at install (addAll) + old buckets cleaned;
 *   2. an offline NAVIGATION is served the cached shell HTML (the app boots);
 *   3. an offline navigation to an unknown route falls back to the configured
 *      fallback document (vite SPA single-doc / Next index);
 *   4. precached static ASSETS (hashed JS/CSS) resolve from cache offline;
 *   5. a failed network (offline) on a navigation DEGRADES GRACEFULLY — the
 *      cached value is retained and returned, never an error/crash;
 *   6. going back ONLINE re-validates: a navigation fetches fresh AND refreshes
 *      the cached shell so the offline fallback tracks the latest deploy;
 *   7. a first-ever offline visit (nothing cached) surfaces the network error
 *      rather than fabricating a response.
 *
 * Both build shapes are covered: a vite `dist/` (single `index.html` + hashed
 * `/assets/*`) and a Next static `out/` (per-route HTML + `/_next/static/**`).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  type ResolvedAppShellConfig,
  type ShellCache,
  type ShellCacheStorage,
  type ShellDeps,
  cleanupOldShellCaches,
  handleNavigation,
  handlePrecachedAsset,
  isPrecachedAsset,
  precacheAppShell,
  resolveAppShellConfig,
  sameShellConfig,
  shellCacheName,
} from '../src/app-shell.js';

/** An in-memory Cache keyed by URL string (mode-agnostic; assets/docs alike). */
class MockShellCache implements ShellCache {
  store = new Map<string, Response>();
  /** A scripted fetch addAll uses; defaults to a 200 text/html per URL. */
  constructor(private readonly fetchFor?: (url: string) => Response) {}

  private keyOf(request: Request | string): string {
    return typeof request === 'string'
      ? new URL(request, 'https://app.example/').href
      : request.url;
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const hit = this.store.get(this.keyOf(request));
    return hit ? hit.clone() : undefined;
  }

  async put(request: Request | string, response: Response): Promise<void> {
    this.store.set(this.keyOf(request), response.clone());
  }

  async addAll(requests: string[]): Promise<void> {
    // Mimic the real addAll: atomic — any non-ok response rejects the whole batch.
    const fetched: Array<[string, Response]> = [];
    for (const url of requests) {
      const res = this.fetchFor
        ? this.fetchFor(url)
        : new Response(`<!doctype html><title>${url}</title>`, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
      if (!res.ok) throw new TypeError(`addAll: bad response for ${url}`);
      fetched.push([this.keyOf(url), res]);
    }
    for (const [k, r] of fetched) this.store.set(k, r.clone());
  }

  /** Test helper: seed a response directly under a URL. */
  seed(url: string, response: Response): void {
    this.store.set(this.keyOf(url), response.clone());
  }
}

class MockCacheStorage implements ShellCacheStorage {
  caches = new Map<string, MockShellCache>();
  constructor(private readonly fetchFor?: (url: string) => Response) {}
  async open(name: string): Promise<ShellCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new MockShellCache(this.fetchFor);
      this.caches.set(name, c);
    }
    return c;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}
function jsResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/javascript' } });
}

// `mode: 'navigate'` is browser-only and the undici Request constructor rejects
// it. The mode-based ROUTING (navigate → handleNavigation, precached asset →
// handlePrecachedAsset, else → the pod-data SWR engine) is the thin SW adapter in
// worker.ts — browser-only (real ServiceWorker `fetch`/`navigator.onLine`) and so
// excluded from coverage (see vitest.config.ts), like the rest of worker.ts. The
// decision pieces it calls ARE covered here: `isPrecachedAsset` directly, and the
// pure `handleNavigation` (which doesn't read `request.mode`) with a plain GET.
function navRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

// ── vite dist/ shape ────────────────────────────────────────────────────────
const VITE_CONFIG: ResolvedAppShellConfig = resolveAppShellConfig({
  precache: ['/index.html', '/assets/index-abc123.js', '/assets/index-def456.css'],
  version: 'vite-1',
});

// ── Next static out/ shape ──────────────────────────────────────────────────
const NEXT_CONFIG: ResolvedAppShellConfig = resolveAppShellConfig({
  precache: [
    '/index.html',
    '/files/index.html',
    '/_next/static/chunks/main-abc.js',
    '/_next/static/css/app-def.css',
  ],
  fallback: '/index.html',
  version: 'next-1',
});

describe('resolveAppShellConfig', () => {
  it('defaults fallback to the first .html entry and version to v1', () => {
    const c = resolveAppShellConfig({ precache: ['/assets/a.js', '/index.html'] });
    expect(c.fallback).toBe('/index.html');
    expect(c.version).toBe('v1');
  });

  it('treats a trailing-slash route as a shell document for the fallback', () => {
    const c = resolveAppShellConfig({ precache: ['/assets/a.js', '/'] });
    expect(c.fallback).toBe('/');
  });

  it('de-dupes the precache list while preserving order', () => {
    const c = resolveAppShellConfig({ precache: ['/index.html', '/a.js', '/index.html'] });
    expect(c.precache).toEqual(['/index.html', '/a.js']);
  });

  it('honours an explicit fallback', () => {
    const c = resolveAppShellConfig({
      precache: ['/index.html', '/404.html'],
      fallback: '/404.html',
    });
    expect(c.fallback).toBe('/404.html');
  });
});

describe('sameShellConfig (config-change detection for a new deploy)', () => {
  it('is true for byte-equivalent configs (a re-sent config message = no-op)', () => {
    const a = resolveAppShellConfig({ precache: ['/index.html', '/a.js'], version: 'v1' });
    const b = resolveAppShellConfig({ precache: ['/index.html', '/a.js'], version: 'v1' });
    expect(sameShellConfig(a, b)).toBe(true);
  });

  it('is false when the version changes (a new deploy must re-precache)', () => {
    const a = resolveAppShellConfig({ precache: ['/index.html'], version: 'abc' });
    const b = resolveAppShellConfig({ precache: ['/index.html'], version: 'def' });
    expect(sameShellConfig(a, b)).toBe(false);
  });

  it('is false when the precache set or fallback changes', () => {
    const base = resolveAppShellConfig({ precache: ['/index.html', '/a.js'], version: 'v1' });
    const changedSet = resolveAppShellConfig({ precache: ['/index.html', '/b.js'], version: 'v1' });
    const changedFallback = resolveAppShellConfig({
      precache: ['/index.html', '/404.html'],
      fallback: '/404.html',
      version: 'v1',
    });
    expect(sameShellConfig(base, changedSet)).toBe(false);
    expect(sameShellConfig(base, changedFallback)).toBe(false);
  });
});

describe('precacheAppShell (install)', () => {
  it('precaches every shell URL into the versioned bucket (vite)', async () => {
    const caches = new MockCacheStorage();
    const { cached, failed } = await precacheAppShell(caches, VITE_CONFIG);
    expect(failed).toEqual([]);
    expect(cached.sort()).toEqual([...VITE_CONFIG.precache].sort());
    const bucket = caches.caches.get(shellCacheName('vite-1'));
    expect(bucket?.store.size).toBe(3);
  });

  it('does NOT abort the whole precache when ONE url 404s (per-url tolerance)', async () => {
    // Return 404 for the bad asset, 200 for the rest.
    const caches = new MockCacheStorage((url) =>
      url.includes('missing') ? htmlResponse('nope', 404) : htmlResponse('ok'),
    );
    const onError = vi.fn();
    const { cached, failed } = await precacheAppShell(
      caches,
      resolveAppShellConfig({ precache: ['/index.html', '/missing.js'], version: 'v9' }),
      onError,
    );
    expect(cached).toContain('/index.html');
    expect(failed).toContain('/missing.js');
    expect(onError).toHaveBeenCalledWith('/missing.js', expect.anything());
    // The good entry is still cached despite the bad one.
    expect(caches.caches.get(shellCacheName('v9'))?.store.size).toBe(1);
  });
});

describe('cleanupOldShellCaches (activate)', () => {
  it('removes stale shell buckets but keeps the current one and other caches', async () => {
    const caches = new MockCacheStorage();
    await caches.open(shellCacheName('old-1'));
    await caches.open(shellCacheName('old-2'));
    await caches.open(shellCacheName('new'));
    await caches.open('solid-offline-cache-v2:anonymous'); // a pod-data cache — untouched
    const removed = await cleanupOldShellCaches(caches, 'new');
    expect(removed.sort()).toEqual([shellCacheName('old-1'), shellCacheName('old-2')].sort());
    expect(caches.caches.has(shellCacheName('new'))).toBe(true);
    // The pod-data cache must NOT be deleted by shell cleanup.
    expect(caches.caches.has('solid-offline-cache-v2:anonymous')).toBe(true);
  });
});

describe('isPrecachedAsset', () => {
  it('matches a precached asset by pathname (ignoring origin)', () => {
    expect(isPrecachedAsset('https://app.example/assets/index-abc123.js', VITE_CONFIG)).toBe(true);
    expect(
      isPrecachedAsset('https://app.example/_next/static/chunks/main-abc.js', NEXT_CONFIG),
    ).toBe(true);
  });
  it('does not match a non-precached url (e.g. a pod resource)', () => {
    expect(isPrecachedAsset('https://pod.example/alice/notes/1', VITE_CONFIG)).toBe(false);
  });
});

function shellDeps(
  caches: MockCacheStorage,
  online: boolean,
  fetchImpl: typeof fetch,
  config: ResolvedAppShellConfig,
): ShellDeps {
  return { caches, fetch: fetchImpl, isOnline: () => online, config };
}

describe('handleNavigation — OFFLINE boot', () => {
  it('serves the EXACT cached route HTML when offline (the app boots)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, NEXT_CONFIG);
    // Offline: fetch rejects.
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, NEXT_CONFIG);

    const result = await handleNavigation(navRequest('https://app.example/files/index.html'), deps);
    expect(result.source).toBe('shell-cache-offline');
    expect(await result.response.text()).toContain('/files/index.html');
    // Crucially: never threw, never called the network for a doc we hold.
  });

  it('falls back to the configured fallback HTML for an UNKNOWN route offline (SPA boot)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG);
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, VITE_CONFIG);

    // A deep client route the vite SPA resolves via its single index.html.
    const result = await handleNavigation(
      navRequest('https://app.example/files/photos/2024'),
      deps,
    );
    expect(result.source).toBe('shell-cache-fallback');
    expect(await result.response.text()).toContain('/index.html');
  });

  it('DEGRADES GRACEFULLY when the network FAILS even though navigator.onLine is true (stale flag)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG);
    // isOnline lies (true) but the fetch rejects — the server is unreachable.
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('network down')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, true, fetchImpl, VITE_CONFIG);

    // No crash: the cached fallback is returned despite the network failure.
    const result = await handleNavigation(navRequest('https://app.example/'), deps);
    expect(result.source).toBe('shell-cache-fallback');
    expect(await result.response.text()).toContain('/index.html');
  });

  it('surfaces the network error on a FIRST-EVER offline visit (nothing cached)', async () => {
    const caches = new MockCacheStorage(); // empty — nothing precached
    const networkError = new TypeError('offline, never cached');
    const fetchImpl = vi.fn(() => Promise.reject(networkError)) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, VITE_CONFIG);

    await expect(handleNavigation(navRequest('https://app.example/'), deps)).rejects.toBe(
      networkError,
    );
  });

  it('OFFLINE: NEVER serves an unconfigured cached entry — a poisoned/private cache hit is skipped for the fallback', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG);
    // Simulate a poisoned entry: a private page that an older buggy version (or an
    // attacker) cached under an UNCONFIGURED route in the shell bucket.
    const bucket = caches.caches.get(shellCacheName('vite-1'));
    bucket?.seed('https://app.example/account/secret', htmlResponse('<title>PRIVATE</title>'));
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, VITE_CONFIG);

    // The unconfigured route is NOT served from cache (no leak) — it routes to the
    // public configured fallback instead.
    const result = await handleNavigation(navRequest('https://app.example/account/secret'), deps);
    expect(result.source).toBe('shell-cache-fallback');
    const body = await result.response.text(); // a Response body reads only once
    expect(body).toContain('/index.html');
    expect(body).not.toContain('PRIVATE');
  });

  it('OFFLINE: serves the canonical configured doc for a QUERY-VARIANT of a configured route', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, NEXT_CONFIG); // includes /files/index.html
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, NEXT_CONFIG);

    // A query variant of a configured route resolves to the CANONICAL cached doc
    // (keyed by /files/index.html), not a per-query cache entry.
    const result = await handleNavigation(
      navRequest('https://app.example/files/index.html?user=alice'),
      deps,
    );
    expect(result.source).toBe('shell-cache-offline');
    expect(await result.response.text()).toContain('/files/index.html');
  });
});

describe('handleNavigation — ONLINE revalidate', () => {
  it('fetches fresh when online AND refreshes the cached shell (offline fallback tracks the deploy)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG); // cached the OLD shell
    // Online: the server returns a NEW shell.
    const fetchImpl = vi.fn(async () =>
      htmlResponse('<title>NEW DEPLOY</title>'),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, true, fetchImpl, VITE_CONFIG);

    const result = await handleNavigation(navRequest('https://app.example/index.html'), deps);
    expect(result.source).toBe('shell-network-cached');
    expect(await result.response.text()).toContain('NEW DEPLOY');

    // The cache was refreshed: a SUBSEQUENT offline read serves the NEW shell.
    const offlineDeps = shellDeps(
      caches,
      false,
      vi.fn(() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch,
      VITE_CONFIG,
    );
    const offlineResult = await handleNavigation(
      navRequest('https://app.example/index.html'),
      offlineDeps,
    );
    expect(await offlineResult.response.text()).toContain('NEW DEPLOY');
  });

  it('returns the live response without caching a non-HTML navigation answer (e.g. a redirect/JSON)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG);
    const json = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchImpl = vi.fn(async () => json) as unknown as typeof fetch;
    const deps = shellDeps(caches, true, fetchImpl, VITE_CONFIG);

    const result = await handleNavigation(navRequest('https://app.example/api/whoami'), deps);
    expect(result.source).toBe('shell-network');
    // The cached index.html is untouched (we don't cache a non-HTML doc).
    const bucket = caches.caches.get(shellCacheName('vite-1'));
    expect(await bucket?.match('https://app.example/api/whoami')).toBeUndefined();
  });

  it('NEVER caches an UNKNOWN same-origin HTML route (a private/authed page must not enter the logout-surviving shell cache)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG);
    // A same-origin, 200 text/html navigation to a route NOT in the precache list
    // (e.g. an authenticated server-rendered page). It must be served live but
    // NOT written to the identity-independent shell cache.
    const privatePage = htmlResponse('<title>Alice private dashboard</title>');
    const fetchImpl = vi.fn(async () => privatePage) as unknown as typeof fetch;
    const deps = shellDeps(caches, true, fetchImpl, VITE_CONFIG);

    const result = await handleNavigation(navRequest('https://app.example/account/secret'), deps);
    expect(result.source).toBe('shell-network'); // served live, NOT 'shell-network-cached'
    const bucket = caches.caches.get(shellCacheName('vite-1'));
    expect(await bucket?.match('https://app.example/account/secret')).toBeUndefined();
  });

  it('NEVER caches a QUERY-VARIANT of a configured route (a personalized ?user= page is not stored as the public shell)', async () => {
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, VITE_CONFIG); // includes /index.html
    // The server returns a PERSONALIZED variant for the query route.
    const personalized = htmlResponse('<title>alice personalized index</title>');
    const fetchImpl = vi.fn(async () => personalized) as unknown as typeof fetch;
    const deps = shellDeps(caches, true, fetchImpl, VITE_CONFIG);

    const result = await handleNavigation(
      navRequest('https://app.example/index.html?user=alice'),
      deps,
    );
    // Served live (not stored): NOT 'shell-network-cached'.
    expect(result.source).toBe('shell-network');
    const bucket = caches.caches.get(shellCacheName('vite-1'));
    // The canonical /index.html still holds the ORIGINAL precached doc, not the
    // personalized variant.
    const canonical = await bucket?.match('https://app.example/index.html');
    expect(await canonical?.text()).not.toContain('alice personalized');
  });

  it('matches a configured query-bearing URL BYTE-FOR-BYTE (case-sensitive query)', async () => {
    // A (rare) configured shell URL that carries a query. The query must match
    // case-SENSITIVELY: a different-case query is a different resource, not the shell.
    const cfg = resolveAppShellConfig({ precache: ['/index.html?v=ABC'], version: 'q1' });
    const caches = new MockCacheStorage();
    await precacheAppShell(caches, cfg);

    // Exact byte match → cached.
    const exactDeps = shellDeps(
      caches,
      true,
      vi.fn(async () => htmlResponse('<title>exact</title>')) as unknown as typeof fetch,
      cfg,
    );
    const exact = await handleNavigation(
      navRequest('https://app.example/index.html?v=ABC'),
      exactDeps,
    );
    expect(exact.source).toBe('shell-network-cached');

    // Different-case query → NOT a configured shell URL → served live, not stored.
    const caseDeps = shellDeps(
      caches,
      true,
      vi.fn(async () => htmlResponse('<title>casevariant</title>')) as unknown as typeof fetch,
      cfg,
    );
    const variant = await handleNavigation(
      navRequest('https://app.example/index.html?v=abc'),
      caseDeps,
    );
    expect(variant.source).toBe('shell-network');
  });
});

describe('handlePrecachedAsset — cache-first', () => {
  it('serves a precached JS asset from cache OFFLINE without the network', async () => {
    const caches = new MockCacheStorage((url) => jsResponse(`// ${url}`));
    await precacheAppShell(caches, VITE_CONFIG);
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('offline')),
    ) as unknown as typeof fetch;
    const deps = shellDeps(caches, false, fetchImpl, VITE_CONFIG);

    const result = await handlePrecachedAsset(
      new Request('https://app.example/assets/index-abc123.js'),
      deps,
    );
    expect(result.source).toBe('asset-cache-first');
    expect(await result.response.text()).toContain('/assets/index-abc123.js');
    expect(fetchImpl).not.toHaveBeenCalled(); // cache-first: no network at all
  });

  it('falls through to the network + caches when an asset missed the precache', async () => {
    const caches = new MockCacheStorage();
    // precache only the HTML, NOT this asset.
    await precacheAppShell(
      caches,
      resolveAppShellConfig({ precache: ['/index.html'], version: 'v3' }),
    );
    const fetchImpl = vi.fn(async () => jsResponse('// fresh asset')) as unknown as typeof fetch;
    const cfg = resolveAppShellConfig({
      precache: ['/index.html', '/assets/late.js'],
      version: 'v3',
    });
    const deps = shellDeps(caches, true, fetchImpl, cfg);

    const result = await handlePrecachedAsset(
      new Request('https://app.example/assets/late.js'),
      deps,
    );
    expect(result.source).toBe('asset-network');
    expect(fetchImpl).toHaveBeenCalledOnce();
    // Now cached: a second read is cache-first.
    const second = await handlePrecachedAsset(
      new Request('https://app.example/assets/late.js'),
      deps,
    );
    expect(second.source).toBe('asset-cache-first');
  });
});
