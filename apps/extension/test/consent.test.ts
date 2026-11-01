// AUTHORED-BY Claude Opus 4.8
//
// Unit tests for the pure consent-flow logic (design §4.1): building the pending record and
// mapping a per-class approve/deny decision to concrete grants. Proves an unresolved class
// mints a grant authorising NOTHING, and only requested+approved classes mint grants.

import { describe, expect, it } from 'vitest';
import type { PinnedTarget } from '../src/background/core/class-grant';
import { buildPendingConsent, consentDecisionToGrants } from '../src/background/core/consent';

const ORIGIN = 'https://app.example';
const WEBID = 'https://alice.pod.example/profile/card#me';
const FIN = 'https://w3id.org/jeswr/sectors/finance#Transaction';
const HEALTH = 'https://w3id.org/jeswr/sectors/health#Record';
const NOW = 5_000;
const EXP = NOW + 100;

function pending() {
  const spec = { classes: [FIN, HEALTH], modes: ['read'] as const, purpose: 'p', expiresAt: EXP };
  const resolved = new Map<string, { targets: readonly PinnedTarget[]; shape?: string | null }>([
    [FIN, { targets: [{ url: 'https://alice.pod.example/finance/', kind: 'container' }] }],
    // HEALTH intentionally UNRESOLVED (no entry) → empty targets.
  ]);
  return buildPendingConsent('c1', ORIGIN, WEBID, spec, resolved, NOW);
}

describe('buildPendingConsent', () => {
  it('carries every requested class, empty targets when unresolved', () => {
    const p = pending();
    expect(p.classes.map((c) => c.dataClass)).toEqual([FIN, HEALTH]);
    expect(p.classes[0].targets).toHaveLength(1);
    expect(p.classes[1].targets).toEqual([]);
    expect(p.classes[0].expiresAt).toBe(EXP);
  });
});

describe('consentDecisionToGrants', () => {
  it('mints a grant ONLY for requested+approved classes', () => {
    let n = 0;
    const grants = consentDecisionToGrants(pending(), [FIN], () => `g${++n}`);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      grantId: 'g1',
      origin: ORIGIN,
      webId: WEBID,
      dataClass: FIN,
      modes: ['read'],
      expiresAt: EXP,
    });
  });
  it('mints nothing when nothing is approved (deny-all)', () => {
    expect(consentDecisionToGrants(pending(), [], () => 'g')).toEqual([]);
  });
  it('ignores an approved class that was not in the request (defence in depth)', () => {
    const grants = consentDecisionToGrants(pending(), ['https://evil/Class', FIN], () => 'g');
    expect(grants.map((g) => g.dataClass)).toEqual([FIN]);
  });
  it('an approved but UNRESOLVED class mints a grant with an EMPTY target set (authorises nothing)', () => {
    const grants = consentDecisionToGrants(pending(), [HEALTH], () => 'gH');
    expect(grants).toHaveLength(1);
    expect(grants[0].targets).toEqual([]);
  });
});
