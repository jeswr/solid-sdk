// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * §5 notification-driven invalidation pipeline (SW side).
 *
 * Drives `handleNotification` + `resyncSweep` with a real (fake-indexeddb)
 * MetadataStore + the mock Cache API + a scripted fetch + a mock broadcaster.
 * Covers:
 *   - ETag short-circuit: frame.state === cached ETag ⇒ no fetch, no broadcast
 *   - Update → revalidate (If-None-Match) → 200 replaces + broadcast
 *   - Update → revalidate → 304 confirms (no broadcast)
 *   - Delete → purge + broadcast
 *   - revalidate → 403/404 → purge + broadcast (no-leak parity)
 *   - Add/Remove → container listing re-fetch + broadcast
 *   - not-cached resource ⇒ no-op
 *   - resync sweep: confirms/replaces/purges across the warmed set; dedups by URL
 */
import { afterEach, describe, expect, it } from 'vitest';
import { computeCacheKey, keyRequest } from '../src/cache-policy.js';
import { handleNotification, type InvalidateDeps, resyncSweep } from '../src/invalidation.js';
import { MetadataStore } from '../src/metadata-store.js';
import type { NotificationFrame } from '../src/types.js';
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
    `solid-offline:inv-${Math.random().toString(36).slice(2)}`,
  );
  stores.push(s);
  return s;
}

interface Harness {
  deps: InvalidateDeps;
  cache: MockByteCache;
  meta: MetadataStore;
  broadcast: MockBroadcaster;
  calls: Request[];
}

async function harness(
  responders: Array<(r: Request) => Response | Promise<Response>>,
): Promise<Harness> {
  const cache = new MockByteCache();
  const meta = await newMeta();
  const broadcast = new MockBroadcaster();
  const { fetch, calls } = scriptedFetch(
    responders.length ? responders : [() => new Response(null, { status: 500 })],
  );
  const deps: InvalidateDeps = { cache, meta, fetch, broadcast, now: () => 1_000_000 };
  return { deps, cache, meta, broadcast, calls };
}

/** Seed a cached resource (bytes + metadata) as if P1/P2 had warmed it. */
async function seed(
  h: Harness,
  url: string,
  body: string,
  etag: string,
  status = 200,
): Promise<void> {
  const req = makeGet(url);
  const res = turtleResponse(body, { etag, status });
  // Seed bytes under the CANONICAL (url, varyKey) key — the same key the engine
  // now uses for put/match/delete — so the mock cache mirrors production.
  h.cache.seed(keyRequest(url, 'accept=text/turtle'), res);
  const rl = { url, method: 'GET', headers: req.headers };
  const resLike = { status, headers: res.headers };
  await h.meta.put({
    key: computeCacheKey(rl, resLike),
    url,
    varyKey: 'accept=text/turtle',
    etag,
    contentType: 'text/turtle',
    fetchedAt: 1_000,
    aclStatus: status === 200 ? 'ok' : 'forbidden',
    status,
  });
}

const DOC = 'https://alice.example/notes/1';
const CONTAINER = 'https://alice.example/notes/';

describe('ETag short-circuit', () => {
  it('does nothing when frame.state equals the cached ETag (self-caused change)', async () => {
    const h = await harness([]);
    await seed(h, DOC, '<#a> <#b> <#c> .', '"v1"');

    const frame: NotificationFrame = { type: 'Update', object: DOC, state: '"v1"' };
    const outcome = await handleNotification(frame, h.deps);

    expect(outcome.kind).toBe('short-circuit');
    expect(h.calls).toHaveLength(0); // NO fetch
    expect(h.broadcast.messages).toHaveLength(0); // NO broadcast
    // lastState is remembered.
    const rec = await h.meta.getByUrl(DOC);
    expect(rec[0]?.lastState).toBe('"v1"');
  });
});

describe('Update → revalidate → broadcast', () => {
  it('200 replaces bytes + metadata and broadcasts the new ETag', async () => {
    const h = await harness([() => turtleResponse('<#x> <#y> <#z> .', { etag: '"v2"' })]);
    await seed(h, DOC, 'old', '"v1"');

    const frame: NotificationFrame = { type: 'Update', object: DOC, state: '"v2"' };
    const outcome = await handleNotification(frame, h.deps);

    expect(outcome).toEqual({ kind: 'updated', etag: '"v2"' });
    // Conditional GET carried our old ETag.
    expect(h.calls[0]?.headers.get('if-none-match')).toBe('"v1"');
    expect(h.broadcast.messages).toEqual([{ url: DOC, event: 'updated', etag: '"v2"' }]);
    const rec = await h.meta.getByUrl(DOC);
    expect(rec[0]?.etag).toBe('"v2"');
  });

  it('304 confirms without broadcasting', async () => {
    const h = await harness([() => notModifiedResponse()]);
    await seed(h, DOC, 'body', '"v1"');

    const frame: NotificationFrame = { type: 'Update', object: DOC, state: '"v9"' };
    const outcome = await handleNotification(frame, h.deps);

    expect(outcome.kind).toBe('304-confirmed');
    expect(h.broadcast.messages).toHaveLength(0);
    const rec = await h.meta.getByUrl(DOC);
    expect(rec[0]?.fetchedAt).toBe(1_000_000); // touched
    expect(rec[0]?.lastState).toBe('"v9"');
  });
});

