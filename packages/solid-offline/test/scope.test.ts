/**
 * §7 WebID cache scoping — the DB + Cache names are namespaced per identity, are
 * deterministic, and never collide across two WebIDs. The scoping is the
 * mechanism that lets two identities share an origin without reading each other's
 * cache, and lets logout-purge target exactly one identity.
 */
import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_SCOPE,
  CACHE_PREFIX,
  DB_PREFIX,
  DEFAULT_CACHE_NAME,
  DEFAULT_DB_NAME,
  cacheNameForWebId,
  dbNameForWebId,
  scopeFor,
  scopeHash,
} from '../src/scope.js';

const ALICE = 'https://alice.example/profile/card#me';
const BOB = 'https://bob.example/profile/card#me';

describe('scope — §7 per-identity namespacing', () => {
  it('hashes a WebID deterministically + distinctly', () => {
    expect(scopeHash(ALICE)).toBe(scopeHash(ALICE));
    expect(scopeHash(ALICE)).not.toBe(scopeHash(BOB));
    expect(scopeHash(ALICE)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('falls back to the anonymous scope with no WebID', () => {
    expect(scopeFor(undefined)).toBe(ANONYMOUS_SCOPE);
    expect(dbNameForWebId(undefined)).toBe(DEFAULT_DB_NAME);
    expect(cacheNameForWebId(undefined)).toBe(DEFAULT_CACHE_NAME);
  });

  it('DB name and Cache name share the WebID scope but use distinct prefixes', () => {
    const db = dbNameForWebId(ALICE);
    const cache = cacheNameForWebId(ALICE);
    expect(db.startsWith(DB_PREFIX)).toBe(true);
    expect(cache.startsWith(CACHE_PREFIX)).toBe(true);
    // Same scope discriminator (the hash), different store.
    expect(db.slice(DB_PREFIX.length)).toBe(cache.slice(CACHE_PREFIX.length));
    expect(db).not.toBe(cache);
  });

  it('a different WebID maps to a different DB AND a different Cache (no cross-read)', () => {
    expect(dbNameForWebId(ALICE)).not.toBe(dbNameForWebId(BOB));
    expect(cacheNameForWebId(ALICE)).not.toBe(cacheNameForWebId(BOB));
    // And anonymous is distinct from both identities.
    expect(dbNameForWebId(ALICE)).not.toBe(DEFAULT_DB_NAME);
    expect(cacheNameForWebId(BOB)).not.toBe(DEFAULT_CACHE_NAME);
  });
});
