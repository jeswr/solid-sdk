// AUTHORED-BY Claude Opus 4.8
//
// EXHAUSTIVE adversarial unit tests for the per-data-class grant gate — the Phase-2 security
// heart (design §4). These prove the load-bearing enforcement as PURE functions:
//   - method → mode mapping + the write ⊇ append implication (read independent)
//   - target-set membership: instance exact, container prefix, cross-origin / traversal / sibling
//     DENY, query/fragment normalisation, non-http DENY
//   - grantCovers fail-closed on expiry / empty (unresolved) targets / mode mismatch / target miss
//   - decideClassAccess: no grant → no-class-grant, present-but-uncovered → out-of-grant-scope
//   - grant validation drops tampered/corrupt storage records
//   - the (origin, webId) session boundary

import { describe, expect, it } from 'vitest';
import {
  type ClassGrant,
  decideClassAccess,
  grantCovers,
  grantsForSession,
  isGrantExpired,
  isValidGrant,
  isWithinTarget,
  liveGrantOrigins,
  methodToMode,
  modeSatisfies,
  normaliseMode,
  normaliseModes,
  type PinnedTarget,
  pruneExpiredGrants,
  sanitiseGrants,
  targetsCover,
} from '../src/background/core/class-grant';

const T0 = 1_000_000;

function grant(overrides: Partial<ClassGrant> = {}): ClassGrant {
  return {
    grantId: 'g1',
    webId: 'https://alice.pod.example/profile/card#me',
    origin: 'https://app.example',
    dataClass: 'https://w3id.org/jeswr/sectors/finance#Transaction',
    modes: ['read'],
    purpose: 'https://w3id.org/dpv#ServiceProvision',
    expiresAt: T0 + 10_000,
    targets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }],
    createdAt: T0,
    ...overrides,
  };
}

describe('methodToMode — fail-closed method mapping', () => {
  it('maps read methods to read', () => {
    expect(methodToMode('GET')).toBe('read');
    expect(methodToMode('head')).toBe('read');
  });
  it('maps POST to append, mutating verbs to write', () => {
    expect(methodToMode('POST')).toBe('append');
    expect(methodToMode('PUT')).toBe('write');
    expect(methodToMode('PATCH')).toBe('write');
    expect(methodToMode('DELETE')).toBe('write');
  });
  it('maps an UNKNOWN method to write (fail-closed — hardest to satisfy)', () => {
    expect(methodToMode('FROB')).toBe('write');
    expect(methodToMode('')).toBe('write');
  });
});

describe('normaliseMode / normaliseModes', () => {
  it('accepts the three modes case-insensitively, rejects the rest', () => {
    expect(normaliseMode('Read')).toBe('read');
    expect(normaliseMode('WRITE')).toBe('write');
    expect(normaliseMode('append')).toBe('append');
    expect(normaliseMode('control')).toBeNull();
    expect(normaliseMode(42)).toBeNull();
  });
  it('dedupes + drops unrecognised entries', () => {
    expect(normaliseModes(['read', 'read', 'nope', 'write'])).toEqual(['read', 'write']);
    expect(normaliseModes('read')).toEqual([]);
    expect(normaliseModes(undefined)).toEqual([]);
  });
});

describe('modeSatisfies — write ⊇ append, read independent', () => {
  it('write covers append but not read', () => {
    expect(modeSatisfies(['write'], 'append')).toBe(true);
    expect(modeSatisfies(['write'], 'write')).toBe(true);
    expect(modeSatisfies(['write'], 'read')).toBe(false);
  });
  it('read covers only read', () => {
    expect(modeSatisfies(['read'], 'read')).toBe(true);
    expect(modeSatisfies(['read'], 'append')).toBe(false);
    expect(modeSatisfies(['read'], 'write')).toBe(false);
  });
  it('append covers only append', () => {
    expect(modeSatisfies(['append'], 'append')).toBe(true);
    expect(modeSatisfies(['append'], 'write')).toBe(false);
  });
  it('empty grant satisfies nothing (fail-closed)', () => {
    expect(modeSatisfies([], 'read')).toBe(false);
  });
});

