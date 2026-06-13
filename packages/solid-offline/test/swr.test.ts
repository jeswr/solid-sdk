/**
 * §2 stale-while-revalidate / never-authoritative decision tree.
 *
 * Drives `handleFetch` with mocked Cache API + fetch + clock + BroadcastChannel.
 * Covers: hit→serve+revalidate, 304 vs 200 paths, offline→stale header,
 * miss→network+store, never-cache passthrough, negative-cache TTL for 403/404,
 * and the opaque-response skip.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NEGATIVE_CACHE_TTL_MS } from '../src/cache-policy.js';
import { MetadataStore } from '../src/metadata-store.js';
import { type SwrDeps, handleFetch } from '../src/swr.js';
import {
  MockBroadcaster,
  MockByteCache,
  makeGet,
  notModifiedResponse,
  scriptedFetch,
  turtleResponse,
} from './mocks.js';

let stores: MetadataStore[] = [];
afterEach(() => {
  for (const s of stores) s.close();
  stores = [];
});

async function newMeta(): Promise<MetadataStore> {
  const s = await MetadataStore.openNamed(
    `solid-offline:swr-${Math.random().toString(36).slice(2)}`,
  );
  stores.push(s);
  return s;
}

interface Harness {
  deps: SwrDeps;
  cache: MockByteCache;
  meta: MetadataStore;
  broadcast: MockBroadcaster;
  calls: Request[];
  setOnline(v: boolean): void;
  setNow(v: number): void;
}

async function harness(
  responders: Array<(r: Request) => Response | Promise<Response>>,
  opts: { online?: boolean; now?: number } = {},
): Promise<Harness> {
  const cache = new MockByteCache();
  const meta = await newMeta();
  const broadcast = new MockBroadcaster();
  const { fetch, calls } = scriptedFetch(responders);
  let online = opts.online ?? true;
  let now = opts.now ?? 1_000_000;
  const deps: SwrDeps = {
    cache,
    meta,
    fetch,
    broadcast,
    now: () => now,
    isOnline: () => online,
  };
  return {
    deps,
    cache,
    meta,
    broadcast,
    calls,
    setOnline: (v) => {
      online = v;
    },
    setNow: (v) => {
      now = v;
    },
  };
}

describe('MISS → network → store (cacheable)', () => {
  it('fetches, returns network bytes, and writes Cache + metadata', async () => {
    const h = await harness([() => turtleResponse('<a> <b> <c> .', { etag: '"e1"' })]);
    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('network-miss-store');
    expect(await res.response.text()).toContain('<a>');
    expect(h.cache.size).toBe(1);
    const rec = await h.meta.get('https://pod/a accept=text/turtle');
    expect(rec).toMatchObject({ etag: '"e1"', status: 200, aclStatus: 'ok' });
  });
});

describe('MISS → network → NOT stored (never-cache)', () => {
  it('does not store a no-store response', async () => {
    const h = await harness([
      () => turtleResponse('x', { etag: '"e1"', cacheControl: 'no-store' }),
    ]);
    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('network-miss-nostore');
    expect(h.cache.size).toBe(0);
  });
});

describe('Never-cache endpoint → straight passthrough', () => {
  it('does not consult or write the cache for /oidc/token', async () => {
    const h = await harness([() => turtleResponse('tok', { etag: '"e1"' })]);
    const res = await handleFetch(makeGet('https://idp/oidc/token'), h.deps);
    expect(res.source).toBe('network-no-cache');
    expect(h.cache.size).toBe(0);
    expect(res.revalidation).toBeUndefined();
  });
});

describe('HIT + ONLINE → serve cached + revalidate (304 confirms)', () => {
  it('serves provisional bytes immediately, then a 304 touches fetchedAt', async () => {
    // First call: initial population. Then 304 on the conditional revalidation.
    const h = await harness(
      [
        () => turtleResponse('original', { etag: '"e1"' }),
        (r) => {
          expect(r.headers.get('If-None-Match')).toBe('"e1"');
          return notModifiedResponse();
        },
      ],
      { now: 1000 },
    );

    // Populate.
    await handleFetch(makeGet('https://pod/a'), h.deps);
    h.setNow(5000);

    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('cache-hit-online');
    expect(await res.response.text()).toBe('original');
    const outcome = await res.revalidation;
    expect(outcome).toEqual({ kind: '304-confirmed' });

    const rec = await h.meta.get('https://pod/a accept=text/turtle');
    expect(rec?.fetchedAt).toBe(5000); // touched
    expect(h.broadcast.messages).toHaveLength(0); // 304 broadcasts nothing
  });
});

describe('HIT + ONLINE → revalidate (200 replaces + broadcasts updated)', () => {
  it('replaces entry and posts {url,event:updated,etag}', async () => {
    const h = await harness([
      () => turtleResponse('original', { etag: '"e1"' }),
      () => turtleResponse('changed', { etag: '"e2"' }),
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);

    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('cache-hit-online');
    // Served the OLD (provisional) bytes synchronously...
    expect(await res.response.text()).toBe('original');
    const outcome = await res.revalidation;
    expect(outcome).toEqual({ kind: '200-replaced', etag: '"e2"' });
    // ...and the cache + broadcast reflect the new version.
    expect(h.broadcast.messages).toEqual([
      { url: 'https://pod/a', event: 'updated', etag: '"e2"' },
    ]);
    const rec = await h.meta.get('https://pod/a accept=text/turtle');
    expect(rec?.etag).toBe('"e2"');
  });
});

describe('HIT + OFFLINE → serve cached + X-Offline: stale', () => {
  it('marks the provisional value stale and does not revalidate', async () => {
    const h = await harness([() => turtleResponse('original', { etag: '"e1"' })]);
    await handleFetch(makeGet('https://pod/a'), h.deps); // populate online
    h.setOnline(false);

    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('cache-hit-offline');
    expect(res.response.headers.get('X-Offline')).toBe('stale');
    expect(await res.response.text()).toBe('original');
    expect(res.revalidation).toBeUndefined();
    expect(h.calls).toHaveLength(1); // only the initial populate fetch
  });
});

describe('MISS + OFFLINE → surfaces network error', () => {
  it('does not invent a response when nothing is cached', async () => {
    const h = await harness(
      [
        () => {
          throw new Error('offline');
        },
      ],
      { online: false },
    );
    await expect(handleFetch(makeGet('https://pod/missing'), h.deps)).rejects.toThrow('offline');
  });
});

describe('Negative cache for 403/404 (§2)', () => {
  it('caches a 404 with a short TTL and serves it within the window', async () => {
    const h = await harness(
      [
        () => turtleResponse('', { status: 404 }),
        () => turtleResponse('should-not-be-hit', { etag: '"x"' }),
      ],
      { now: 1000 },
    );
    // Populate negative entry.
    const first = await handleFetch(makeGet('https://pod/gone'), h.deps);
    expect(first.source).toBe('network-miss-store');
    const rec = await h.meta.get('https://pod/gone accept=text/turtle');
    expect(rec?.status).toBe(404);
    expect(rec?.aclStatus).toBe('not-found');
    expect(rec?.negativeUntil).toBe(1000 + NEGATIVE_CACHE_TTL_MS);

    // Within TTL → served from negative cache, no extra fetch.
    h.setNow(1000 + NEGATIVE_CACHE_TTL_MS - 1);
    const second = await handleFetch(makeGet('https://pod/gone'), h.deps);
    expect(second.source).toBe('cache-hit-negative');
    expect(h.calls).toHaveLength(1);
  });

  it('re-fetches once the negative TTL has expired', async () => {
    const h = await harness(
      [
        () => turtleResponse('', { status: 403 }),
        () => turtleResponse('now-allowed', { etag: '"ok"' }),
      ],
      { now: 1000 },
    );
    await handleFetch(makeGet('https://pod/secret'), h.deps);

    h.setNow(1000 + NEGATIVE_CACHE_TTL_MS + 1);
    const res = await handleFetch(makeGet('https://pod/secret'), h.deps);
    expect(res.source).toBe('network-miss-store');
    expect(await res.response.text()).toBe('now-allowed');
    expect(h.calls).toHaveLength(2);
  });
});

describe('Opaque cross-origin response → skip caching', () => {
  it('returns the opaque response but stores nothing', async () => {
    // A real opaque cross-origin response has status 0 + type 'opaque'. The
    // Response constructor forbids status 0, so we synthesize those fields the
    // way the platform exposes them.
    const opaque = new Response(null, { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    Object.defineProperty(opaque, 'status', { value: 0 });
    const h = await harness([() => opaque]);
    const res = await handleFetch(makeGet('https://other-pod/x'), h.deps);
    expect(res.source).toBe('network-miss-nostore');
    expect(h.cache.size).toBe(0);
  });
});

describe('HEAD requests are cacheable', () => {
  it('treats HEAD like GET for the cache decision', async () => {
    const h = await harness([() => turtleResponse('', { etag: '"h1"' })]);
    const req = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    const res = await handleFetch(req, h.deps);
    expect(res.source).toBe('network-miss-store');
  });
});

describe('Revalidation with no stored ETag is skipped (never-authoritative safe)', () => {
  it('skips the conditional fetch when the record has no ETag', async () => {
    const h = await harness([
      () => turtleResponse('body-no-etag'), // no etag header
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps); // populate (no etag)
    const res = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(res.source).toBe('cache-hit-online');
    const outcome = await res.revalidation;
    expect(outcome).toEqual({ kind: 'skipped' });
    expect(h.calls).toHaveLength(1); // no conditional fetch fired
  });
});
