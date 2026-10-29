// AUTHORED-BY Claude Opus 4.8
//
// The shared-replica ORCHESTRATION (SWR read, write-through, gate-on-cache-hit, purge) with
// in-memory doubles for the Cache + metadata-store ports — no IndexedDB / packed extension
// (the live SW context is covered by service-worker-replica.test.ts + the e2e suite). These
// are the adversarial security tests for the two load-bearing properties:
//   - the gate is the FIRST step on EVERY read AND write, INCLUDING a cache hit;
//   - the security-scoped key blocks a cross-user / cross-grant serve off a warm cache.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EgressPort,
  purgeReplica,
  purgeReplicaSlice,
  type ReplicaByteCache,
  type ReplicaMetaStore,
  SharedReplica,
} from '../src/background/core/replica';
import type { ReplicaMetadata } from '../src/background/core/replica-db';

// --- In-memory doubles ----------------------------------------------------------------

/** A trivial in-memory Cache-API double (keyed by the synthetic key Request URL). */
class FakeCache implements ReplicaByteCache {
  readonly bytes = new Map<
    string,
    { body: string; status: number; headers: Record<string, string> }
  >();
  async match(request: Request): Promise<Response | undefined> {
    const e = this.bytes.get(request.url);
    if (!e) return undefined;
    return new Response(e.body, { status: e.status, headers: e.headers });
  }
  async put(request: Request, response: Response): Promise<void> {
    this.bytes.set(request.url, {
      body: await response.text(),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    });
  }
  async delete(request: Request): Promise<boolean> {
    return this.bytes.delete(request.url);
  }
  async keys(): Promise<readonly Request[]> {
    return [...this.bytes.keys()].map((url) => new Request(url));
  }
}

/** A trivial in-memory metadata-store double. */
class FakeMetaStore implements ReplicaMetaStore {
  readonly rows = new Map<string, ReplicaMetadata>();
  noncesCleared = 0;
  async getMetadata(key: string) {
    return this.rows.get(key);
  }
  async putMetadata(record: ReplicaMetadata) {
    this.rows.set(record.key, record);
  }
  async deleteMetadata(key: string) {
    this.rows.delete(key);
  }
  async getMetadataByWebId(webId: string) {
    return [...this.rows.values()].filter((r) => r.webId === webId);
  }
  async deleteMetadataByWebId(webId: string) {
    for (const [k, v] of this.rows) if (v.webId === webId) this.rows.delete(k);
  }
  async clearMetadata() {
    this.rows.clear();
  }
  async clearNonces() {
    this.noncesCleared++;
  }
}

const WEBID_A = 'https://alice.pod.example/profile/card#me';
const WEBID_B = 'https://bob.pod.example/profile/card#me';
const SCOPE_PM = 'https://pm.example';
const SCOPE_B = 'https://appB.example';
const URL = 'https://alice.pod.example/finance/budget.ttl';