describe('isWithinTarget — pinned membership, fail-closed', () => {
  const container: PinnedTarget = { url: 'https://alice.pod.example/finance/', kind: 'container' };
  const instance: PinnedTarget = {
    url: 'https://alice.pod.example/finance/statement.ttl',
    kind: 'instance',
  };

  it('container covers itself and descendants', () => {
    expect(isWithinTarget(container, 'https://alice.pod.example/finance/')).toBe(true);
    expect(isWithinTarget(container, 'https://alice.pod.example/finance/2026/jan.ttl')).toBe(true);
  });
  it('container ignores query + fragment on the request', () => {
    expect(isWithinTarget(container, 'https://alice.pod.example/finance/x.ttl?v=2#a')).toBe(true);
  });
  it('container does NOT cover a sibling with a shared prefix', () => {
    expect(isWithinTarget(container, 'https://alice.pod.example/finance-secret/x')).toBe(false);
    expect(isWithinTarget(container, 'https://alice.pod.example/financial')).toBe(false);
  });
  it('container DENIES a path-traversal that escapes it (URL parser normalises `..`)', () => {
    expect(isWithinTarget(container, 'https://alice.pod.example/finance/../secret/x')).toBe(false);
  });
  it('DENIES a cross-origin request even at the same path', () => {
    expect(isWithinTarget(container, 'https://evil.example/finance/x')).toBe(false);
  });
  it('instance is an EXACT path match', () => {
    expect(isWithinTarget(instance, 'https://alice.pod.example/finance/statement.ttl')).toBe(true);
    expect(isWithinTarget(instance, 'https://alice.pod.example/finance/statement.ttl?a=1')).toBe(
      true,
    );
    expect(isWithinTarget(instance, 'https://alice.pod.example/finance/statement.ttl2')).toBe(
      false,
    );
    expect(isWithinTarget(instance, 'https://alice.pod.example/finance/')).toBe(false);
  });
  it('DENIES an unparseable / non-http request or target', () => {
    expect(isWithinTarget(container, 'not a url')).toBe(false);
    expect(isWithinTarget(container, 'ftp://alice.pod.example/finance/x')).toBe(false);
    expect(isWithinTarget({ url: 'not a url', kind: 'container' }, 'https://a.example/x')).toBe(
      false,
    );
  });
});

describe('targetsCover', () => {
  it('is fail-closed on an empty target set', () => {
    expect(targetsCover([], 'https://alice.pod.example/finance/x')).toBe(false);
  });
  it('matches if ANY target covers', () => {
    const targets: PinnedTarget[] = [
      { url: 'https://alice.pod.example/health/', kind: 'container' },
      { url: 'https://alice.pod.example/finance/', kind: 'container' },
    ];
    expect(targetsCover(targets, 'https://alice.pod.example/finance/x')).toBe(true);
    expect(targetsCover(targets, 'https://alice.pod.example/other/x')).toBe(false);
  });
});

describe('isGrantExpired', () => {
  it('is expired at/after expiresAt', () => {
    expect(isGrantExpired(grant({ expiresAt: T0 }), T0)).toBe(true);
    expect(isGrantExpired(grant({ expiresAt: T0 + 1 }), T0)).toBe(false);
  });
  it('treats a NaN/invalid expiry as expired (fail-closed)', () => {
    expect(isGrantExpired(grant({ expiresAt: Number.NaN }), T0)).toBe(true);
  });
});

describe('isValidGrant / sanitiseGrants — reject tampered storage', () => {
  it('accepts a well-formed grant', () => {
    expect(isValidGrant(grant())).toBe(true);
  });
  it('rejects missing / malformed fields', () => {
    expect(isValidGrant(null)).toBe(false);
    expect(isValidGrant({ ...grant(), grantId: '' })).toBe(false);
    expect(isValidGrant({ ...grant(), webId: '' })).toBe(false);
    expect(isValidGrant({ ...grant(), origin: 'not-a-url' })).toBe(false);
    expect(isValidGrant({ ...grant(), expiresAt: 'soon' })).toBe(false);
    expect(isValidGrant({ ...grant(), modes: ['read', 'control'] })).toBe(false);
    expect(isValidGrant({ ...grant(), targets: [{ url: 'x', kind: 'bogus' }] })).toBe(false);
    expect(isValidGrant({ ...grant(), targets: 'nope' })).toBe(false);
  });
  it('sanitiseGrants drops invalid records, keeps valid ones', () => {
    const kept = sanitiseGrants([grant({ grantId: 'ok' }), { junk: true }, null, 42]);
    expect(kept.map((g) => g.grantId)).toEqual(['ok']);
    expect(sanitiseGrants('not-an-array')).toEqual([]);
  });
});

