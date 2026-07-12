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
  isScopeChange,
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

  it('names carry the cache-format generation (coherent across an upgrade)', () => {
    // Both stores are generation-scoped, so an old-format cache is abandoned
    // together (no mixed-generation reads / offline misses).
    expect(DB_PREFIX).toContain('-v2:');
    expect(CACHE_PREFIX).toContain('-v2:');
    expect(dbNameForWebId(ALICE)).toContain('-v2:');
    expect(cacheNameForWebId(ALICE)).toContain('-v2:');
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

describe('#4 isScopeChange — anonymous-after-login clears the previous identity', () => {
  it('the FIRST config message is always a scope change (even undefined)', () => {
    expect(isScopeChange(false, undefined, undefined)).toBe(true);
    expect(isScopeChange(false, undefined, ALICE)).toBe(true);
  });

  it('logged-in → anonymous (undefined) IS a change (the core bug)', () => {
    // Previously the worker only reacted to a truthy webId, so this returned no
    // change and the SW kept serving Alice's scoped cache to the anonymous client.
    expect(isScopeChange(true, ALICE, undefined)).toBe(true);
  });

  it('switching identities is a change; the same identity is not', () => {
    expect(isScopeChange(true, ALICE, BOB)).toBe(true);
    expect(isScopeChange(true, ALICE, ALICE)).toBe(false);
    expect(isScopeChange(true, undefined, undefined)).toBe(false);
  });
});