describe('SharedReplica — redirects use only the final gated URL', () => {
  const FINAL = `${URL}/`;
  it('stores a redirected GET only under the final URL and gates direct cache hits', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const gate = vi.fn(async (_url: string, _method: string) => ({ grantScope: SCOPE_PM }));
    const egress: EgressPort = {
      fetch: async () => ({
        response: new Response('final bytes', { headers: { etag: 'final-etag' } }),
        url: FINAL,
      }),
    };
    const replica = new SharedReplica({ gate, egress, cache, db, webId: WEBID_A });
    const result = await replica.read(URL, 'GET', {}, undefined);
    expect('deny' in result).toBe(false);
    expect(gate.mock.calls).toEqual([
      [URL, 'GET'],
      [FINAL, 'GET'],
    ]);
    expect([...db.rows.values()].map((row) => row.resourceUrl)).toEqual([FINAL]);
    expect(cache.bytes.size).toBe(1);
    const match = vi.spyOn(cache, 'match');
    const denied = new SharedReplica({ gate: deny(), egress, cache, db, webId: WEBID_A });
    expect('deny' in (await denied.read(FINAL, 'GET', {}, undefined))).toBe(true);
    expect(match).not.toHaveBeenCalled();
  });

  it('never stores or serves a final URL refused by its gate', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const gate = async (url: string) =>
      url === FINAL ? { deny: DENY_RES } : { grantScope: SCOPE_PM };
    const egress: EgressPort = {
      fetch: async () => ({ response: new Response('secret'), url: FINAL }),
    };
    const replica = new SharedReplica({ gate, egress, cache, db, webId: WEBID_A });
    expect('deny' in (await replica.read(URL, 'GET', {}, undefined))).toBe(true);
    expect(cache.bytes.size).toBe(0);
  });

  it('invalidates an old alias entry and never serves its bytes for a redirected 304', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const egress = scriptedEgress([
      () => new Response('old original bytes', { headers: { etag: 'old-etag' } }),
    ]);
    await new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A }).read(
      URL,
      'GET',
      {},
      undefined,
    );
    const redirected: EgressPort = {
      fetch: async () => ({
        response: new Response(null, { status: 304 }),
        url: FINAL,
      }),
    };
    const replica = new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: redirected,
      cache,
      db,
      webId: WEBID_A,
    });
    const result = await replica.read(URL, 'GET', {}, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.fromCache).toBe(false);
    expect(result.response.status).toBe(304);
    expect(await result.response.text()).toBe('');
    expect(cache.bytes.size).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it('leaves cached bytes intact when egress rejects a write redirect', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const warm = new SharedReplica({
      gate: allow(SCOPE_PM),
      cache,
      db,
      webId: WEBID_A,
      egress: scriptedEgress([() => new Response('cached', { headers: { etag: 'etag' } })]),
    });
    await warm.read(URL, 'GET', {}, undefined);
    const replica = new SharedReplica({
      gate: allow(SCOPE_PM),
      cache,
      db,
      webId: WEBID_A,
      egress: {
        fetch: async () => {
          throw new TypeError('Redirect rejected');
        },
      },
    });
    await expect(replica.write(URL, 'POST', {}, 'body', undefined)).rejects.toThrow(
      'Redirect rejected',
    );
    expect(cache.bytes.size).toBe(1);
    expect(db.rows.size).toBe(1);
  });
});

function allow(grantScope: string) {
  return async () => ({ grantScope });
}
const DENY_RES = new Response('Origin not granted access', { status: 403 });
function deny() {
  return async () => ({ deny: DENY_RES });
}

/** An egress double that records calls and returns a scripted sequence of responses. */
function scriptedEgress(responses: Array<() => Response>): EgressPort & {
  calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  }>;
} {
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  }> = [];
  let i = 0;
  return {
    calls,
    fetch: async (url, method, headers, body) => {
      calls.push({ url, method, headers, body });
      const make = responses[Math.min(i, responses.length - 1)];
      i++;
      return { response: make(), nonce: undefined };
    },
  };
}