describe('grantCovers — the single-grant decision, fail-closed on every axis', () => {
  it('ALLOWS a read within the pinned container while live', () => {
    expect(grantCovers(grant(), 'https://alice.pod.example/finance/x.ttl', 'GET', T0)).toBe(true);
  });
  it('DENIES when expired', () => {
    expect(
      grantCovers(grant({ expiresAt: T0 }), 'https://alice.pod.example/finance/x.ttl', 'GET', T0),
    ).toBe(false);
  });
  it('DENIES when the target set is empty (unresolved / unknown class)', () => {
    expect(
      grantCovers(grant({ targets: [] }), 'https://alice.pod.example/finance/x', 'GET', T0),
    ).toBe(false);
  });
  it('DENIES when the mode is not satisfied (read grant, write request)', () => {
    expect(
      grantCovers(grant({ modes: ['read'] }), 'https://alice.pod.example/finance/x', 'PUT', T0),
    ).toBe(false);
  });
  it('DENIES a URL outside the pinned targets', () => {
    expect(grantCovers(grant(), 'https://alice.pod.example/health/x', 'GET', T0)).toBe(false);
  });
  it('a write grant ALLOWS append (POST) and write (PUT) within scope', () => {
    const g = grant({ modes: ['write'] });
    expect(grantCovers(g, 'https://alice.pod.example/finance/x', 'POST', T0)).toBe(true);
    expect(grantCovers(g, 'https://alice.pod.example/finance/x', 'PUT', T0)).toBe(true);
    // ...but not read (write does not imply read).
    expect(grantCovers(g, 'https://alice.pod.example/finance/x', 'GET', T0)).toBe(false);
  });
});

describe('decideClassAccess — the origin-scoped gate decision', () => {
  it('no live grant → no-class-grant', () => {
    expect(decideClassAccess([], 'https://alice.pod.example/finance/x', 'GET', T0)).toBe(
      'no-class-grant',
    );
  });
  it('all grants expired → no-class-grant (they are filtered out first)', () => {
    expect(
      decideClassAccess(
        [grant({ expiresAt: T0 - 1 })],
        'https://alice.pod.example/finance/x',
        'GET',
        T0,
      ),
    ).toBe('no-class-grant');
  });
  it('grants present but none cover → out-of-grant-scope', () => {
    expect(decideClassAccess([grant()], 'https://alice.pod.example/health/x', 'GET', T0)).toBe(
      'out-of-grant-scope',
    );
    // right resource, wrong mode:
    expect(decideClassAccess([grant()], 'https://alice.pod.example/finance/x', 'PUT', T0)).toBe(
      'out-of-grant-scope',
    );
  });
  it('a covering grant → ALLOW (null)', () => {
    expect(
      decideClassAccess([grant()], 'https://alice.pod.example/finance/x', 'GET', T0),
    ).toBeNull();
  });
  it('the UNION of several grants is honoured', () => {
    const g2 = grant({
      grantId: 'g2',
      targets: [{ url: 'https://alice.pod.example/health/', kind: 'container' }],
    });
    expect(
      decideClassAccess([grant(), g2], 'https://alice.pod.example/health/x', 'GET', T0),
    ).toBeNull();
  });
});

describe('pruneExpiredGrants / liveGrantOrigins / grantsForSession — session boundary', () => {
  it('pruneExpiredGrants keeps only live grants', () => {
    const kept = pruneExpiredGrants(
      [grant({ grantId: 'live' }), grant({ grantId: 'dead', expiresAt: T0 - 1 })],
      T0,
    );
    expect(kept.map((g) => g.grantId)).toEqual(['live']);
  });
  it('liveGrantOrigins filters by WebID + expiry', () => {
    const grants = [
      grant({ origin: 'https://a.example', webId: 'https://alice#me' }),
      grant({ origin: 'https://b.example', webId: 'https://bob#me' }),
      grant({ origin: 'https://c.example', webId: 'https://alice#me', expiresAt: T0 - 1 }),
    ];
    expect([...liveGrantOrigins(grants, T0, 'https://alice#me')]).toEqual(['https://a.example']);
  });
  it('grantsForSession filters to the exact origin AND WebID', () => {
    const grants = [
      grant({ grantId: 'mine', origin: 'https://app.example', webId: 'https://alice#me' }),
      grant({ grantId: 'other-origin', origin: 'https://evil.example', webId: 'https://alice#me' }),
      grant({ grantId: 'other-webid', origin: 'https://app.example', webId: 'https://bob#me' }),
    ];
    const mine = grantsForSession(grants, 'https://app.example', 'https://alice#me');
    expect(mine.map((g) => g.grantId)).toEqual(['mine']);
  });
});
