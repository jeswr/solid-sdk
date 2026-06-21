// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Session / JWT persistence helpers — the consumer-side glue that carries the Solid DPoP-bound
 * tokens + the DPoP private key through the Auth.js `jwt` / `session` callbacks, so that a later
 * pod request can be made with {@link import("./dpopFetch.js").buildSolidDpopFetch}.
 *
 * Auth.js does NOT let a provider set the consumer's `jwt`/`session` callbacks (those are
 * `NextAuth`-config-level). So this module gives the consumer small, typed helpers + the README
 * documents the exact callback snippets. The contract:
 *
 *   - On first sign-in, the `jwt` callback receives the `account` (the token set). It persists the
 *     Solid fields ({@link persistSolidTokensIntoJwt}) PLUS the DPoP private JWK
 *     (`provider.dpopKeyJwkForPersistence()`), keyed under {@link SOLID_JWT_KEY} on the JWT token.
 *   - The `session` callback copies the WebID (and optionally a flag that auth state is present)
 *     onto the session for the client.
 *   - A pod request rebuilds a {@link import("./types.js").SolidAuthState} from the JWT/session via
 *     {@link extractSolidAuthState} and passes it to `solidDpopFetch`.
 *
 * SECURITY: persisting a DPoP PRIVATE key + tokens into the JWT is a real tradeoff — use an
 * ENCRYPTED JWT session (Auth.js encrypts the JWT with `AUTH_SECRET` by default) or a database
 * session. This module never logs any secret. See the README for the full guidance.
 */

import type { JWK } from "jose";
import type { SolidAuthState } from "./types.js";

/** The key under which the Solid DPoP-bound auth state is stored on the Auth.js JWT token. */
export const SOLID_JWT_KEY = "solid" as const;

/** The persisted shape stored under {@link SOLID_JWT_KEY} on the JWT token. */
export interface SolidJwtState {
  /** The DPoP-bound access token. */
  readonly accessToken: string;
  /** The DPoP private key JWK (carries the public components) — the token's `jkt` binding. */
  readonly dpopKeyJwk: JWK;
  /** The refresh token, when granted (`offline_access`). */
  readonly refreshToken?: string;
  /** The ID token (JWS). */
  readonly idToken?: string;
  /** Absolute expiry (seconds since epoch), when known. */
  readonly expiresAt?: number;
  /** The authenticated WebID. */
  readonly webid?: string;
  /** The issuer (OP). */
  readonly issuer?: string;
}

/** The minimal Auth.js `account` shape we read (a subset of `@auth/core`'s `Account`). */
export interface AccountLike {
  readonly access_token?: string | undefined;
  readonly refresh_token?: string | undefined;
  readonly id_token?: string | undefined;
  readonly expires_at?: number | undefined;
  readonly token_type?: string | undefined;
  readonly scope?: string | undefined;
  readonly provider?: string | undefined;
}

/** Inputs to {@link persistSolidTokensIntoJwt}. */
export interface PersistSolidTokensInput {
  /** The Auth.js `account` from the first-sign-in `jwt` callback. */
  readonly account: AccountLike;
  /** The DPoP private key JWK — from `provider.dpopKeyJwkForPersistence()`. */
  readonly dpopKeyJwk: JWK;
  /** The verified WebID (e.g. from `user.webid` / `profile.webid`), when available. */
  readonly webid?: string | undefined;
  /** The issuer (OP), when available. */
  readonly issuer?: string | undefined;
}

/**
 * Build the {@link SolidJwtState} to store under {@link SOLID_JWT_KEY} on the JWT token, from the
 * first-sign-in `account` + the provider's DPoP private JWK. FAILS CLOSED if the account carries no
 * access token (a Solid session is meaningless without one).
 *
 * Use in the `jwt` callback:
 * ```ts
 * async jwt({ token, account, user }) {
 *   if (account) {
 *     token[SOLID_JWT_KEY] = persistSolidTokensIntoJwt({
 *       account,
 *       dpopKeyJwk: await provider.dpopKeyJwkForPersistence(),
 *       webid: (user as { webid?: string })?.webid,
 *     });
 *   }
 *   return token;
 * }
 * ```
 */
export function persistSolidTokensIntoJwt(input: PersistSolidTokensInput): SolidJwtState {
  const { account, dpopKeyJwk } = input;
  const accessToken = account.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: the Auth.js account carries no `access_token`; cannot build a " +
        "Solid auth state (fail-closed).",
    );
  }
  if (dpopKeyJwk === undefined || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    throw new Error("persistSolidTokensIntoJwt: `dpopKeyJwk` is required (the DPoP private key).");
  }
  if (typeof dpopKeyJwk.d !== "string" || dpopKeyJwk.d.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: `dpopKeyJwk` has no private component (`d`); a public-only JWK " +
        "cannot sign DPoP proofs after a restart (fail-closed).",
    );
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...(typeof account.refresh_token === "string" ? { refreshToken: account.refresh_token } : {}),
    ...(typeof account.id_token === "string" ? { idToken: account.id_token } : {}),
    ...(typeof account.expires_at === "number" ? { expiresAt: account.expires_at } : {}),
    ...(typeof input.webid === "string" ? { webid: input.webid } : {}),
    ...(typeof input.issuer === "string" ? { issuer: input.issuer } : {}),
  };
}

/**
 * Extract a {@link SolidAuthState} (what `solidDpopFetch` needs) from an Auth.js JWT token / session
 * object that carries a {@link SolidJwtState} under {@link SOLID_JWT_KEY}. Returns `undefined` when
 * no usable state is present (no access token / no DPoP key) — the caller treats that as "not
 * authenticated for pod access" rather than constructing a broken fetch.
 *
 * Accepts either the raw token/session OR the {@link SolidJwtState} directly (so it works whether
 * you stored it nested under `SOLID_JWT_KEY` or passed the sub-object).
 */
export function extractSolidAuthState(
  source: Record<string, unknown> | SolidJwtState | null | undefined,
): SolidAuthState | undefined {
  if (source === null || source === undefined || typeof source !== "object") {
    return undefined;
  }
  // Unwrap the nested `solid` key if present, else treat `source` as the state itself.
  const nested = (source as Record<string, unknown>)[SOLID_JWT_KEY];
  const state = (nested !== undefined ? nested : source) as Partial<SolidJwtState> | unknown;
  if (state === null || typeof state !== "object") {
    return undefined;
  }
  const s = state as Partial<SolidJwtState>;
  const accessToken = s.accessToken;
  const dpopKeyJwk = s.dpopKeyJwk;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return undefined;
  }
  if (dpopKeyJwk === undefined || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    return undefined;
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...(typeof s.issuer === "string" ? { issuer: s.issuer } : {}),
    ...(typeof s.webid === "string" ? { webid: s.webid } : {}),
  };
}
