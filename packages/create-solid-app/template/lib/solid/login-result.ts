// login-result.ts — the pure success criterion for the interactive login probe.
//
// This is deliberately a TINY, dependency-free module so the rule "what counts as
// a successful login" is testable in isolation (no browser, no oauth stack) and
// cannot be quietly weakened.
//
// THE RULE (and the bug it fixes):
//   The login flow probes a resource and lets @solid/reactive-authentication
//   upgrade a 401 with a DPoP token, then RETRIES. A naive "any 2xx => logged in"
//   check is WRONG: probing a PUBLIC resource (a public storage root, or the `/`
//   fallback) returns 200 with NO token attached and NO auth flow having run — yet
//   would mark the user authenticated. Conversely a final 401/403 means the popup
//   was cancelled or the minted token was rejected — also not a session.
//
//   A genuine login therefore requires BOTH:
//     1. the token provider actually minted + attached a token (an auth flow ran
//        to completion — `tokenAttached`), AND
//     2. the probe's final response was 2xx (the attached token was ACCEPTED).
//   A 2xx with no token attached is a public read, not a login.

export interface LoginProbeOutcome {
  /** The final HTTP status of the probe (after any reactive-auth popup→retry). */
  status: number;
  /**
   * Whether the token provider minted AND attached a DPoP/bearer token during
   * the probe — i.e. an auth flow actually completed. False for a public 200
   * the manager never needed to upgrade.
   */
  tokenAttached: boolean;
}

export type LoginAssessment =
  | { ok: true }
  | { ok: false; reason: "public-no-token" | "rejected" | "error"; message: string };

/** True for HTTP 2xx. */
function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Decide whether a login probe proves an authenticated session. Pure — no I/O.
 *
 * - 2xx + token attached  → logged in.
 * - 2xx + NO token        → PUBLIC resource, no flow ran → NOT logged in.
 * - 401/403               → token absent/rejected (cancelled popup or refused) → NOT logged in.
 * - any other non-2xx     → probe error → NOT logged in.
 */
export function assessLoginProbe(outcome: LoginProbeOutcome): LoginAssessment {
  const { status, tokenAttached } = outcome;
  if (is2xx(status)) {
    if (tokenAttached) return { ok: true };
    return {
      ok: false,
      reason: "public-no-token",
      message:
        "Login did not complete — the probed resource is public, so no token was " +
        "attached and no authentication actually happened. Try a resource that " +
        "requires login, or check your WebID's storage is private.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "rejected",
      message:
        "Login did not complete — no valid token was accepted (the popup may have " +
        "been cancelled, or the identity provider rejected the login).",
    };
  }
  return { ok: false, reason: "error", message: `Login probe failed: ${status}` };
}
