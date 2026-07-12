// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Request-directed freshness (security-critical: no-stale-ACL-for-mutations).
 *
 * A caller can opt a single GET out of the stale-while-revalidate fast path:
 *   - `Cache-Control: no-store`  → pure network bypass (no read, no write).
 *   - `Cache-Control: no-cache`  → forced SYNCHRONOUS revalidation before serving;
 *     never a provisional/stale body. This is how Solid clients defeat heuristic
 *     HTTP caching ahead of a read-modify-write on a security-sensitive doc (an
 *     `.acl` before a grant/revoke). The SW must not serve a stale ACL into that.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { keyRequest } from '../src/cache-policy.js';
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
    `solid-offline:freshness-${Math.random().toString(36).slice(2)}`,
  );
  stores.push(s);
  return s;
}

function freshGet(url: string, directive: 'no-cache' | 'no-store'): Request {
  return new Request(url, {
    method: 'GET',
    headers: { accept: 'text/turtle', 'cache-control': directive },
  });
}

async function harness(
  responders: Array<(r: Request) => Response | Promise<Response>>,
  opts: { online?: boolean } = {},
) {
  const cache = new MockByteCache();
  const meta = await newMeta();
  const broadcast = new MockBroadcaster();
  const { fetch, calls } = scriptedFetch(responders);
  let online = opts.online ?? true;
  const deps: SwrDeps = {
    cache,
    meta,
    fetch,
    broadcast,
    now: () => 1_000_000,
    isOnline: () => online,
  };
  return {
    deps,
    cache,
    meta,
    broadcast,
    calls,
    setOnline: (v: boolean) => {
      online = v;
    },
  };
}

const URL_A = 'https://alice.example/private/doc.acl';