describe('SharedReplica.read — gate FIRST, then never-authoritative SWR', () => {
  let cache: FakeCache;
  let db: FakeMetaStore;
  beforeEach(() => {
    cache = new FakeCache();
    db = new FakeMetaStore();
  });

  it('a DENIED read never touches the cache OR the pod (gate is the first step)', async () => {
    const egress = scriptedEgress([() => new Response('secret', { status: 200 })]);
    const replica = new SharedReplica({ gate: deny(), egress, cache, db, webId: WEBID_A });
    const result = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect('deny' in result).toBe(true);
    expect(egress.calls.length).toBe(0); // NO egress
    expect(cache.bytes.size).toBe(0); // NO cache touch
  });

  it('a cold read does an egress, stores bytes+metadata under the scoped key', async () => {
    const egress = scriptedEgress([
      () =>
        new Response('@prefix : <#>.', {
          status: 200,
          headers: { etag: 'W/"v1"', 'content-type': 'text/turtle' },
        }),
    ]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    const result = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect('deny' in result).toBe(false);
    if ('deny' in result) return;
    expect(result.fromCache).toBe(false);
    expect(await result.response.text()).toBe('@prefix : <#>.');
    expect(cache.bytes.size).toBe(1);
    expect([...db.rows.values()][0]?.etag).toBe('W/"v1"');
  });

  it('a warm read sends If-None-Match; a 304 serves the cached body (provisional confirmed)', async () => {
    // First call 200 → cache; second call 304 → serve cache.
    const egress = scriptedEgress([
      () => new Response('cached-body', { status: 200, headers: { etag: 'W/"v1"' } }),
      () => new Response(null, { status: 304 }),
    ]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const result = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.fromCache).toBe(true);
    expect(await result.response.text()).toBe('cached-body');
    // The revalidation carried the cached ETag.
    expect(egress.calls[1]?.headers['If-None-Match']).toBe('W/"v1"');
  });

  it('a 200 on revalidation REPLACES the stale cache (cache is never authoritative)', async () => {
    const egress = scriptedEgress([
      () => new Response('old', { status: 200, headers: { etag: 'W/"v1"' } }),
      () => new Response('new', { status: 200, headers: { etag: 'W/"v2"' } }),
    ]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const result = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(await result.response.text()).toBe('new');
    expect([...db.rows.values()][0]?.etag).toBe('W/"v2"');
  });

  it('a now-403 on revalidation drops the cached entry and serves the live 403 (no stale serve)', async () => {
    const egress = scriptedEgress([
      () => new Response('was-readable', { status: 200, headers: { etag: 'W/"v1"' } }),
      () => new Response('forbidden', { status: 403 }),
    ]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const result = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.response.status).toBe(403);
    expect(cache.bytes.size).toBe(0); // dropped — no stale body lingers
  });
});

describe('SharedReplica — the SHARED replica + cross-user/grant guards (gate on cache hit)', () => {
  it('ONE replica serves the SAME bytes for the SAME (user, grant-scope) — no duplication', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Two reads with the same scope: first stores, second is a 304-served cache hit. Only one
    // byte entry exists across both.
    const egress = scriptedEgress([
      () => new Response('shared-bytes', { status: 200, headers: { etag: 'W/"v1"' } }),
      () => new Response(null, { status: 304 }),
    ]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const second = await replica.read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in second) throw new Error('unexpected deny');
    expect(second.fromCache).toBe(true);
    expect(cache.bytes.size).toBe(1); // single byte copy
  });

  it('CACHE-HIT GATE: a warm replica entry is NOT served to a DENIED origin (gate runs first)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Warm the cache as the granted PM origin.
    const warm = scriptedEgress([
      () => new Response('private', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: warm,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect(cache.bytes.size).toBe(1); // a warm body exists

    // Now an UN-granted origin reads the SAME URL — the injected gate denies. The denial must
    // come BEFORE any cache read, so NO egress AND the body is NOT served.
    const attacker = scriptedEgress([() => new Response('should-not-happen', { status: 200 })]);
    const result = await new SharedReplica({
      gate: deny(),
      egress: attacker,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect('deny' in result).toBe(true);
    expect(attacker.calls.length).toBe(0); // gate denied before any work
  });

  it('CROSS-USER GUARD: user B cannot read user A bytes at the same URL+ETag (key includes WebID)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // User A (granted PM) warms the cache.
    const warmA = scriptedEgress([
      () => new Response('ALICE-SECRET', { status: 200, headers: { etag: 'W/"shared-etag"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: warmA,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);

    // User B reads the SAME URL with the SAME ETag — must NOT match A's key. So B's read is a
    // cold MISS that goes to the pod (no If-None-Match against A's etag) and gets B's own bytes.
    const egressB = scriptedEgress([
      () => new Response('BOB-OWN', { status: 200, headers: { etag: 'W/"shared-etag"' } }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: egressB,
      cache,
      db,
      webId: WEBID_B,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    // B's read was a MISS (no conditional header sent — it did not see A's etag).
    expect(egressB.calls[0]?.headers['If-None-Match']).toBeUndefined();
    expect(await result.response.text()).toBe('BOB-OWN');
    // Two distinct byte entries now coexist (A's and B's), keyed apart by WebID.
    expect(cache.bytes.size).toBe(2);
  });

  it('CROSS-GRANT GUARD: a different grant-scope is a distinct key (no shared body across scopes)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const warm = scriptedEgress([
      () => new Response('pm-bytes', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: warm,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    // appB (a different granted origin) reads the same URL — a MISS under its own scope key.
    const egressB = scriptedEgress([
      () => new Response('b-bytes', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_B),
      egress: egressB,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(egressB.calls[0]?.headers['If-None-Match']).toBeUndefined(); // distinct key → miss
    expect(cache.bytes.size).toBe(2);
  });
});

describe('SharedReplica.write — synchronous write-through with If-Match', () => {
  let cache: FakeCache;
  let db: FakeMetaStore;
  beforeEach(() => {
    cache = new FakeCache();
    db = new FakeMetaStore();
  });

  it('a DENIED write never reaches the pod', async () => {
    const egress = scriptedEgress([() => new Response('', { status: 200 })]);
    const replica = new SharedReplica({ gate: deny(), egress, cache, db, webId: WEBID_A });
    const result = await replica.write(URL, 'PUT', {}, 'data', undefined);
    expect('deny' in result).toBe(true);
    expect(egress.calls.length).toBe(0);
  });

  it('attaches If-Match from the cached ETag when the caller supplied no precondition (lost-update guard)', async () => {
    // Warm a read so a cached ETag exists, then write with no precondition.
    const readEgress = scriptedEgress([
      () => new Response('v1', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: readEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const writeEgress = scriptedEgress([() => new Response('', { status: 200 })]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: writeEgress,
      cache,
      db,
      webId: WEBID_A,
    }).write(URL, 'PUT', {}, 'new-data', undefined);
    expect(writeEgress.calls[0]?.headers['If-Match']).toBe('W/"v1"');
  });

  it('does NOT override a caller-supplied precondition', async () => {
    const readEgress = scriptedEgress([
      () => new Response('v1', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: readEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const writeEgress = scriptedEgress([() => new Response('', { status: 200 })]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: writeEgress,
      cache,
      db,
      webId: WEBID_A,
    }).write(URL, 'PUT', { 'If-None-Match': '*' }, 'data', undefined);
    // The caller's precondition is honoured; we do NOT add an If-Match on top.
    expect(writeEgress.calls[0]?.headers['If-Match']).toBeUndefined();
    expect(writeEgress.calls[0]?.headers['If-None-Match']).toBe('*');
  });

  it('a 2xx write INVALIDATES the shared replica entry (a stale copy is dropped)', async () => {
    const readEgress = scriptedEgress([
      () => new Response('v1', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: readEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect(cache.bytes.size).toBe(1);
    const writeEgress = scriptedEgress([() => new Response('', { status: 200 })]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: writeEgress,
      cache,
      db,
      webId: WEBID_A,
    }).write(URL, 'PUT', {}, 'new', undefined);
    expect(cache.bytes.size).toBe(0); // invalidated; next read re-fetches
  });

  it('a 412 conflict is surfaced verbatim and the cache is NOT updated (no silent queue)', async () => {
    const readEgress = scriptedEgress([
      () => new Response('v1', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: readEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    const writeEgress = scriptedEgress([
      () => new Response('Precondition Failed', { status: 412 }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: writeEgress,
      cache,
      db,
      webId: WEBID_A,
    }).write(URL, 'PUT', {}, 'new', undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.response.status).toBe(412);
    expect(cache.bytes.size).toBe(1); // unchanged — the cached body survives the failed write
  });
});

describe('purgeReplica — synchronous-before-serve logout purge', () => {
  it.each([0, 1])('retains retry metadata when byte deletion %i fails', async (failureIndex) => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, URL);
    await seedResource(cache, db, WEBID_A, SCOPE_B, URL);
    await seedResource(cache, db, WEBID_B, SCOPE_PM, URL);
    const rows = [...db.rows.values()];
    const remove = cache.delete.bind(cache);
    const failedKey = [...cache.bytes.keys()][failureIndex];
    const deletion = vi.spyOn(cache, 'delete').mockImplementation(async (request) => {
      if (request.url === failedKey) throw new Error('fixture cache deletion failed');
      return remove(request);
    });

    await expect(purgeReplica(cache, db, WEBID_A)).rejects.toThrow('cache deletion failed');
    expect([...db.rows.values()]).toEqual(rows);
    expect(cache.bytes.has(failedKey)).toBe(true);
    expect(db.noncesCleared).toBe(0);

    deletion.mockRestore();
    // Already-deleted bytes return false on retry; absence still permits completion.
    await purgeReplica(cache, db, WEBID_A);
    expect([...db.rows.values()]).toEqual(rows.filter((row) => row.webId === WEBID_B));
    expect(cache.bytes.size).toBe(1);
    expect(db.noncesCleared).toBe(1);
  });

  it("sweeps this identity's byte keys that no metadata row indexes, and only those", async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, URL);
    await seedResource(cache, db, WEBID_B, SCOPE_PM, URL);
    // Orphan both identities' bytes, e.g. a worker killed between the byte and metadata writes.
    db.rows.clear();
    // A WebID that extends A's must not match A's key prefix.
    await seedResource(cache, new FakeMetaStore(), `${WEBID_A}2`, SCOPE_PM, URL);

    const purged = await purgeReplica(cache, db, WEBID_A);

    expect(purged).toEqual({ bytesDropped: 1, metaDropped: 0 });
    const remaining = [...cache.bytes.keys()].map((url) => decodeURIComponent(url));
    expect(remaining).toHaveLength(2);
    expect(remaining.some((key) => key.includes(`${WEBID_B}\u0000`))).toBe(true);
    expect(remaining.some((key) => key.includes(`${WEBID_A}2\u0000`))).toBe(true);
  });

  it('a failed invalidation keeps its metadata, so the slice purge still removes the bytes', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    const remove = cache.delete.bind(cache);
    const deletion = vi.spyOn(cache, 'delete').mockRejectedValue(new Error('transient'));
    // The resource is now gone: the read drops the cached entry, but the byte delete fails.
    const egress = scriptedEgress([() => new Response('gone', { status: 404 })]);
    const replica = new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId: WEBID_A });
    const result = await replica.read(FINANCE, 'GET', { Accept: 'text/turtle' }, undefined);
    expect('response' in result && result.response.status).toBe(404);
    expect(cache.bytes.size).toBe(1);
    expect(db.rows.size).toBe(1);

    deletion.mockImplementation(remove);
    await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
    });
    expect(cache.bytes.size).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it('drops exactly the prior identity rows + clears nonces (scoped purge)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Seed A and B rows + their bytes.
    for (const [webId, body] of [
      [WEBID_A, 'a'],
      [WEBID_B, 'b'],
    ] as const) {
      const egress = scriptedEgress([
        () => new Response(body, { status: 200, headers: { etag: 'W/"x"' } }),
      ]);
      await new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId }).read(
        URL,
        'GET',
        { Accept: 'text/turtle' },
        undefined,
      );
    }
    expect(cache.bytes.size).toBe(2);
    const purged = await purgeReplica(cache, db, WEBID_A);
    expect(purged.metaDropped).toBe(1);
    expect(purged.bytesDropped).toBe(1);
    expect(db.noncesCleared).toBe(1);
    // B survives; A is gone.
    expect([...db.rows.values()].every((r) => r.webId === WEBID_B)).toBe(true);
    expect(cache.bytes.size).toBe(1);
  });

  it('a null prior WebID purges EVERYTHING incl. CacheStorage BYTES (Medium #4: bytes, not just metadata)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Seed TWO identities so a null purge must wipe ALL bytes (not just one WebID's rows).
    for (const [webId, body] of [
      [WEBID_A, 'a-bytes'],
      [WEBID_B, 'b-bytes'],
    ] as const) {
      const egress = scriptedEgress([
        () => new Response(body, { status: 200, headers: { etag: 'W/"x"' } }),
      ]);
      await new SharedReplica({ gate: allow(SCOPE_PM), egress, cache, db, webId }).read(
        URL,
        'GET',
        { Accept: 'text/turtle' },
        undefined,
      );
    }
    expect(cache.bytes.size).toBe(2); // bytes present before the purge
    expect(db.rows.size).toBe(2);

    const purged = await purgeReplica(cache, db, null);

    // After a null purge: NO metadata rows AND NO CacheStorage byte entries remain.
    expect(db.rows.size).toBe(0);
    expect(cache.bytes.size).toBe(0); // the privacy fix: bytes are GONE, not orphaned
    expect(purged.bytesDropped).toBe(2);
    expect(db.noncesCleared).toBe(1);
  });

  it('a null purge with NO enumerator still clears metadata + nonces (defensive default)', async () => {
    // The default enumerator is cache.keys(); pass a cache whose keys() throws to prove the
    // metadata + nonce clear still runs (best-effort byte deletion, never load-bearing).
    const db = new FakeMetaStore();
    const throwingCache: ReplicaByteCache = {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
      keys: async () => {
        throw new Error('cache keys unavailable');
      },
    };
    const purged = await purgeReplica(throwingCache, db, null);
    expect(purged.bytesDropped).toBe(0);
    expect(db.noncesCleared).toBe(1);
  });
});

// --- Per-class replica-slice purge (access-management residual b) ----------------------

const FINANCE = 'https://alice.pod.example/finance/statement.ttl';
const HEALTH = 'https://alice.pod.example/health/record.ttl';
const FINANCE_TARGETS = [{ url: 'https://alice.pod.example/finance/', kind: 'container' as const }];

/** Populate the replica with a resource's bytes+metadata under (webId, grantScope) via a read. */
async function seedResource(
  cache: FakeCache,
  db: FakeMetaStore,
  webId: string,
  grantScope: string,
  url: string,
): Promise<void> {
  const egress = scriptedEgress([
    () => new Response(`bytes-of-${url}`, { status: 200, headers: { etag: 'W/"e"' } }),
  ]);
  await new SharedReplica({ gate: allow(grantScope), egress, cache, db, webId }).read(
    url,
    'GET',
    { Accept: 'text/turtle' },
    undefined,
  );
}

describe('purgeReplicaSlice — per-class revoke/expiry byte purge (residual b)', () => {
  it('drops exactly the revoked class slice; other classes remain resident', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    await seedResource(cache, db, WEBID_A, SCOPE_PM, HEALTH);
    expect(cache.bytes.size).toBe(2);
    expect(db.rows.size).toBe(2);

    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
    });

    expect(purged).toEqual({ bytesDropped: 1, metaDropped: 1 });
    // ZERO bytes of the finance class resident; health untouched.
    const remaining = [...db.rows.values()];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.resourceUrl).toBe(HEALTH);
    expect(cache.bytes.size).toBe(1);
  });

  it("leaves ANOTHER app-origin's (grantScope) copy of the same resource intact", async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Two different app origins each cached the SAME finance resource under their own grant-scope.
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    await seedResource(cache, db, WEBID_A, SCOPE_B, FINANCE);
    expect(cache.bytes.size).toBe(2);

    // Revoke only SCOPE_PM's finance grant.
    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
    });

    expect(purged.metaDropped).toBe(1);
    const remaining = [...db.rows.values()];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.grantScope).toBe(SCOPE_B); // appB's copy survives
  });

  it("never touches another user's (webId) rows", async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    await seedResource(cache, db, WEBID_B, SCOPE_PM, FINANCE);

    await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
    });

    const remaining = [...db.rows.values()];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.webId).toBe(WEBID_B);
  });

  it('RETAINS a resource still covered by another live (overlapping) grant of the same scope', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    // Revoke one grant whose targets cover finance/, but a SURVIVING grant also covers finance/.
    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
      retainTargets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }],
    });
    // The resource is KEPT — the survivor still authorises it (no needless eviction).
    expect(purged).toEqual({ bytesDropped: 0, metaDropped: 0 });
    expect(db.rows.size).toBe(1);
    expect(cache.bytes.size).toBe(1);
  });

  it('purges a NON-overlapping resource even when retainTargets cover a DIFFERENT resource', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
      // A surviving grant covers only health/, not the finance resource → finance is still purged.
      retainTargets: [{ url: 'https://alice.pod.example/health/', kind: 'container' }],
    });
    expect(purged).toEqual({ bytesDropped: 1, metaDropped: 1 });
    expect(db.rows.size).toBe(0);
  });

  it('an empty target set purges NOTHING (fail-safe no-op)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: [],
    });
    expect(purged).toEqual({ bytesDropped: 0, metaDropped: 0 });
    expect(db.rows.size).toBe(1);
  });

  it('keeps the metadata of a row whose byte delete fails, so the profile purge still finds it', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    const OTHER_FINANCE = 'https://alice.pod.example/finance/payslip.ttl';
    await seedResource(cache, db, WEBID_A, SCOPE_PM, FINANCE);
    await seedResource(cache, db, WEBID_A, SCOPE_PM, OTHER_FINANCE);
    const [stuckKey] = [...cache.bytes.keys()];
    // One byte delete fails; the rest of the slice is still purged.
    const realDelete = cache.delete.bind(cache);
    cache.delete = async (request: Request) => {
      if (request.url === stuckKey) throw new Error('cache delete failed');
      return realDelete(request);
    };

    const purged = await purgeReplicaSlice(cache, db, {
      webId: WEBID_A,
      grantScope: SCOPE_PM,
      targets: FINANCE_TARGETS,
    });

    expect(purged).toEqual({ bytesDropped: 1, metaDropped: 1 });
    expect([...cache.bytes.keys()]).toEqual([stuckKey]);
    expect(db.rows.size).toBe(1);

    // The surviving row still indexes the stuck bytes, so the later profile purge removes them.
    cache.delete = realDelete;
    expect(await purgeReplica(cache, db, WEBID_A)).toMatchObject({
      bytesDropped: 1,
      metaDropped: 1,
    });
    expect(cache.bytes.size).toBe(0);
    expect(db.rows.size).toBe(0);
  });
});

