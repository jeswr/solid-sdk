// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The Solid-OIDC provider for Auth.js — `Solid(config)` returns an `OIDCConfig<SolidProfile>` you
 * drop into `NextAuth({ providers: [Solid({ issuer, clientId })] })`.
 *
 * What it adds on top of Auth.js's generic OIDC flow (the Solid-specific seams):
 *   - `checks: ["pkce", "state", "nonce"]` — PKCE S256 + state + nonce are ALL mandatory for
 *     Solid-OIDC. Auth.js generates + validates them; we assert they are set (the security floor).
 *   - scope `"openid webid offline_access"` — the `webid` scope + a refresh token.
 *   - `[customFetch]` — a DPoP-injecting fetch (see dpopFetch.ts), because `@auth/core` does NOT do
 *     DPoP itself and Solid-OIDC requires sender-constrained tokens (RFC 9449). Composes
 *     `@jeswr/solid-dpop` (ES256, asymmetric-only) for the proofs.
 *   - `profile` — maps the VERIFIED `webid` claim → the Auth.js user, FAIL-CLOSED (a login with no
 *     `webid` throws; the WebID is read from the ID-token-derived claims, never an unverified
 *     access token).
 *   - `account` — keeps the token fields a Solid session needs (`access_token`, `refresh_token`,
 *     `id_token`, `expires_at`, `token_type`) surviving Auth.js's account-shaping.
 *
 * Token / DPoP-key PERSISTENCE is consumer-side (Auth.js `jwt`/`session` callbacks) — see the
 * README snippets + {@link extractSolidAuthState}. The DPoP keypair is generated per provider
 * instance (or restored via `config.dpopKeyJwk`); its private JWK is exposed via
 * {@link dpopKeyJwkForPersistence} so the documented `jwt` callback can persist it (the
 * refresh-token `jkt` binding requires the SAME key after a restart).
 *
 * Security posture (this is an AUTH package — non-negotiable):
 *   - PKCE S256 + state + nonce ALWAYS (asserted on the returned config).
 *   - DPoP asymmetric-only (ES256) via `@jeswr/solid-dpop` — a symmetric/`none` alg is never used.
 *   - `webid` read fail-closed from the VERIFIED ID token; no session without a resolvable WebID.
 *   - https issuer/endpoints unless `allowInsecure` (the DPoP customFetch enforces transport).
 *   - No token / proof / key is ever logged.
 */

import { customFetch } from "@auth/core";
import type { OIDCConfig } from "@auth/core/providers";
import {
  type DpopKeyPair,
  exportDpopKeyPairJwk,
  generateDpopKeyPair,
  importDpopKeyPairJwk,
} from "@jeswr/solid-dpop";
import type { JWK } from "jose";
import { assertSecureTransport, buildDpopCustomFetch } from "./dpopFetch.js";
import type { FetchLike, SolidProfile, SolidProviderConfig } from "./types.js";

/** Default scopes. `webid` is Solid-OIDC's WebID scope; `offline_access` yields a refresh token. */
export const DEFAULT_SCOPE = "openid webid offline_access";

/** The mandatory Solid-OIDC checks: PKCE (S256), state (CSRF), nonce (ID-token binding). */
export const SOLID_CHECKS = ["pkce", "state", "nonce"] as const;

/**
 * Force `openid` into a scope string (OIDC requires it) and de-duplicate, preserving order. An
 * empty / whitespace input falls back to {@link DEFAULT_SCOPE}.
 */
function normalizeScope(scope: string | undefined): string {
  if (scope === undefined || scope.trim() === "") {
    return DEFAULT_SCOPE;
  }
  const parts = scope.split(/\s+/).filter((s) => s.length > 0);
  if (!parts.includes("openid")) {
    parts.unshift("openid");
  }
  return [...new Set(parts)].join(" ");
}

