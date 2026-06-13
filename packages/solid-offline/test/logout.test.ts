/**
 * §7 WebID-scoped cache isolation + MANDATORY logout-purge.
 *
 * Uses the REAL MetadataStore over fake-indexeddb (so IDB scoping/purge is
 * exercised end-to-end) plus an in-memory CacheStorage stub (so the bytes-cache
 * half of purge is exercised by name). Two assertions the spec pins:
 *   1. WebID scoping ISOLATES two identities — Alice never reads Bob's metadata.
 *   2. logout() PURGES BOTH stores (Cache API + IndexedDB) for that WebID, and
 *      leaves the other identity's stores intact.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type CacheStorageLike, purgeForWebId } from '../src/logout.js';
import { MetadataStore } from '../src/metadata-store.js';
import { cacheNameForWebId, dbNameForWebId } from '../src/scope.js';
import type { CacheMetadata } from '../src/types.js';

const ALICE = 'https://alice.example/profile/card#me';
const BOB = 'https://bob.example/profile/card#me';

function record(url: string, over: Partial<CacheMetadata> = {}): CacheMetadata {
  return {
    key: `${url} accept=text/turtle`,
    url,
    varyKey: 'accept=text/turtle',
    etag: '"v1"',
    contentType: 'text/turtle',
    fetchedAt: 1000,
    vary: 'Accept, Origin',
    aclStatus: 'ok',
    status: 200,
    ...over,
  };
}

/** A minimal in-memory CacheStorage: a Set of cache names that "exist". */
class MockCacheStorage implements CacheStorageLike {
  constructor(private readonly names = new Set<string>()) {}
  has(name: string): boolean {
    return this.names.has(name);
  }
  add(name: string): void {
    this.names.add(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.names.delete(name);
  }
}

/** Does a named IndexedDB database currently exist (per fake-indexeddb)? */
async function dbExists(name: string): Promise<boolean> {
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === name);
}

let opened: MetadataStore[] = [];
afterEach(() => {
  for (const s of opened) s.close();
  opened = [];
});

async function openFor(webId: string): Promise<MetadataStore> {
  const s = await MetadataStore.open(webId);
  opened.push(s);
  return s;
}

describe('§7 WebID-scoped cache isolation', () => {
  it('a different WebID never reads another identity cache', async () => {
    const alice = await openFor(ALICE);
    const bob = await openFor(BOB);

    await alice.put(record('https://alice.example/private/secret'));
    await bob.put(record('https://bob.example/private/secret'));

    // Bob cannot see Alice's record and vice-versa.
    expect(
      await bob.get('https://alice.example/private/secret accept=text/turtle'),
    ).toBeUndefined();
    expect(
      await alice.get('https://bob.example/private/secret accept=text/turtle'),
    ).toBeUndefined();

    // Each sees only its own.
    expect(await alice.getByUrl('https://alice.example/private/secret')).toHaveLength(1);
    expect(await alice.getByUrl('https://bob.example/private/secret')).toHaveLength(0);
    expect(await bob.getByUrl('https://bob.example/private/secret')).toHaveLength(1);

    // The scoping is by distinct DB names.
    expect(dbNameForWebId(ALICE)).not.toBe(dbNameForWebId(BOB));
  });
});

describe('logout-purge — drops BOTH stores for one WebID', () => {
  it('purges Alice Cache API + IndexedDB and leaves Bob intact', async () => {
    // Seed both identities' IDB metadata.
    const alice = await openFor(ALICE);
    const bob = await openFor(BOB);
    await alice.put(record('https://alice.example/doc'));
    await bob.put(record('https://bob.example/doc'));
    // Close Alice's connection so the DB deletion isn't blocked by an open handle.
    alice.close();
    opened = opened.filter((s) => s !== alice);

    // Seed both identities' byte caches.
    const caches = new MockCacheStorage();
    caches.add(cacheNameForWebId(ALICE));
    caches.add(cacheNameForWebId(BOB));

    expect(await dbExists(dbNameForWebId(ALICE))).toBe(true);
    expect(await dbExists(dbNameForWebId(BOB))).toBe(true);

    const result = await purgeForWebId(ALICE, { caches, indexedDB });

    // Both halves of Alice's cache are gone.
    expect(result.cacheDeleted).toBe(true);
    expect(result.dbDeleted).toBe(true);
    expect(result.cacheName).toBe(cacheNameForWebId(ALICE));
    expect(result.dbName).toBe(dbNameForWebId(ALICE));
    expect(result.errors).toHaveLength(0);

    expect(caches.has(cacheNameForWebId(ALICE))).toBe(false);
    expect(await dbExists(dbNameForWebId(ALICE))).toBe(false);

    // Bob is untouched: both stores still present.
    expect(caches.has(cacheNameForWebId(BOB))).toBe(true);
    expect(await dbExists(dbNameForWebId(BOB))).toBe(true);
    expect(await bob.get('https://bob.example/doc accept=text/turtle')).toMatchObject({
      url: 'https://bob.example/doc',
    });
  });

  it('reports cacheDeleted=false when no cache existed but still purges IDB', async () => {
    const s = await openFor(ALICE);
    await s.put(record('https://alice.example/doc'));
    s.close();
    opened = opened.filter((x) => x !== s);

    const caches = new MockCacheStorage(); // empty — nothing to delete
    const result = await purgeForWebId(ALICE, { caches, indexedDB });

    expect(result.cacheDeleted).toBe(false);
    expect(result.dbDeleted).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(await dbExists(dbNameForWebId(ALICE))).toBe(false);
  });

  it('purges the anonymous scope when no WebID is given', async () => {
    const s = await MetadataStore.open(undefined);
    await s.put(record('https://pod.example/doc'));
    s.close();

    const caches = new MockCacheStorage();
    caches.add(cacheNameForWebId(undefined));
    const result = await purgeForWebId(undefined, { caches, indexedDB });

    expect(result.cacheName).toBe(cacheNameForWebId(undefined));
    expect(result.dbName).toBe(dbNameForWebId(undefined));
    expect(result.cacheDeleted).toBe(true);
    expect(result.dbDeleted).toBe(true);
  });
});
