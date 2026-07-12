// AUTHORED-BY Claude Opus 4.8
/**
 * The post-sign-out warning state, modelled as a pair of FULLY INDEPENDENT concerns
 * so resolving (or dismissing) one can NEVER hide the other. Extracted as pure
 * functions so the "clear one, keep the other" logic is unit-testable without the
 * client-only `SessionProvider` (which drives heavy dynamic imports).
 *
 *  - **purgeWarning** — the local WebID-scoped health cache may not have been fully
 *    cleared. Dismissible; retryable via a "Clear local data" purge retry. A
 *    successful retry clears ONLY this warning.
 *  - **revokeWarning** — the credential could NOT be revoked, so the session may STILL
 *    BE LIVE / silently restorable on this device. This is a SECURITY state: it is
 *    NOT dismissible and NOT cleared by the purge retry. It clears ONLY when the
 *    revocation is retried and succeeds, or on a fresh successful session (re)activation.
 */
import type { LogoutOutcome } from "./logout";

export interface LogoutWarnings {
  /** Local health data may remain on this device; `null` when the purge was clean. */
  purgeWarning: string | null;
  /** Credentials not revoked — you may still be signed in; `null` when revoke was clean. */
  revokeWarning: string | null;
}

export const NO_WARNINGS: LogoutWarnings = { purgeWarning: null, revokeWarning: null };

/** The default purge-failure copy (health data may remain locally). */
export const PURGE_WARNING =
  "Local health data may not have been fully cleared from this device. Clear it before someone else uses this device.";

/** The default revoke-failure copy (session may still be live — a security state). */
export const REVOKE_WARNING =
  "Sign-out may be incomplete — your credentials could not be revoked, so you may still be signed in on this device. Sign out again, or reload the page.";

/** Derive the two independent warnings from a {@link LogoutOutcome}. */
export function warningsFromOutcome(outcome: LogoutOutcome): LogoutWarnings {
  return {
    purgeWarning: outcome.purgeFailed ? PURGE_WARNING : null,
    revokeWarning: outcome.revokeFailed ? REVOKE_WARNING : null,
  };
}

/** After a purge retry SUCCEEDS (or a dismiss) — clears ONLY the purge warning. */
export function clearPurgeWarning(w: LogoutWarnings): LogoutWarnings {
  return w.purgeWarning === null ? w : { ...w, purgeWarning: null };
}

/** After a purge retry FAILS — updates ONLY the purge warning text; revoke untouched. */
export function withPurgeWarning(w: LogoutWarnings, message: string): LogoutWarnings {
  return { ...w, purgeWarning: message };
}

/** After a revoke retry SUCCEEDS / a fresh reactivation — clears ONLY the revoke warning. */
export function clearRevokeWarning(w: LogoutWarnings): LogoutWarnings {
  return w.revokeWarning === null ? w : { ...w, revokeWarning: null };
}