describe('SharedReplica.read — Medium #3: a non-cacheable 2xx is still returned to the caller', () => {
  it('a 2xx whose cache.put REJECTS (e.g. 206 / Vary:*) is returned LIVE, just un-cached', async () => {
    // A cache that rejects put() exactly as the real Cache API does for a 206 Partial Content
    // or a `Vary: *` response. The successful read must NOT fail — the live body is returned.
    const db = new FakeMetaStore();
    let putAttempts = 0;
    const rejectingPutCache: ReplicaByteCache = {
      match: async () => undefined,
      put: async () => {
        putAttempts++;
        throw new TypeError('Vary header contains * which is not allowed in cache.put');
      },
      delete: async () => false,
      keys: async () => [],
    };
    const egress = scriptedEgress([
      () =>
        new Response('partial-bytes', {
          status: 206,
          headers: { 'content-range': 'bytes 0-9/100', etag: 'W/"v1"' },
        }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress,
      cache: rejectingPutCache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    // The request SUCCEEDS with the live body even though the persist failed.
    expect(result.response.status).toBe(206);
    expect(await result.response.text()).toBe('partial-bytes');
    expect(putAttempts).toBe(1); // we DID attempt to cache (best-effort), and tolerated the throw
    // Nothing persisted: no metadata row was written for the un-cacheable response.
    expect(db.rows.size).toBe(0);
  });

  it('a 2xx whose METADATA write rejects is still returned LIVE (best-effort persist)', async () => {
    const cache = new FakeCache();
    const db = new FakeMetaStore();
    // Make the metadata write throw; the live body must still come back.
    db.putMetadata = async () => {
      throw new Error('idb write failed');
    };
    const egress = scriptedEgress([
      () => new Response('the-bytes', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe('the-bytes');
    // The orphaned byte entry (no companion metadata) was best-effort dropped.
    expect(cache.bytes.size).toBe(0);
  });
});

describe('SharedReplica.read — Low #5: a HEAD response carries NO body', () => {
  let cache: FakeCache;
  let db: FakeMetaStore;
  beforeEach(() => {
    cache = new FakeCache();
    db = new FakeMetaStore();
  });

  it('a fresh HEAD egress response is body-stripped (headers/status only)', async () => {
    // Even if the pod stray-returns a body on HEAD, the replica strips it.
    const egress = scriptedEgress([
      () =>
        new Response('SHOULD-NOT-BE-RETURNED', {
          status: 200,
          headers: { etag: 'W/"v1"', 'content-type': 'text/turtle' },
        }),
    ]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'HEAD', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe(''); // NO body
    // The HEAD did not cache a body (only GET stores), so the cross-method cache stays empty.
    expect(cache.bytes.size).toBe(0);
  });

  it('a 304-revalidated HEAD does NOT serve the cached GET body', async () => {
    // First a GET warms the cache with a body; then a HEAD revalidates to a 304. The HEAD must
    // serve headers/status only — NEVER the cached GET body (the Low #5 bug).
    const getEgress = scriptedEgress([
      () => new Response('CACHED-GET-BODY', { status: 200, headers: { etag: 'W/"v1"' } }),
    ]);
    await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: getEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'GET', { Accept: 'text/turtle' }, undefined);
    expect(cache.bytes.size).toBe(1);

    const headEgress = scriptedEgress([() => new Response(null, { status: 304 })]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress: headEgress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'HEAD', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.fromCache).toBe(true);
    expect(await result.response.text()).toBe(''); // body stripped — NOT 'CACHED-GET-BODY'
  });

  it('a HEAD on a non-2xx/non-304 live response is also body-stripped', async () => {
    const egress = scriptedEgress([() => new Response('error-detail-body', { status: 404 })]);
    const result = await new SharedReplica({
      gate: allow(SCOPE_PM),
      egress,
      cache,
      db,
      webId: WEBID_A,
    }).read(URL, 'HEAD', { Accept: 'text/turtle' }, undefined);
    if ('deny' in result) throw new Error('unexpected deny');
    expect(result.response.status).toBe(404);
    expect(await result.response.text()).toBe('');
  });
});
