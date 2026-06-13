/**
 * §2 stale-while-revalidate / never-authoritative decision tree.
 *
 * Drives `handleFetch` with mocked Cache API + fetch + clock + BroadcastChannel.
 * Covers: hit→serve+revalidate, 304 vs 200 paths, offline→stale header,
 * miss→network+store, never-cache passthrough, negative-cache TTL for 403/404,
 * and the opaque-response skip.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { NEGATIVE_CACHE_TTL_MS, keyRequest } from '../src/cache-policy.js';
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

describe('HEAD is a network passthrough that only reconciles GET state (#6)', () => {
  it('never writes a body-backed metadata row from a HEAD (no existing GET state)', async () => {
    const h = await harness([() => turtleResponse('', { etag: '"h1"' })]);
    const req = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    const res = await handleFetch(req, h.deps);
    expect(res.source).toBe('network-no-cache');
    // No metadata fabricated, no bytes cached.
    expect(await h.meta.get('https://pod/a accept=text/turtle')).toBeUndefined();
    expect(h.cache.size).toBe(0);
  });

  it('a matching HEAD confirms freshness; the GET bytes survive (offline still serves them)', async () => {
    const h = await harness([
      () => turtleResponse('GET-BODY', { etag: '"e1"' }), // GET populate
      () => turtleResponse('', { etag: '"e1"' }), // HEAD: same ETag → confirm
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(h.cache.size).toBe(1);

    const headReq = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    const headRes = await handleFetch(headReq, h.deps);
    expect(await headRes.response.text()).toBe(''); // HEAD body, not "GET-BODY"

    h.setOnline(false);
    const getRes = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(getRes.source).toBe('cache-hit-offline');
    expect(await getRes.response.text()).toBe('GET-BODY');
  });

  it('an INCONCLUSIVE HEAD (200 without ETag) leaves the cached GET bytes intact', async () => {
    const h = await harness([
      () => turtleResponse('GET-BODY', { etag: '"e1"' }), // GET populate
      () => turtleResponse(''), // HEAD: 200 with NO ETag → inconclusive
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(h.cache.size).toBe(1);

    const headReq = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    await handleFetch(headReq, h.deps);
    // Inconclusive HEAD must NOT evict valid cached bytes.
    expect(h.cache.size).toBe(1);
    h.setOnline(false);
    const getRes = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(getRes.source).toBe('cache-hit-offline');
    expect(await getRes.response.text()).toBe('GET-BODY');
  });

  it('a HEAD is NON-DESTRUCTIVE: a 403 probe never evicts cached GET bytes', async () => {
    // The warmer's HEAD probe is forwarded through the SW and may be unauthenticated
    // relative to the GET; a 403/404 there must NOT purge the user's valid bytes.
    const h = await harness([
      () => turtleResponse('GET-BODY', { etag: '"e1"' }), // GET populate
      () => new Response(null, { status: 403 }), // HEAD probe blocked
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(h.cache.size).toBe(1);

    const headReq = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    await handleFetch(headReq, h.deps);

    // Bytes + metadata survive; revocation is the authoritative GET's / a
    // notification's job, not an ambiguous HEAD.
    expect(h.cache.size).toBe(1);
    expect(await h.meta.get('https://pod/a accept=text/turtle')).toMatchObject({ etag: '"e1"' });
    h.setOnline(false);
    const getRes = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(getRes.source).toBe('cache-hit-offline');
    expect(await getRes.response.text()).toBe('GET-BODY');
    // A non-destructive HEAD doesn't broadcast a spurious invalidation.
    expect(h.broadcast.messages).toHaveLength(0);
  });

  it('a HEAD with a NEW ETag does not purge (only a GET revalidation is authoritative)', async () => {
    const h = await harness([
      () => turtleResponse('OLD-BODY', { etag: '"e1"' }), // GET populate
      () => turtleResponse('', { etag: '"e2"' }), // HEAD: different ETag
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);
    const headReq = new Request('https://pod/a', {
      method: 'HEAD',
      headers: { accept: 'text/turtle' },
    });
    await handleFetch(headReq, h.deps);
    // The HEAD did not evict; the cached entry remains until a GET revalidation
    // (which carries the real conditional request) decides.
    expect(h.cache.size).toBe(1);
    expect(await h.meta.get('https://pod/a accept=text/turtle')).toMatchObject({ etag: '"e1"' });
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

// ── Security findings ────────────────────────────────────────────────────────

describe('#1 byte-cache hit with NO matching metadata is never served (no-leak)', () => {
  it('treats orphan bytes (no metadata) as a miss and deletes them', async () => {
    const h = await harness([() => turtleResponse('FRESH', { etag: '"e1"' })]);
    // Simulate a previous user's stray bytes under the canonical key, with NO
    // metadata record (e.g. metadata DB was purged/scoped away but bytes lingered).
    h.cache.seed(
      keyRequest('https://pod/private', 'accept=text/turtle'),
      turtleResponse('PREVIOUS-USER-SECRET', { etag: '"old"' }),
    );

    const res = await handleFetch(makeGet('https://pod/private'), h.deps);
    // Must NOT serve the orphan bytes — it goes to the network instead.
    expect(res.source).toBe('network-miss-store');
    const served = await res.response.text();
    expect(served).toBe('FRESH');
    expect(served).not.toContain('SECRET');
    // The orphan bytes were deleted (then re-stored as FRESH under the same key).
    const bytes = await h.cache.match(keyRequest('https://pod/private', 'accept=text/turtle'));
    expect(await bytes?.text()).toBe('FRESH');
  });
});

describe('#7 RDF Accept variants share one cached entry (canonical key)', () => {
  it('a ld+json read is served from the bytes cached for a text/turtle read', async () => {
    const h = await harness([
      () => turtleResponse('SHARED', { etag: '"e1"' }),
      () => notModifiedResponse(), // any revalidation
    ]);
    // Populate via a text/turtle GET.
    await handleFetch(makeGet('https://pod/doc', 'text/turtle'), h.deps);
    // Read the SAME resource asking for application/ld+json — must hit the cache.
    const res = await handleFetch(makeGet('https://pod/doc', 'application/ld+json'), h.deps);
    expect(res.source).toBe('cache-hit-online');
    expect(await res.response.text()).toBe('SHARED');
  });
});

describe('#8 negative 403/404 bytes are cached + served within TTL', () => {
  it('serves the cached negative-response bytes (not just a synthetic status)', async () => {
    const h = await harness([() => turtleResponse('FORBIDDEN-BODY', { status: 403 })], {
      now: 1000,
    });
    await handleFetch(makeGet('https://pod/secret'), h.deps); // populate negative
    h.setNow(1000 + NEGATIVE_CACHE_TTL_MS - 1);
    const res = await handleFetch(makeGet('https://pod/secret'), h.deps);
    expect(res.source).toBe('cache-hit-negative');
    expect(res.response.status).toBe(403);
    expect(await res.response.text()).toBe('FORBIDDEN-BODY');
    expect(h.calls).toHaveLength(1); // no extra fetch
  });
});

describe('revalidation 403 purges EVERY variant for the URL (permission revoke)', () => {
  it('a revoke removes another cached Vary variant, not just the matched one', async () => {
    const h = await harness([
      () => turtleResponse('original', { etag: '"e1"' }), // populate text/turtle
      () => new Response(null, { status: 403 }), // revalidation: revoked
    ]);
    // Populate the text/turtle variant via handleFetch.
    await handleFetch(makeGet('https://pod/a', 'text/turtle'), h.deps);
    // Seed a SECOND, independent variant (e.g. a legacy non-RDF Accept) directly,
    // both bytes + metadata, so the URL has two variants.
    const otherVary = 'accept=image/png';
    h.cache.seed(
      keyRequest('https://pod/a', otherVary),
      turtleResponse('PNG-ISH', { etag: '"p1"' }),
    );
    await h.meta.put({
      key: `https://pod/a ${otherVary}`,
      url: 'https://pod/a',
      varyKey: otherVary,
      etag: '"p1"',
      contentType: 'image/png',
      fetchedAt: 1,
      aclStatus: 'ok',
      status: 200,
    });

    // Revalidate the text/turtle variant → server now 403s the resource.
    const hit = await handleFetch(makeGet('https://pod/a', 'text/turtle'), h.deps);
    await hit.revalidation;

    // The revoke is resource-wide: NO stale positive variant survives. Only the
    // single negative (403) row remains (offline parity, #8).
    const rows = await h.meta.getByUrl('https://pod/a');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(403);
    // The other (positive) variant's bytes are gone.
    expect(await h.cache.match(keyRequest('https://pod/a', otherVary))).toBeUndefined();
  });
});

describe('revalidation 2xx that becomes non-cacheable purges stale bytes', () => {
  it('a 200 with Cache-Control: no-store drops the old cached entry', async () => {
    const h = await harness([
      () => turtleResponse('original', { etag: '"e1"' }), // populate
      () => turtleResponse('now-private', { etag: '"e2"', cacheControl: 'no-store' }), // reval
    ]);
    await handleFetch(makeGet('https://pod/a'), h.deps);
    const hit = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(hit.source).toBe('cache-hit-online');
    await hit.revalidation;

    // The resource is now uncacheable → old bytes + metadata purged.
    expect(await h.meta.get('https://pod/a accept=text/turtle')).toBeUndefined();
    expect(await h.cache.match(keyRequest('https://pod/a', 'accept=text/turtle'))).toBeUndefined();
    // A subsequent offline read is a clean miss, not stale 'original'.
    h.setOnline(false);
    const miss = await handleFetch(makeGet('https://pod/a'), h.deps);
    expect(miss.source).toBe('offline-miss');
  });
});

describe('lookup matches stored Vary, not an assumed Accept (Vary-coherence)', () => {
  it('a resource varying on Accept-Language is looked up under its stored key', async () => {
    // Populate a response that varies on Accept-Language (not Accept).
    const h = await harness([
      () => turtleResponse('EN-BODY', { etag: '"e1"', vary: 'Accept-Language' }),
      () => notModifiedResponse(),
    ]);
    const req = new Request('https://pod/doc', {
      method: 'GET',
      headers: { accept: 'text/turtle', 'accept-language': 'en' },
    });
    const populate = await handleFetch(req, h.deps);
    expect(populate.source).toBe('network-miss-store');

    // A second read with the SAME Accept-Language must HIT (not a permanent miss).
    const res = await handleFetch(
      new Request('https://pod/doc', {
        method: 'GET',
        headers: { accept: 'text/turtle', 'accept-language': 'en' },
      }),
      h.deps,
    );
    expect(res.source).toBe('cache-hit-online');
    expect(await res.response.text()).toBe('EN-BODY');
  });
});

describe('#2 conditional revalidation preserves the ORIGINAL request options', () => {
  it('the conditional request inherits credentials/mode from the original', async () => {
    let condRequest: Request | undefined;
    const h = await harness([
      () => turtleResponse('original', { etag: '"e1"' }),
      (r) => {
        condRequest = r;
        return notModifiedResponse();
      },
    ]);
    // Populate with an authenticated cross-origin-style request.
    const authedReq = new Request('https://pod/a', {
      method: 'GET',
      headers: { accept: 'text/turtle' },
      credentials: 'include',
      mode: 'cors',
      referrer: 'https://app.example/',
    });
    await handleFetch(authedReq, h.deps);
    await handleFetch(authedReq, h.deps).then((r) => r.revalidation);

    expect(condRequest).toBeDefined();
    // Built from the original (new Request(request, {...})) → options preserved.
    expect(condRequest?.credentials).toBe('include');
    expect(condRequest?.mode).toBe('cors');
    expect(condRequest?.headers.get('if-none-match')).toBe('"e1"');
  });
});