/** True iff `value` parses as an http(s) URL. WebIDs MUST be dereferenceable http(s) IRIs. */
function isHttpUri(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Read the `webid` — Solid-OIDC's WebID — from the VERIFIED ID-token claims Auth.js passes to the
 * `profile` callback, FAIL-CLOSED.
 *
 * SECURITY: Auth.js calls `profile(profile, tokens)` with `profile` = the VERIFIED ID-token claims
 * (oauth4webapi has already validated the ID token's signature against the OP JWKS + `iss` / `aud`
 * / `nonce`). We read the WebID ONLY from these verified claims — primary the `webid` claim, then a
 * `sub` that is itself an http(s) WebID. We do NOT trust any `webid` from the access token (a client
 * does not verify the access token's signature — that is the resource server's job). If no verified
 * http(s) WebID is present we THROW: a session is never created without one.
 */
function extractVerifiedWebId(claims: Record<string, unknown>): string {
  const webidClaim = claims.webid;
  if (typeof webidClaim === "string" && isHttpUri(webidClaim)) {
    return webidClaim;
  }
  const sub = claims.sub;
  if (typeof sub === "string" && isHttpUri(sub)) {
    return sub;
  }
  throw new Error(
    "auth-solid: the Solid login produced no resolvable `webid` claim in the VERIFIED ID token; " +
      "refusing to create a session without a verified WebID (fail-closed). The WebID is never " +
      "trusted from an unverified access token.",
  );
}

/**
 * The provider config returned by {@link Solid}, plus the package-specific extras a consumer needs
 * to wire persistence: the DPoP keypair (so the `jwt` callback can persist its private JWK) and the
 * resolved scope/checks. The Auth.js fields are the `OIDCConfig` surface; the extras are namespaced
 * under non-enumerable-friendly own properties Auth.js ignores.
 */
export interface SolidProvider extends OIDCConfig<SolidProfile> {
  /**
   * The DPoP keypair this provider instance binds tokens to. Persist its PRIVATE JWK (via
   * {@link dpopKeyJwkForPersistence}) in your `jwt` callback so the SAME key is used after a restart
   * (the refresh-token `jkt` binding requires it).
   */
  readonly dpopKeyPair: DpopKeyPair;
  /** The resolved DPoP private JWK for persistence (== `exportDpopKeyPairJwk(dpopKeyPair)`). */
  dpopKeyJwkForPersistence(): Promise<JWK>;
}

/**
 * Create the Solid-OIDC Auth.js provider.
 *
 * NOTE — async: the provider must prepare a DPoP keypair (ES256, via `@jeswr/solid-dpop`) before
 * the `customFetch` can sign the token request, so `Solid(...)` returns a `Promise`. Await it in
 * your Auth.js config (the providers array accepts the resolved object). Pass `config.dpopKeyJwk`
 * to reuse a restored keypair.
 *
 * @example
 * ```ts
 * const providers = [await Solid({ issuer: "https://op.example", clientId: "https://app.example/id" })];
 * export const { handlers, auth } = NextAuth({ providers });
 * ```
 */
export async function Solid(config: SolidProviderConfig): Promise<SolidProvider> {
  if (typeof config.issuer !== "string" || config.issuer.length === 0) {
    throw new Error("Solid(): `issuer` is required (the Solid OP URL).");
  }
  if (typeof config.clientId !== "string" || config.clientId.length === 0) {
    throw new Error("Solid(): `clientId` is required.");
  }
  const allowInsecure = config.allowInsecure === true;
  // SECURITY: reject an insecure issuer up front (the DPoP customFetch also guards each leg).
  assertSecureTransport(config.issuer, allowInsecure, (msg) => new Error(`Solid(): issuer ${msg}`));

  const scope = normalizeScope(config.scope);

  // DPoP keypair: restore a supplied one or generate a fresh ES256 one. `@jeswr/solid-dpop` owns
  // the algorithm (ES256, asymmetric-only) + extractable + thumbprint policy — a symmetric / `none`
  // alg is never reachable from here.
  const dpopKeyPair: DpopKeyPair = config.dpopKeyJwk
    ? await importDpopKeyPairJwk(config.dpopKeyJwk)
    : await generateDpopKeyPair();

  // The base fetch Auth.js will route discovery / token / userinfo through. The DPoP customFetch
  // wraps it, injecting a proof ONLY on the token-endpoint leg.
  const underlying: FetchLike = globalThis.fetch as FetchLike;
  const dpopFetch = buildDpopCustomFetch(dpopKeyPair, underlying, allowInsecure);

  const hasSecret = typeof config.clientSecret === "string" && config.clientSecret.length > 0;

  const provider: SolidProvider = {
    id: config.id ?? "solid",
    name: config.name ?? "Solid",
    type: "oidc",
    issuer: config.issuer,
    clientId: config.clientId,
    // A public client (Client Identifier Document) has no secret; only set it for a confidential
    // client. Auth.js treats a missing secret as a public client (token_endpoint_auth_method none).
    ...(hasSecret ? { clientSecret: config.clientSecret } : {}),
    // PKCE S256 + state + nonce — ALL mandatory for Solid-OIDC.
    checks: [...SOLID_CHECKS],
    authorization: { params: { scope } },
    // Keep the token fields a Solid session needs. We return ONLY these (plus the defaults Auth.js
    // keeps), so an OP's extra token-response fields are not silently persisted into the account.
    // Fields are included only when present (exactOptionalPropertyTypes: a `TokenSet` property is
    // either a value or absent, never an explicit `undefined`).
    account(account) {
      // Build the kept subset by deleting every field NOT on the allow-list from a shallow copy of
      // the (correctly-typed) incoming TokenSet — this preserves the `TokenSet` return type while
      // ensuring an OP's extra token-response fields are not persisted into the account.
      const kept = new Set([
        "access_token",
        "refresh_token",
        "id_token",
        "expires_at",
        "token_type",
        "scope",
      ]);
      const out = { ...account };
      for (const key of Object.keys(out)) {
        if (!kept.has(key)) {
          delete (out as Record<string, unknown>)[key];
        }
      }
      return out;
    },
    // Map the VERIFIED `webid` claim → the Auth.js user (fail-closed). `claims` is the verified
    // ID-token claim set Auth.js passes here.
    profile(claims) {
      const record = claims as unknown as Record<string, unknown>;
      const webid = extractVerifiedWebId(record);
      const sub = record.sub;
      const iss = record.iss;
      const name = record.name;
      return {
        id: webid,
        webid,
        ...(typeof sub === "string" ? { sub } : {}),
        ...(typeof iss === "string" ? { iss } : {}),
        ...(typeof name === "string" ? { name } : {}),
      } satisfies SolidProfile;
    },
    [customFetch]: dpopFetch,
    dpopKeyPair,
    dpopKeyJwkForPersistence: () => exportDpopKeyPairJwk(dpopKeyPair),
  };

  return provider;
}
