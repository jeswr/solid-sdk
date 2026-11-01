// AUTHORED-BY Claude Opus 4.8
//
// The PURE anti-spam decision behind `window.solid.requestAccess` (access-management residual c):
// the user-gesture requirement + the per-origin fixed-window rate limit. Exhaustive because this
// is the enforceable core of the throttle (the SW wiring is covered in service-worker-class-gate).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_ACCESS_THROTTLE,
  decideRequestAccess,
  type ThrottleState,
} from '../src/background/core/request-access-throttle';

const OPTS = { windowMs: 60_000, maxPerWindow: 3 };

describe('decideRequestAccess — user-gesture requirement (i)', () => {
  it('REJECTS a call with NO user activation, without consuming quota', () => {
    const d = decideRequestAccess(undefined, 1000, false, OPTS);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('user-gesture-required');
    // Quota untouched — the fresh window admitted nothing.
    expect(d.nextState.count).toBe(0);
  });

  it('a no-gesture loop never consumes quota (count stays 0 across many calls)', () => {
    let state: ThrottleState | undefined;
    for (let i = 0; i < 100; i++) {
      const d = decideRequestAccess(state, 1000 + i, false, OPTS);
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('user-gesture-required');
      state = d.nextState;
    }
    expect(state?.count).toBe(0);
  });

  it('ADMITS a gesture-backed call (count advances)', () => {
    const d = decideRequestAccess(undefined, 1000, true, OPTS);
    expect(d.allow).toBe(true);
    expect(d.reason).toBeUndefined();
    expect(d.nextState.count).toBe(1);
  });
});

describe('decideRequestAccess — per-origin rate limit (ii)', () => {
  it('rate-limits a RAPID gesture-backed burst after maxPerWindow', () => {
    let state: ThrottleState | undefined;
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const d = decideRequestAccess(state, 1000 + i, true, OPTS); // all within one window
      results.push(d.allow);
      state = d.nextState;
    }
    // First 3 admitted, then throttled.
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('surfaces a rate-limited reason + a retryAfterMs', () => {
    let state: ThrottleState | undefined;
    for (let i = 0; i < 3; i++) state = decideRequestAccess(state, 1000, true, OPTS).nextState;
    const d = decideRequestAccess(state, 1000, true, OPTS);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('rate-limited');
    // window started at 1000, windowMs 60_000, now 1000 → ~60_000ms remain.
    expect(d.retryAfterMs).toBe(60_000);
  });

  it('a LEGITIMATE spaced request still works once the window rolls', () => {
    let state: ThrottleState | undefined;
    // Exhaust the window at t≈1000.
    for (let i = 0; i < 3; i++) state = decideRequestAccess(state, 1000 + i, true, OPTS).nextState;
    // Still within the window → denied.
    expect(decideRequestAccess(state, 2000, true, OPTS).allow).toBe(false);
    // After the window fully elapses → a fresh window admits it again.
    const later = decideRequestAccess(state, 1000 + OPTS.windowMs, true, OPTS);
    expect(later.allow).toBe(true);
    expect(later.nextState.windowStart).toBe(1000 + OPTS.windowMs);
    expect(later.nextState.count).toBe(1);
  });

  it('a rate-limited deny does NOT further advance the count (no unbounded growth)', () => {
    let state: ThrottleState | undefined;
    for (let i = 0; i < 3; i++) state = decideRequestAccess(state, 1000, true, OPTS).nextState;
    expect(state?.count).toBe(3);
    const d = decideRequestAccess(state, 1000, true, OPTS);
    expect(d.nextState.count).toBe(3); // stays capped
  });

  it('treats a prior window whose start is in the FUTURE as stale (rolls it) — fail-safe clock skew', () => {
    const future: ThrottleState = { windowStart: 10_000, count: 3 };
    const d = decideRequestAccess(future, 1000, true, OPTS); // now < windowStart
    expect(d.allow).toBe(true);
    expect(d.nextState.windowStart).toBe(1000);
    expect(d.nextState.count).toBe(1);
  });
});

describe('decideRequestAccess — defaults', () => {
  it('uses DEFAULT_REQUEST_ACCESS_THROTTLE (3 / 60s) when no opts passed', () => {
    let state: ThrottleState | undefined;
    for (let i = 0; i < DEFAULT_REQUEST_ACCESS_THROTTLE.maxPerWindow; i++) {
      const d = decideRequestAccess(state, 1000, true);
      expect(d.allow).toBe(true);
      state = d.nextState;
    }
    expect(decideRequestAccess(state, 1000, true).allow).toBe(false);
  });
});
