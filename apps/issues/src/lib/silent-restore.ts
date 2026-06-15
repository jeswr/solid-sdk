// AUTHORED-BY Claude Opus 4.8
/**
 * silent-restore.ts — the PURE decision logic for restoring a Solid session on
 * app reopen WITHOUT a redirect or popup (pss-203m): given what we persisted
 * about the last session, should we attempt a refresh-grant restore, and is a
 * given failure a "fall back to the login screen" failure or a transient one?
 *
 * Mechanism (wired in session-context + webid-token-provider): on a successful
 * login the IdP issues a REFRESH TOKEN (we request `offline_access`); we persist
 * it — with the issuer, client registration and the DPoP key — in IndexedDB,
 * scoped to the WebID, never localStorage (it is a bearer-of-possession secret),
 * cleared on logout. On mount, while status is "initialising", if a stored
 * session exists we run a refresh-grant token request (refresh-token → fresh
 * DPoP-bound access token; no redirect, no iframe, no popup) and land the user
 * straight on their page. Only a GENUINE failure (no token / expired / revoked)
 * drops to the login screen.
 *
 * The decision is separated out so it can be exhaustively unit-tested without a
 * browser, an IdP, or IndexedDB — the security-critical "when do we silently log
 * someone back in vs. force a fresh login" rule lives here, in one place.
 */

/** What we persist about a restorable session (minus the crypto key handle). */
export interface PersistedSessionMeta {
  /** The WebID the session belongs to (the store is keyed by this). */
  webId: string;
  /** The OIDC issuer that minted the tokens. */
  issuer: string;
  /** The pod storage root chosen for the session. */
  storageUrl: string;
  /** Whether a refresh token was actually stored (no token ⇒ nothing to restore). */
  hasRefreshToken: boolean;
  /**
   * Optional absolute expiry (epoch ms) of the refresh token, when the IdP
   * advertises one. Absent ⇒ unknown lifetime; we still attempt restore (the
   * grant call is the real authority — it rejects an expired/revoked token).
   */
  refreshExpiresAt?: number;
}

/** Why a silent restore did not produce a logged-in session. */
export type RestoreOutcome =
  /** A fresh session was obtained — go straight to logged-in. */
  | { kind: "restored" }
  /** Nothing to restore (no stored session / no refresh token). */
  | { kind: "no-session" }
  /** The stored token is gone for good (expired/revoked/invalid) — fresh login. */
  | { kind: "expired" }
  /** A transient failure (offline, IdP unreachable) — fresh login, but retryable. */
  | { kind: "transient" };

/**
 * Should we even attempt a silent refresh-grant restore? Only when there is a
 * stored session WITH a refresh token, and (if a refresh expiry is known) it has
 * not already passed. A small `skewMs` guards against treating a token as live
 * when it is about to expire within the clock skew window.
 */
export function shouldAttemptRestore(
  meta: PersistedSessionMeta | null,
  now: number = Date.now(),
  skewMs = 30_000,
): boolean {
  if (!meta || !meta.hasRefreshToken || !meta.webId || !meta.issuer) return false;
  if (meta.refreshExpiresAt !== undefined && meta.refreshExpiresAt - skewMs <= now) return false;
  return true;
}

/**
 * Classify a refresh-grant error into the restore outcome. An OAuth
 * `invalid_grant` (the spec error for an expired/revoked/used refresh token)
 * means the credential is dead → force a fresh login. A network/availability
 * failure is transient → also fall back to login, but the stored token is kept
 * so a later reopen can retry. Anything else is treated as expired (fail safe:
 * never silently trust an unclassifiable credential).
 */
export function classifyRestoreError(error: unknown): RestoreOutcome {
  const oauthError = extractOAuthError(error);
  if (oauthError === "invalid_grant" || oauthError === "invalid_token") return { kind: "expired" };
  if (isNetworkError(error)) return { kind: "transient" };
  return { kind: "expired" };
}

/** Whether a transient outcome should clear the stored credential. Transient ⇒ keep it. */
export function shouldClearStoredSession(outcome: RestoreOutcome): boolean {
  return outcome.kind === "expired";
}

/** Pull an OAuth `error` code out of an oauth4webapi error shape, if present. */
function extractOAuthError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { error?: unknown; cause?: { error?: unknown } };
  if (typeof e.error === "string") return e.error;
  if (e.cause && typeof e.cause === "object" && typeof (e.cause as { error?: unknown }).error === "string") {
    return (e.cause as { error: string }).error;
  }
  return undefined;
}

/** A fetch/availability failure (offline, DNS, TLS) rather than an auth rejection. */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch() network failure is a TypeError
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === "TypeError" || name === "AbortError") return true;
  }
  return false;
}