describe('Delete + forbidden', () => {
  it('Delete purges bytes + metadata and broadcasts', async () => {
    const h = await harness([]);
    await seed(h, DOC, 'body', '"v1"');

    const outcome = await handleNotification({ type: 'Delete', object: DOC }, h.deps);

    expect(outcome.kind).toBe('deleted');
    expect(h.calls).toHaveLength(0); // a Delete needs no revalidation
    expect(h.broadcast.messages).toEqual([{ url: DOC, event: 'updated' }]);
    expect(await h.meta.getByUrl(DOC)).toHaveLength(0);
    expect(await h.cache.match(keyRequest(DOC, 'accept=text/turtle'))).toBeUndefined();
  });

  it('Update whose revalidation 404s purges (no-leak parity)', async () => {
    const h = await harness([() => new Response(null, { status: 404 })]);
    await seed(h, DOC, 'body', '"v1"');

    const outcome = await handleNotification(
      { type: 'Update', object: DOC, state: '"v2"' },
      h.deps,
    );

    expect(outcome.kind).toBe('deleted');
    expect(h.broadcast.messages).toEqual([{ url: DOC, event: 'updated' }]);
    expect(await h.meta.getByUrl(DOC)).toHaveLength(0);
  });
});

describe('Add/Remove → container listing re-fetch', () => {
  it('Add re-fetches the target container listing and broadcasts', async () => {
    const h = await harness([() => turtleResponse('<.> ldp:contains <1> .', { etag: '"c2"' })]);
    await seed(h, CONTAINER, '<.> ldp:contains <> .', '"c1"');

    const frame: NotificationFrame = {
      type: 'Add',
      object: `${CONTAINER}1`,
      target: CONTAINER,
      // Note: Add frames carry no `state` (server omits it), so no short-circuit.
    };
    const outcome = await handleNotification(frame, h.deps);

    expect(outcome.kind).toBe('listing-refreshed');
    // Unconditional GET of the container (membership can't be confirmed by ETag).
    expect(h.calls[0]?.url).toBe(CONTAINER);
    expect(h.calls[0]?.headers.get('if-none-match')).toBeNull();
    expect(h.broadcast.messages).toEqual([{ url: CONTAINER, event: 'updated', etag: '"c2"' }]);
  });

  it('Remove on an uncached container is a no-op', async () => {
    const h = await harness([]);
    const outcome = await handleNotification(
      { type: 'Remove', object: `${CONTAINER}1`, target: CONTAINER },
      h.deps,
    );
    expect(outcome.kind).toBe('not-cached');
    expect(h.calls).toHaveLength(0);
  });
});

describe('#3 purge removes EVERY cached variant for the URL', () => {
  it('deletes bytes for all varyKeys, not just a synthetic text/turtle key', async () => {
    const h = await harness([]);
    // Two variants of the same resource: turtle + ld+json (distinct varyKeys, but
    // both canonicalize to accept=text/turtle in production; seed them explicitly
    // under DIFFERENT varyKeys to prove purge sweeps all metadata rows' keys).
    const turtleKey = keyRequest(DOC, 'accept=text/turtle');
    const jsonKey = keyRequest(DOC, 'accept=application/ld+json');
    h.cache.seed(turtleKey, turtleResponse('turtle-body', { etag: '"v1"' }));
    h.cache.seed(jsonKey, turtleResponse('json-body', { etag: '"v1"' }));
    for (const varyKey of ['accept=text/turtle', 'accept=application/ld+json']) {
      await h.meta.put({
        key: `${DOC} ${varyKey}`,
        url: DOC,
        varyKey,
        etag: '"v1"',
        contentType: 'text/turtle',
        fetchedAt: 1_000,
        aclStatus: 'ok',
        status: 200,
      });
    }

    const outcome = await handleNotification({ type: 'Delete', object: DOC }, h.deps);
    expect(outcome.kind).toBe('deleted');
    // BOTH variants' bytes are gone (no stale variant left behind with no metadata).
    expect(await h.cache.match(turtleKey)).toBeUndefined();
    expect(await h.cache.match(jsonKey)).toBeUndefined();
    expect(await h.meta.getByUrl(DOC)).toHaveLength(0);
  });
});

