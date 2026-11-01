// AUTHORED-BY Claude Opus 4.8
/**
 * PURE anti-spam gate for `window.solid.requestAccess` (access-management Phase 2, residual c).
 *
 * `requestAccess` opens the UNSPOOFABLE consent WINDOW (extension chrome). Without a throttle a
 * hostile — or merely buggy — origin can drive that window in a loop (`for(;;) requestAccess()`),
 * an annoyance/DoS on the owner. This module is the PURE decision behind two independent defences,
 * both fail-closed:
 *
 *   (i)  USER-GESTURE REQUIREMENT — a `requestAccess` must originate from a genuine transient user
 *        activation (a click / keypress), never an autonomous script loop. The activation is read
 *        in the ISOLATED content-script world (`navigator.userActivation.isActive`), which the page
 *        cannot forge, and stamped onto the worker message; THIS function only decides on that
 *        browser-attested boolean. A non-activated call is rejected and does NOT consume the
 *        rate-limit quota (the quota governs gesture-BACKED bursts; the gesture check alone already
 *        stops a no-gesture loop).
 *
 *   (ii) PER-ORIGIN RATE LIMIT — a fixed-window cap on how many prompts one origin may open in a
 *        window, so even a gesture-backed burst (many calls within one 5s activation window) is
 *        throttled. The origin key is the browser-attested requesting origin (unspoofable), so an
 *        origin cannot evade the limit by lying about who it is.
 *
 * NO `chrome.*` / storage / clock here — the caller supplies `now` and the prior per-origin state,
 * so the whole decision is exhaustively unit-testable. The service worker holds the per-origin
 * state in a module-level map (best-effort, MV3-appropriate: an SW restart resets it, which merely
 * refreshes the window — acceptable for an annoyance/DoS mitigation, never a security boundary).
 */

/** A distinguishable reason a `requestAccess` was throttled, surfaced to the page. */
export type RequestAccessDenyReason = 'user-gesture-required' | 'rate-limited';

/** Per-origin fixed-window state: the window's start and how many prompts it has admitted. */
export interface ThrottleState {
  readonly windowStart: number;
  readonly count: number;
}

/** The throttle bounds. */
export interface ThrottleOptions {
  /** The fixed-window length, ms. */
  readonly windowMs: number;
  /** The maximum admitted `requestAccess` prompts per origin per window. */
  readonly maxPerWindow: number;
}

/**
 * Default bounds: at most 3 consent prompts per origin per minute. A legitimate app rarely needs
 * more than one or two consent prompts in quick succession; a loop is far over this.
 */
export const DEFAULT_REQUEST_ACCESS_THROTTLE: ThrottleOptions = {
  windowMs: 60_000,
  maxPerWindow: 3,
};

/** The decision + the state the caller must persist for this origin. */
export interface ThrottleDecision {
  /** `true` ⇒ proceed to consent; `false` ⇒ reject with {@link reason}. */
  readonly allow: boolean;
  /** The deny reason when `allow` is false. */
  readonly reason?: RequestAccessDenyReason;
  /** For a rate-limited deny, how long until the window rolls (ms). */
  readonly retryAfterMs?: number;
  /** The state to store back for this origin (always returned, whether allowed or not). */
  readonly nextState: ThrottleState;
}

/**
 * Decide whether an origin's `requestAccess` may proceed at `now`, given its prior throttle state
 * and whether the call carried a genuine user activation. PURE + fail-closed.
 *
 * Order (both fail-closed):
 *   1. Roll the fixed window forward if the prior one has fully elapsed (or there is none).
 *   2. GESTURE FIRST — no user activation ⇒ deny `user-gesture-required`, quota UNCHANGED.
 *   3. RATE LIMIT — at/over `maxPerWindow` for the current window ⇒ deny `rate-limited`.
 *   4. Otherwise allow, incrementing the window's admitted count.
 */
export function decideRequestAccess(
  prior: ThrottleState | undefined,
  now: number,
  userActivated: boolean,
  opts: ThrottleOptions = DEFAULT_REQUEST_ACCESS_THROTTLE,
): ThrottleDecision {
  // (1) Roll the window if the prior one has elapsed (or there is none / it is in the future).
  const elapsed = prior ? now - prior.windowStart : Number.POSITIVE_INFINITY;
  const window: ThrottleState =
    prior && elapsed >= 0 && elapsed < opts.windowMs ? prior : { windowStart: now, count: 0 };

  // (2) Gesture requirement. Rejected WITHOUT consuming quota — a no-gesture loop is stopped here
  // regardless of the rate limit; the quota is reserved for gesture-backed bursts.
  if (!userActivated) {
    return { allow: false, reason: 'user-gesture-required', nextState: window };
  }

  // (3) Fixed-window rate limit on gesture-backed prompts.
  if (window.count >= opts.maxPerWindow) {
    return {
      allow: false,
      reason: 'rate-limited',
      retryAfterMs: Math.max(0, window.windowStart + opts.windowMs - now),
      nextState: window,
    };
  }

  // (4) Admit — advance the current window's count.
  return {
    allow: true,
    nextState: { windowStart: window.windowStart, count: window.count + 1 },
  };
}
