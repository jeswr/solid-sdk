// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Claude Opus 5.5
//
// Unit tests for the pure consent-flow logic (design §4.1, BWC3 C5): building the pending
// record with per-target ids and pre-selection, and mapping a per-target decision to grants.
// Only selected targets are pinned; a class with no selected target mints nothing; any id that
// does not belong to that class in this snapshot refuses the whole decision.

import { describe, expect, it } from 'vitest';
import type { ResolvedTarget } from '../src/background/core/class-resolve-sai';
import {
  buildPendingConsent,
  consentDecisionToGrants,
  preselectTarget,
  validateApprovedTargets,
} from '../src/background/core/consent';
import { PIM_STORAGE_CLASS } from '../src/shared/storage-class';

const ORIGIN = 'https://app.example';
const WEBID = 'https://alice.pod.example/profile/card#me';
const FIN = 'https://w3id.org/jeswr/sectors/finance#Transaction';
const HEALTH = 'https://w3id.org/jeswr/sectors/health#Record';
const NOW = 5_000;
const EXP = NOW + 100;

function target(
  url: string,
  source: ResolvedTarget['source'] = 'type-index',
  check: ResolvedTarget['check'] = 'unchecked',
  sources: ResolvedTarget['sources'] = [source],
): ResolvedTarget {
  return { url, kind: 'container', source, sources, check };
}

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function pending(prefix = 't', classes = [FIN, HEALTH]) {
  const spec = { classes, modes: ['read'] as const, purpose: 'p', expiresAt: EXP };
  const resolved = new Map<string, { targets: readonly ResolvedTarget[]; shape?: string | null }>([
    [
      FIN,
      {
        targets: [
          target('https://alice.pod.example/finance/'),
          target('https://alice.pod.example/archive/', 'sai', 'mixed'),
        ],
      },
    ],
    // HEALTH intentionally UNRESOLVED (no entry) → empty targets.
  ]);
  return buildPendingConsent('c1', ORIGIN, WEBID, spec, resolved, NOW, ids(prefix));
}

describe('buildPendingConsent', () => {
  it('carries every requested class, empty targets when unresolved', () => {
    const p = pending();
    expect(p.classes.map((c) => c.dataClass)).toEqual([FIN, HEALTH]);
    expect(p.classes[0].targets).toHaveLength(2);
    expect(p.classes[1].targets).toEqual([]);
    expect(p.classes[0].expiresAt).toBe(EXP);
  });
  it('gives each target a minted id, its source and check, and the C5 pre-selection', () => {
    expect(pending().classes[0].targets).toEqual([
      {
        id: 't1',
        url: 'https://alice.pod.example/finance/',
        kind: 'container',
        source: 'type-index',
        check: 'unchecked',
        preselected: true,
      },
      {
        id: 't2',
        url: 'https://alice.pod.example/archive/',
        kind: 'container',
        source: 'sai',
        check: 'mixed',
        preselected: false,
      },
    ]);
  });
});

describe('preselectTarget (C5)', () => {
  it.each([
    ['type-index', 'conforms', ['type-index'], true],
    ['type-index', 'unchecked', ['type-index'], true],
    ['type-index', 'mixed', ['type-index'], false],
    ['sai', 'conforms', ['sai'], true],
    ['sai', 'unchecked', ['sai'], false],
    ['sai', 'mixed', ['sai'], false],
    // A container both rungs declare is a Type Index target too.
    ['sai', 'unchecked', ['sai', 'type-index'], true],
    ['sai', 'mixed', ['sai', 'type-index'], false],
  ] as const)('%s target that is %s (sources %j) → %s', (source, check, sources, expected) => {
    expect(preselectTarget(FIN, target('https://a/x/', source, check, [...sources]))).toBe(
      expected,
    );
  });
  it('never pre-selects whole-pod storage', () => {
    expect(preselectTarget(PIM_STORAGE_CLASS, target('https://a/', 'type-index', 'conforms'))).toBe(
      false,
    );
  });
});

describe('consentDecisionToGrants', () => {
  it('pins only the selected one of two targets', () => {
    let n = 0;
    const grants = consentDecisionToGrants(pending(), { [FIN]: ['t2'] }, () => `g${++n}`);
    expect(grants).toHaveLength(1);
    expect(grants?.[0]).toMatchObject({
      grantId: 'g1',
      origin: ORIGIN,
      webId: WEBID,
      dataClass: FIN,
      modes: ['read'],
      expiresAt: EXP,
      targets: [{ url: 'https://alice.pod.example/archive/', kind: 'container' }],
    });
    // Ids and provenance never persist.
    expect(Object.keys(grants?.[0].targets[0] ?? {})).toEqual(['url', 'kind']);
  });
  it('pins every selected target, deduplicating repeated ids', () => {
    const grants = consentDecisionToGrants(pending(), { [FIN]: ['t1', 't2', 't1'] }, () => 'g');
    expect(grants?.[0].targets.map((t) => t.url)).toEqual([
      'https://alice.pod.example/finance/',
      'https://alice.pod.example/archive/',
    ]);
  });
  it('mints nothing when nothing is approved (deny-all)', () => {
    expect(consentDecisionToGrants(pending(), {}, () => 'g')).toEqual([]);
  });
  it('does not grant a class with no selected target, including an unresolved class', () => {
    expect(consentDecisionToGrants(pending(), { [FIN]: [], [HEALTH]: [] }, () => 'g')).toEqual([]);
  });
  it('refuses an id from another class', () => {
    const other = buildPendingConsent(
      'c1',
      ORIGIN,
      WEBID,
      { classes: [FIN, HEALTH], modes: ['read'], purpose: null, expiresAt: EXP },
      new Map([
        [FIN, { targets: [target('https://alice.pod.example/finance/')] }],
        [HEALTH, { targets: [target('https://alice.pod.example/health/')] }],
      ]),
      NOW,
      ids('t'),
    );
    expect(consentDecisionToGrants(other, { [FIN]: ['t2'] }, () => 'g')).toBeNull();
    expect(
      consentDecisionToGrants(other, { [FIN]: ['t1'], [HEALTH]: ['t1'] }, () => 'g'),
    ).toBeNull();
  });
  it('refuses an id from another request, even alongside a valid one', () => {
    const elsewhere = pending('x').classes[0].targets[0].id;
    expect(consentDecisionToGrants(pending(), { [FIN]: [elsewhere] }, () => 'g')).toBeNull();
    expect(consentDecisionToGrants(pending(), { [FIN]: ['t1', elsewhere] }, () => 'g')).toBeNull();
  });
  it('refuses a class that was not requested (defence in depth)', () => {
    expect(
      consentDecisionToGrants(pending(), { 'https://evil/Class': [], [FIN]: ['t1'] }, () => 'g'),
    ).toBeNull();
  });
});

describe('validateApprovedTargets', () => {
  it.each([
    null,
    undefined,
    'all',
    [FIN],
    { [FIN]: 't1' },
    { [FIN]: [1] },
  ])('refuses the malformed decision %j', (approved) => {
    expect(validateApprovedTargets(pending(), approved)).toBeNull();
  });
  it('drops classes with no selection and keeps the selected ids', () => {
    expect(validateApprovedTargets(pending(), { [FIN]: ['t1'], [HEALTH]: [] })).toEqual({
      [FIN]: ['t1'],
    });
  });
});
