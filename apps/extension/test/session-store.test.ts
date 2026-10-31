// AUTHORED-BY Claude Sonnet 5
//
// `session-store.ts`'s legacy-session migration: security hardening (design roborev
// round-1) moved the DPoP private key OFF `chrome.storage.local` (where it used to live
// inline as an extractable JWK pair) and into a non-extractable IndexedDB `CryptoKeyPair`
// (see `core/dpop-key-db.ts` / `core/dpop-key-store.ts`). `loadSession()` is the one choke
// point that reads a persisted session, so it is where a pre-hardening on-disk record is
// detected and cleaned — these tests drive that path directly against a minimal in-memory
// `chrome.storage.local` stub.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ClassGrant } from '../src/background/core/class-grant';
import {
  loadClassGrants,
  loadSession,
  pruneExpiredClassGrants,
  revokeClassGrant,
  type StoredSession,
  saveSession,
} from '../src/background/session-store';

function installChromeStorageStub(): Map<string, unknown> {
  const backing = new Map<string, unknown>();
  (
    globalThis as unknown as {
      chrome: {
        storage: { local: chrome.storage.LocalStorageArea };
      };
    }
  ).chrome = {
    storage: {
      local: {
        get: async (key: string) => (backing.has(key) ? { [key]: backing.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) backing.set(k, v);
        },
        remove: async (key: string) => {
          backing.delete(key);
        },
      } as unknown as chrome.storage.LocalStorageArea,
    },
  };
  return backing;
}

const BASE_SESSION: StoredSession = {
  webId: 'https://alice.pod.example/profile/card#me',
  accessToken: 'access-token-xyz',
  refreshToken: 'refresh-xyz',
  issuer: 'https://idp.example/',
  tokenEndpoint: 'https://idp.example/token',
  clientId: 'https://pm.example/clientid.jsonld',
  expiresAt: Date.now() + 60 * 60 * 1000,
};

describe('loadSession — legacy extractable-JWK migration', () => {
  let backing: Map<string, unknown>;

  beforeEach(() => {
    backing = installChromeStorageStub();
  });

  it('round-trips a current-shape session unchanged (no legacy field, no migration)', async () => {
    await saveSession(BASE_SESSION);
    const loaded = await loadSession();
    expect(loaded).toEqual(BASE_SESSION);
    // Untouched: no rewrite occurred (same object shape persisted).
    expect(backing.get('solid:session')).toEqual(BASE_SESSION);
  });

  it('returns null when no session is stored', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('strips a legacy inline extractable dpopKeyPair and persists the cleaned record', async () => {
    const legacyKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const legacyJwk = {
      publicKey: await crypto.subtle.exportKey('jwk', legacyKeyPair.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', legacyKeyPair.privateKey),
    };
    // Fabricate the PRE-HARDENING on-disk shape directly (bypassing the current StoredSession
    // type, which no longer declares this field) — this is exactly what an old install's
    // `chrome.storage.local` would still contain the first time it runs the new code.
    backing.set('solid:session', { ...BASE_SESSION, dpopKeyPair: legacyJwk });

    const loaded = await loadSession();

    // The returned session carries no key material at all.
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(BASE_SESSION);
    expect((loaded as unknown as { dpopKeyPair?: unknown }).dpopKeyPair).toBeUndefined();

    // The MIGRATION WROTE BACK the cleaned record — the extractable JWK no longer lingers in
    // storage at rest, not even until the next unrelated save.
    const rawAfter = backing.get('solid:session') as Record<string, unknown>;
    expect(rawAfter.dpopKeyPair).toBeUndefined();
    expect(rawAfter).toEqual(BASE_SESSION);
  });

  it('a second loadSession() call after migration is a stable no-op (idempotent)', async () => {
    const legacyKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    backing.set('solid:session', {
      ...BASE_SESSION,
      dpopKeyPair: {
        publicKey: await crypto.subtle.exportKey('jwk', legacyKeyPair.publicKey),
        privateKey: await crypto.subtle.exportKey('jwk', legacyKeyPair.privateKey),
      },
    });

    await loadSession(); // first call migrates
    const second = await loadSession(); // second call: already clean
    expect(second).toEqual(BASE_SESSION);
  });
});

describe('revokeClassGrant + pruneExpiredClassGrants — removed/expired reporting', () => {
  let backing: Map<string, unknown>;
  beforeEach(() => {
    backing = installChromeStorageStub();
  });

  function grant(overrides: Partial<ClassGrant> = {}): ClassGrant {
    return {
      grantId: 'g1',
      webId: BASE_SESSION.webId,
      origin: 'https://appx.example',
      dataClass: 'https://w3id.org/jeswr/sectors/finance#Transaction',
      modes: ['read'],
      purpose: null,
      expiresAt: Date.now() + 60_000,
      targets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }],
      createdAt: Date.now(),
      ...overrides,
    };
  }

  it('returns the removed grant(s) and removes them from the store', async () => {
    backing.set('solid:class-grants', [grant({ grantId: 'g1' }), grant({ grantId: 'g2' })]);
    const removed = await revokeClassGrant('g1', 'https://appx.example');
    expect(removed.map((g) => g.grantId)).toEqual(['g1']);
    expect((await loadClassGrants()).map((g) => g.grantId)).toEqual(['g2']);
  });

  it('removes EVERY row matching (grantId, origin) — no duplicate stays live after a revoke', async () => {
    // A store that somehow holds a duplicate id: the revoke must leave NONE matching live.
    backing.set('solid:class-grants', [
      grant({ grantId: 'dup' }),
      grant({ grantId: 'dup' }),
      grant({ grantId: 'other' }),
    ]);
    const removed = await revokeClassGrant('dup', 'https://appx.example');
    expect(removed).toHaveLength(2);
    expect((await loadClassGrants()).map((g) => g.grantId)).toEqual(['other']);
  });

  it('does not revoke another origin’s grant (returns [])', async () => {
    backing.set('solid:class-grants', [grant({ grantId: 'g1', origin: 'https://appx.example' })]);
    const removed = await revokeClassGrant('g1', 'https://evil.example');
    expect(removed).toEqual([]);
    expect(await loadClassGrants()).toHaveLength(1);
  });

  it('pruneExpiredClassGrants returns {live, expired} and persists only the live', async () => {
    const now = Date.now();
    backing.set('solid:class-grants', [
      grant({ grantId: 'live', expiresAt: now + 60_000 }),
      grant({ grantId: 'dead', expiresAt: now - 1000 }),
    ]);
    const { live, expired } = await pruneExpiredClassGrants(now);
    expect(live.map((g) => g.grantId)).toEqual(['live']);
    expect(expired.map((g) => g.grantId)).toEqual(['dead']);
    expect((await loadClassGrants()).map((g) => g.grantId)).toEqual(['live']);
  });
});