describe('Cache-Control: no-cache forces synchronous revalidation (no stale serve)', () => {
  it('serves CONFIRMED cached bytes on a 304 (conditional GET, not a stale body)', async () => {
    // First a normal read to populate the cache.
    const h = await harness([
      () => turtleResponse('<#a> <#b> <#stale> .', { etag: '"v1"' }),
      // The forced revalidation: conditional GET → 304 confirms.
      (req) => {
        expect(req.headers.get('if-none-match')).toBe('"v1"');
        // The wire request MUST keep `Cache-Control: no-cache` (roborev High): the
        // SW's own fetch can hit the browser/intermediary HTTP cache, so the
        // directive must survive to force an origin revalidation — `If-None-Match`
        // only makes that cheap, it does not by itself force a network round-trip.
        expect(req.headers.get('cache-control')).toBe('no-cache');
        return notModifiedResponse();
      },
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;

    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.source).toBe('request-no-cache-revalidated');
    // The body served is the confirmed cached bytes.
    expect(await result.response.text()).toBe('<#a> <#b> <#stale> .');
    // A conditional GET WAS issued (not a stale serve).
    expect(h.calls.length).toBe(2);
  });

  it('serves the NEW body + replaces cache on a 200 (server changed)', async () => {
    const h = await harness([
      () => turtleResponse('<#old> .', { etag: '"v1"' }),
      // Forced revalidation: server returns 200 with new bytes/etag.
      () => turtleResponse('<#new> .', { etag: '"v2"' }),
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;

    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.source).toBe('request-no-cache-revalidated');
    expect(await result.response.text()).toBe('<#new> .');
    // Cache replaced + broadcast fired.
    expect(h.broadcast.messages.at(-1)).toMatchObject({
      url: URL_A,
      event: 'updated',
      etag: '"v2"',
    });
    const row = (await h.meta.getByUrl(URL_A))[0];
    expect(row?.etag).toBe('"v2"');
  });

  it('purges + broadcasts when the resource is now 403 (revoked)', async () => {
    const h = await harness([
      () => turtleResponse('<#secret> .', { etag: '"v1"' }),
      // Forced revalidation: now forbidden (access revoked).
      () => turtleResponse('', { status: 403 }),
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;

    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.response.status).toBe(403);
    expect(result.source).toBe('request-no-cache-revalidated');
    // The positive (200) entry must be gone — no stale secret can be served later.
    const positive = await h.cache.match(keyRequest(URL_A, 'accept=text/turtle'));
    // After purge the only entry (if any) is the negative 403 entry, never the secret.
    if (positive) {
      expect(positive.status).toBe(403);
    }
    expect(h.broadcast.messages.at(-1)).toMatchObject({ url: URL_A, event: 'updated' });
  });

  it('fetches unconditionally when nothing is cached yet', async () => {
    const h = await harness([() => turtleResponse('<#fresh> .', { etag: '"v1"' })]);
    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(await result.response.text()).toBe('<#fresh> .');
    // No If-None-Match (nothing to revalidate against).
    expect(h.calls[0]?.headers.get('if-none-match')).toBeNull();
    // Still keeps the directive on the wire (origin-forced revalidation).
    expect(h.calls[0]?.headers.get('cache-control')).toBe('no-cache');
  });

  it('does NOT serve stale bytes on a 304 when the stored record has NO ETag (roborev High)', async () => {
    // Cached entry has no ETag → the forced path sends no If-None-Match. If the
    // server nonetheless answers 304 (e.g. off an If-Modified-Since the caller
    // carried), those cached bytes were NOT validated by us — we must re-fetch
    // unconditionally rather than serve them.
    const h = await harness([
      () => turtleResponse('<#stale-noetag> .'), // no etag
      () => notModifiedResponse(), // forced revalidation → 304 (unvalidated by us)
      // unconditional re-fetch (no If-None-Match) → fresh body
      (req) => {
        expect(req.headers.get('if-none-match')).toBeNull();
        return turtleResponse('<#fresh> .', { etag: '"v9"' });
      },
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;

    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.source).toBe('request-no-cache-revalidated');
    // The fresh re-fetched body — NEVER the unvalidated stale bytes.
    expect(await result.response.text()).toBe('<#fresh> .');
    expect(h.calls.length).toBe(3);
  });

  it("strips If-Modified-Since on the unconditional refetch so a 304 can't recur (roborev Medium)", async () => {
    // Caller carries If-Modified-Since on its no-cache request; stored record has
    // no ETag. The forced revalidation 304s; the unconditional refetch must strip
    // ALL validators (incl. If-Modified-Since) or it would 304 again and we'd hand
    // back a bodyless response instead of the promised confirmed body.
    const h = await harness([
      () => turtleResponse('<#stale-noetag> .'), // no etag
      () => notModifiedResponse(), // forced revalidation → 304
      (req) => {
        // The unconditional refetch must carry NO conditional validators.
        expect(req.headers.get('if-none-match')).toBeNull();
        expect(req.headers.get('if-modified-since')).toBeNull();
        return turtleResponse('<#fresh> .', { etag: '"v9"' });
      },
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;

    const req = new Request(URL_A, {
      method: 'GET',
      headers: {
        accept: 'text/turtle',
        'cache-control': 'no-cache',
        'if-modified-since': 'Wed, 21 Oct 2026 07:28:00 GMT',
      },
    });
    const result = await handleFetch(req, h.deps);
    expect(result.source).toBe('request-no-cache-revalidated');
    expect(await result.response.text()).toBe('<#fresh> .');
  });

  it('PURGES a stale positive entry when a no-ETag revalidation now 403s (roborev High)', async () => {
    // Seed a positive entry whose stored metadata has NO etag (e.g. server sent
    // none), so the forced path can't send If-None-Match — it must STILL purge the
    // old positive bytes when the fresh answer is non-cacheable (403).
    const h = await harness([
      () => turtleResponse('<#secret> .'), // no etag
      () => turtleResponse('', { status: 403 }), // forced revalidation → revoked
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;
    // Confirm the positive entry exists before.
    expect((await h.meta.getByUrl(URL_A))[0]?.status).toBe(200);

    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.response.status).toBe(403);
    expect(result.source).toBe('request-no-cache-revalidated');
    // The old positive (200) variant must be gone — never servable again.
    const rows = await h.meta.getByUrl(URL_A);
    expect(rows.every((r) => r.status !== 200)).toBe(true);
    const positive = await h.cache.match(keyRequest(URL_A, 'accept=text/turtle'));
    if (positive) expect(positive.status).not.toBe(200);
    expect(h.broadcast.messages.at(-1)).toMatchObject({ url: URL_A, event: 'updated' });
  });

  it('does NOT serve stale-with-If-None-Match when OFFLINE (falls through to stale path)', async () => {
    // Offline: a no-cache request can't be satisfied fresh; the normal offline
    // path serves the stale-tagged body rather than failing the read.
    const h = await harness([() => turtleResponse('<#cached> .', { etag: '"v1"' })]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;
    h.setOnline(false);
    const result = await handleFetch(freshGet(URL_A, 'no-cache'), h.deps);
    expect(result.source).toBe('cache-hit-offline');
    expect(result.response.headers.get('x-offline')).toBe('stale');
  });
});

describe('Cache-Control: no-store bypasses the cache entirely', () => {
  it('never reads the cache and never writes it', async () => {
    const h = await harness([
      () => turtleResponse('<#a> .', { etag: '"v1"' }),
      // no-store read goes straight to network.
      () => turtleResponse('<#network> .', { etag: '"v2"' }),
    ]);
    const first = await handleFetch(makeGet(URL_A), h.deps);
    await first.revalidation;
    const rowsBefore = await h.meta.getByUrl(URL_A);

    const result = await handleFetch(freshGet(URL_A, 'no-store'), h.deps);
    expect(result.source).toBe('request-no-store');
    expect(await result.response.text()).toBe('<#network> .');

    // The cache was NOT updated by the no-store read (still the original entry).
    const rowsAfter = await h.meta.getByUrl(URL_A);
    expect(rowsAfter[0]?.etag).toBe(rowsBefore[0]?.etag);
  });

  it("forwards the fetch with cache mode 'no-store' (roborev Medium)", async () => {
    const h = await harness([() => turtleResponse('<#network> .', { etag: '"v1"' })]);
    await handleFetch(freshGet(URL_A, 'no-store'), h.deps);
    // The outgoing request must not be able to hit the browser HTTP cache.
    expect(h.calls[0]?.cache).toBe('no-store');
  });
});
