// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-restore.ts — the PURE, testable decision at the heart of "reopening a
// closed tab restores the session instead of bouncing to the login screen".
//
// Ported from solid-pod-manager's proven `session-restore.ts`. Pod Mail held
// tokens in MEMORY ONLY, so a fresh page load has NO live session — but a
// returning user who merely closed the tab (did NOT log out) still has their
// DPoP-bound refresh token + non-extractable key persisted in IndexedDB (see
// {@link ./session-persistence.ts}). On mount the app must try a SILENT restore
// from that credential — a `refresh_token` grant, which is a plain token-endpoint
// FETCH, never a popup/iframe — BEFORE it ever decides "logged out" and shows the
// login screen.
//
// This module isolates the *decision* (a pure async function over injected
// collaborators) from the React wiring in `SessionProvider.tsx`, so the
// security-sensitive branch table is unit-testable without a browser (matching
// how single-flight.ts / autologin-plan.ts / login-result.ts factor out their
// rules — this host has no DOM/React test env):
//
//   • no remembered active account            → LOGIN (nothing to restore)
//   • active account, but no remembered issuer → LOGIN (a refresh grant is
//     per-issuer; without the issuer there is nothing to attempt silently)
//   • active account, refresh grant succeeds   → RESTORED (logged in, no popup)
//   • active account, refresh grant fails       → LOGIN (token expired/revoked)
//     (expired/revoked is reported by the token provider as `undefined`; it has
//      already cleared the dead persisted entry — see restoreIssuer)
//
// The decision is driven off the REFRESH-GRANT outcome, NOT off a public-profile
// fetch: a returning user with a valid restored token is logged in even if the
// (cosmetic) profile read later fails — the profile is loaded separately and is
// allowed to degrade. This is the cross-app invariant: reopening must not bounce
// a fully-restored user to the login screen on a transient profile blip.
//
// PRECEDENCE: silent restore is the NO-FRAGMENT returning-user path. A Pod-Manager
// `#autologin/<webid>` deep-link still takes precedence (it is an explicit
// cross-app hand-off); the SessionProvider only runs silent restore when there is
// no autologin fragment / pending redirect, and the autologin plan in turn
// short-circuits to `none` once a session is already logged in.

/** Where the mount-time restore decision lands. */
export type SessionRestoreDecision =
  | {
      /** A live session was restored silently — render the app, no login UI. */
      readonly outcome: "restored";
      /** The authenticated WebID (from the restored session). */
      readonly webId: string;
      /** The issuer whose refresh-token session was restored. */
      readonly issuer: string;
    }
  | {
      /** No usable persisted session — the login screen must be shown. */
      readonly outcome: "login";
    };

/** The remembered-account shape this decision needs. */
export interface RememberedAccount {
  readonly webId: string;
  readonly issuer?: string;
}

/**
 * Attempt a silent refresh-token restore for a known issuer. Resolves to the
 * authenticated WebID on success, or `undefined` when there is nothing to
 * restore OR the persisted refresh token is dead (expired / revoked) — in which
 * case the implementation has already cleared the dead entry. MUST NOT open a
 * popup/iframe (it is a token-endpoint fetch only) and MUST NOT throw for the
 * "no/expired token" case — that is the normal `undefined` path.
 *
 * Production wires {@link WebIdDPoPTokenProvider.restoreIssuer} (via a string→URL
 * adapter in the SessionProvider).
 */
export type RestoreIssuer = (issuer: string) => Promise<{ webId: string } | undefined>;

/** Inputs to {@link decideSilentRestore} — all injected so it is pure + testable. */
export interface SilentRestoreInputs {
  /** The last active WebID (`null`/`undefined` when the user never signed in here). */
  readonly lastActiveWebId: string | null | undefined;
  /** The remembered accounts (to map the active WebID → its chosen issuer). */
  readonly remembered: readonly RememberedAccount[];
  /** The silent refresh-grant restore (see {@link RestoreIssuer}). */
  readonly restoreIssuer: RestoreIssuer;
  /**
   * The WebID identity comparison the rest of the auth seam uses
   * ({@link webIdsEqual}). Injected (like the other pure auth deciders take it) so
   * this module stays free of the provider import and matching the last-active
   * WebID to its remembered account uses the EXACT equality the caller uses — a
   * trivial host/scheme-case difference between the stored "active" WebID and the
   * remembered record must not silently lose the issuer mapping.
   */
  readonly webIdsEqual: (a: string | undefined, b: string | undefined) => boolean;
}

/**
 * Decide, on a fresh page load, whether a returning user's session can be
 * restored SILENTLY (no popup/iframe, no login screen) from their persisted
 * DPoP-bound refresh token, or whether the login screen must be shown.
 *
 * Pure except for the injected {@link RestoreIssuer} (the one fetch). Never
 * throws: a thrown `restoreIssuer` (an unexpected error, not the normal
 * expired/revoked `undefined`) is treated as "could not restore" → LOGIN, which
 * is the safe, fail-closed default (we never assert a session we could not
 * actually rebuild).
 *
 * WebID-SCOPED ISOLATION (security): the issuer used for the refresh grant is the
 * one remembered FOR THE LAST-ACTIVE WEBID. Account A's last-active WebID resolves
 * to A's issuer (and A's persisted refresh token under that issuer); it can never
 * restore account B's session — B's token lives under B's issuer key, which this
 * decision never reaches for an A-active load.
 *
 * On `restored` the caller has, in-memory, a live session whose issuer is pinned
 * in the token provider, so a later private read upgrades without prompting; the
 * caller still loads the (cosmetic) profile separately and may let it degrade.
 */
export async function decideSilentRestore(
  inputs: SilentRestoreInputs,
): Promise<SessionRestoreDecision> {
  const { lastActiveWebId, remembered, restoreIssuer, webIdsEqual } = inputs;

  // No prior active account on this device → nothing to restore; show login.
  if (!lastActiveWebId) return { outcome: "login" };

  // The issuer the user chose for this account, remembered at login. Without it
  // we cannot run a refresh-token grant (the grant is per-issuer), so there is
  // no silent restore to attempt — fall through to LOGIN (an explicit click there
  // re-pins the issuer). Match the active WebID to its remembered record with the
  // SAME equality the rest of the seam uses, so a trivial case/normalisation
  // difference does not silently lose the issuer.
  const issuer = remembered.find((a) => webIdsEqual(a.webId, lastActiveWebId))?.issuer;
  if (!issuer) return { outcome: "login" };

  let restored: { webId: string } | undefined;
  try {
    restored = await restoreIssuer(issuer);
  } catch {
    // An UNEXPECTED restore error (not the normal expired/revoked `undefined`):
    // fail closed to LOGIN. We never claim a session we could not rebuild.
    return { outcome: "login" };
  }

  // Expired / revoked / no persisted token: restoreIssuer returns undefined and
  // has already cleared the dead entry → show login (the credential is gone).
  if (restored === undefined) return { outcome: "login" };

  // SECURITY — confirm the restored session authenticated AS the last-active
  // WebID. The refresh grant mints a token for whatever the persisted record's
  // WebID is; if (through a corrupted/misfiled store) that disagrees with the
  // last-active WebID we asked to restore, FAIL CLOSED to login rather than
  // silently logging the user in as someone else. webIdsEqual fails closed for a
  // missing/unparseable side.
  if (!webIdsEqual(restored.webId, lastActiveWebId)) return { outcome: "login" };

  // Live session rebuilt silently (refresh grant only): render the app.
  return { outcome: "restored", webId: restored.webId, issuer };
}
