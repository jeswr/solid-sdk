// AUTHORED-BY Claude Opus 4.8
//
// Unit tests for the untrusted `requestAccess` payload parser (design §4.2). Every axis is
// fail-closed: non-IRI classes dropped (empty → reject), no modes → reject, a bounded ISO-8601
// duration REQUIRED (unparseable/absent/zero/negative → reject), duration clamped to the ceiling.

import { describe, expect, it } from 'vitest';
import {
  MAX_GRANT_MS,
  normaliseAccessRequest,
  parseIso8601DurationMs,
} from '../src/background/core/class-request';

const NOW = 1_000_000_000;

describe('parseIso8601DurationMs', () => {
  it('parses days / weeks / hours / combined', () => {
    expect(parseIso8601DurationMs('P1D')).toBe(24 * 60 * 60 * 1000);
    expect(parseIso8601DurationMs('P30D')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseIso8601DurationMs('P1W')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseIso8601DurationMs('PT12H')).toBe(12 * 60 * 60 * 1000);
    expect(parseIso8601DurationMs('P1DT1H')).toBe(25 * 60 * 60 * 1000);
    expect(parseIso8601DurationMs('PT30M')).toBe(30 * 60 * 1000);
  });
  it('rejects bare/empty/zero/negative/garbage (fail-closed)', () => {
    expect(parseIso8601DurationMs('P')).toBeNull();
    expect(parseIso8601DurationMs('PT')).toBeNull();
    expect(parseIso8601DurationMs('P0D')).toBeNull();
    expect(parseIso8601DurationMs('30d')).toBeNull();
    expect(parseIso8601DurationMs('-P1D')).toBeNull();
    expect(parseIso8601DurationMs('')).toBeNull();
    expect(parseIso8601DurationMs(undefined)).toBeNull();
    expect(parseIso8601DurationMs(42)).toBeNull();
  });
});

describe('normaliseAccessRequest', () => {
  it('normalises a well-formed request', () => {
    const r = normaliseAccessRequest(
      {
        classes: ['https://w3id.org/jeswr/sectors/finance#Transaction'],
        modes: ['read', 'read'],
        purpose: '  https://w3id.org/dpv#ServiceProvision  ',
        duration: 'P30D',
      },
      NOW,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.classes).toEqual(['https://w3id.org/jeswr/sectors/finance#Transaction']);
    expect(r.modes).toEqual(['read']);
    expect(r.purpose).toBe('https://w3id.org/dpv#ServiceProvision');
    expect(r.durationMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(r.expiresAt).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
  });
  it('drops non-IRI classes; rejects when none remain', () => {
    const ok = normaliseAccessRequest(
      { classes: ['not-iri', 'https://x.example/C'], modes: ['read'], duration: 'P1D' },
      NOW,
    );
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.classes).toEqual(['https://x.example/C']);

    const bad = normaliseAccessRequest(
      { classes: ['not-iri'], modes: ['read'], duration: 'P1D' },
      NOW,
    );
    expect('error' in bad).toBe(true);
  });
  it('rejects when no recognised mode is present', () => {
    const bad = normaliseAccessRequest(
      { classes: ['https://x.example/C'], modes: ['control'], duration: 'P1D' },
      NOW,
    );
    expect('error' in bad).toBe(true);
  });
  it('rejects when the duration is missing / unparseable (expiry is mandatory)', () => {
    expect(
      'error' in normaliseAccessRequest({ classes: ['https://x.example/C'], modes: ['read'] }, NOW),
    ).toBe(true);
    expect(
      'error' in
        normaliseAccessRequest(
          { classes: ['https://x.example/C'], modes: ['read'], duration: 'forever' },
          NOW,
        ),
    ).toBe(true);
  });
  it('clamps an over-long duration to the ceiling', () => {
    const r = normaliseAccessRequest(
      { classes: ['https://x.example/C'], modes: ['read'], duration: 'P4000D' },
      NOW,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.durationMs).toBe(MAX_GRANT_MS);
    expect(r.expiresAt).toBe(NOW + MAX_GRANT_MS);
  });
  it('nulls a blank/absent purpose', () => {
    const r = normaliseAccessRequest(
      { classes: ['https://x.example/C'], modes: ['read'], purpose: '   ', duration: 'P1D' },
      NOW,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.purpose).toBeNull();
  });
});