describe('a cacheable update replaces ALL variants (no stale Vary row survives)', () => {
  it('removes a stale other-variant when storing the new canonical row', async () => {
    const h = await harness([() => turtleResponse('<#x> <#y> <#z> .', { etag: '"v2"' })]);
    // Two variants for DOC: the canonical turtle one (seeded) + a stale legacy one.
    await seed(h, DOC, 'old-turtle', '"v1"');
    const staleVary = 'accept=image/png';
    h.cache.seed(keyRequest(DOC, staleVary), turtleResponse('STALE', { etag: '"old"' }));
    await h.meta.put({
      key: `${DOC} ${staleVary}`,
      url: DOC,
      varyKey: staleVary,
      etag: '"old"',
      contentType: 'image/png',
      fetchedAt: 1,
      aclStatus: 'ok',
      status: 200,
    });

    const outcome = await handleNotification(
      { type: 'Update', object: DOC, state: '"v2"' },
      h.deps,
    );
    expect(outcome.kind).toBe('updated');
    // The stale legacy variant is gone; only the freshly-written canonical remains.
    expect(await h.cache.match(keyRequest(DOC, staleVary))).toBeUndefined();
    const rows = await h.meta.getByUrl(DOC);
    expect(rows.every((r) => r.varyKey !== staleVary)).toBe(true);
    expect(rows.some((r) => r.etag === '"v2"')).toBe(true);
  });
});

describe('revalidation 2xx but non-cacheable (no-store/private) purges the stale entry', () => {
  it('drops old bytes + metadata instead of leaving a stale entry', async () => {
    const h = await harness([
      () => turtleResponse('NOW-PRIVATE', { etag: '"v2"', cacheControl: 'no-store' }),
    ]);
    await seed(h, DOC, 'old', '"v1"');

    const outcome = await handleNotification(
      { type: 'Update', object: DOC, state: '"v2"' },
      h.deps,
    );
    // The resource is now uncacheable → purge, don't keep serving 'old'.
    expect(outcome.kind).toBe('deleted');
    expect(await h.meta.getByUrl(DOC)).toHaveLength(0);
    expect(await h.cache.match(keyRequest(DOC, 'accept=text/turtle'))).toBeUndefined();
    expect(h.broadcast.messages).toEqual([{ url: DOC, event: 'updated' }]);
  });
});

describe('not-cached resource', () => {
  it('a Create/Update for something we never cached is a no-op', async () => {
    const h = await harness([]);
    const outcome = await handleNotification(
      { type: 'Create', object: DOC, state: '"v1"' },
      h.deps,
    );
    expect(outcome.kind).toBe('not-cached');
    expect(h.calls).toHaveLength(0);
  });
});

describe('resync sweep', () => {
  it('confirms (304), replaces (200) and purges (404) across the warmed set', async () => {
    // Route per URL: A → 304, B → 200 (new etag), C → 404.
    const routes: Record<string, () => Response> = {
      'https://alice.example/a': () => notModifiedResponse(),
      'https://alice.example/b': () => turtleResponse('new', { etag: '"b2"' }),
      'https://alice.example/c': () => new Response(null, { status: 404 }),
    };
    const cache = new MockByteCache();
    const meta = await newMeta();
    const broadcast = new MockBroadcaster();
    const { fetch, calls } = scriptedFetch([
      (r) => routes[r.url.split('#')[0] ?? r.url]?.() ?? new Response(null, { status: 500 }),
    ]);
    const deps: InvalidateDeps = { cache, meta, fetch, broadcast, now: () => 2_000_000 };
    const h: Harness = { deps, cache, meta, broadcast, calls };

    await seed(h, 'https://alice.example/a', 'a', '"a1"');
    await seed(h, 'https://alice.example/b', 'b', '"b1"');
    await seed(h, 'https://alice.example/c', 'c', '"c1"');

    const result = await resyncSweep(deps);

    expect(result.checked).toBe(3);
    expect(result.confirmed).toBe(1);
    expect(result.replaced).toBe(1);
    expect(result.purged).toBe(1);
    // Only the replaced (B) and the purged (C) broadcast.
    expect(broadcast.messages.map((m) => m.url).sort()).toEqual([
      'https://alice.example/b',
      'https://alice.example/c',
    ]);
  });

  it('dedups multiple varyKeys of one URL into a single conditional GET', async () => {
    const cache = new MockByteCache();
    const meta = await newMeta();
    const broadcast = new MockBroadcaster();
    const { fetch, calls } = scriptedFetch([() => notModifiedResponse()]);
    const deps: InvalidateDeps = { cache, meta, fetch, broadcast, now: () => 2_000_000 };

    // Two metadata rows for the same URL, different varyKeys.
    for (const varyKey of ['accept=text/turtle', 'accept=application/ld+json']) {
      await meta.put({
        key: `${DOC} ${varyKey}`,
        url: DOC,
        varyKey,
        etag: '"v1"',
        contentType: 'text/turtle',
        fetchedAt: 1,
        aclStatus: 'ok',
        status: 200,
      });
    }

    const result = await resyncSweep(deps);
    expect(result.checked).toBe(1); // deduped
    expect(calls).toHaveLength(1);
  });

  it('skips negatively-cached (403/404) entries', async () => {
    const h = await harness([() => notModifiedResponse()]);
    await seed(h, DOC, '', '"x"', 403);
    const result = await resyncSweep(h.deps);
    expect(result.checked).toBe(0);
    expect(h.calls).toHaveLength(0);
  });
});
