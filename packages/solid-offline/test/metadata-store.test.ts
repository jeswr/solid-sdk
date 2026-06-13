/**
 * MetadataStore over fake-indexeddb: CRUD, byUrl index, touch, per-identity
 * DB naming (§7 cache scoping).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DB_NAME, MetadataStore, dbNameForWebId } from '../src/metadata-store.js';
import type { CacheMetadata } from '../src/types.js';

function record(over: Partial<CacheMetadata> = {}): CacheMetadata {
  return {
    key: 'https://pod/a accept=text/turtle',
    url: 'https://pod/a',
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

let stores: MetadataStore[] = [];
afterEach(() => {
  for (const s of stores) s.close();
  stores = [];
});

async function freshStore(webId?: string): Promise<MetadataStore> {
  // Unique name per test to avoid cross-test bleed in the shared fake IDB.
  const name = `solid-offline:test-${Math.random().toString(36).slice(2)}`;
  const s = await MetadataStore.openNamed(name);
  stores.push(s);
  void webId;
  return s;
}

describe('dbNameForWebId — §7 per-identity scoping', () => {
  it('uses the anonymous DB when no WebID', () => {
    expect(dbNameForWebId(undefined)).toBe(DEFAULT_DB_NAME);
  });
  it('is deterministic + distinct per WebID', () => {
    const a = dbNameForWebId('https://alice.example/profile/card#me');
    const b = dbNameForWebId('https://bob.example/profile/card#me');
    expect(a).toBe(dbNameForWebId('https://alice.example/profile/card#me'));
    expect(a).not.toBe(b);
    expect(a.startsWith('solid-offline:')).toBe(true);
  });
});

describe('MetadataStore CRUD', () => {
  it('puts and gets a record', async () => {
    const s = await freshStore();
    await s.put(record());
    expect(await s.get('https://pod/a accept=text/turtle')).toMatchObject({
      url: 'https://pod/a',
      etag: '"v1"',
      status: 200,
    });
  });

  it('returns undefined for a missing key', async () => {
    const s = await freshStore();
    expect(await s.get('nope')).toBeUndefined();
  });

  it('deletes a record', async () => {
    const s = await freshStore();
    await s.put(record());
    await s.delete('https://pod/a accept=text/turtle');
    expect(await s.get('https://pod/a accept=text/turtle')).toBeUndefined();
  });

  it('finds all variants of a URL via the byUrl index', async () => {
    const s = await freshStore();
    await s.put(record({ key: 'https://pod/a accept=text/turtle', varyKey: 'accept=text/turtle' }));
    await s.put(record({ key: 'https://pod/a accept=image/png', varyKey: 'accept=image/png' }));
    const all = await s.getByUrl('https://pod/a');
    expect(all).toHaveLength(2);
  });

  it('touch updates fetchedAt without altering other fields (304 confirm)', async () => {
    const s = await freshStore();
    await s.put(record({ fetchedAt: 1000 }));
    await s.touch('https://pod/a accept=text/turtle', 9999);
    const got = await s.get('https://pod/a accept=text/turtle');
    expect(got?.fetchedAt).toBe(9999);
    expect(got?.etag).toBe('"v1"');
  });

  it('touch on a missing key is a no-op', async () => {
    const s = await freshStore();
    await expect(s.touch('missing', 1)).resolves.toBeUndefined();
  });

  it('clear empties the store', async () => {
    const s = await freshStore();
    await s.put(record());
    await s.clear();
    expect(await s.get('https://pod/a accept=text/turtle')).toBeUndefined();
  });
});
