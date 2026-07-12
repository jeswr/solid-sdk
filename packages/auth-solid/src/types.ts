// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Public types for `@jeswr/auth-solid` — a Solid-OIDC provider for Auth.js (next-auth v5 /
 * `@auth/core`).
 *
 * The package returns an `OIDCConfig<SolidProfile>` from {@link SolidProviderConfig}, injecting an
 * RFC 9449 DPoP proof on the token endpoint via the Auth.js `customFetch` seam (composing
 * `@jeswr/solid-dpop` for the proof primitives). It also exports {@link SolidAuthState} +
 * `solidDpopFetch` for authed pod requests from a persisted session. See `provider.ts`,
 * `dpopFetch.ts` and the README for usage.
 */

import type { JWK } from "jose";

/** A DOM-compatible `fetch`. The authed `fetch` this package returns has this signature. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * The Auth.js `User`-shaped profile our `profile` callback maps a Solid login to. `id` is the
 * (verified) WebID — Auth.js's primary key — and we additionally surface `webid` explicitly so a
 * consumer's `session` callback can copy it onto the session without re-deriving it from `id`.
 */
export interface SolidProfile {
  /** The authenticated user's WebID — Auth.js's user `id`. Read fail-closed from the ID token. */
  readonly id: string;
  /** The same verified WebID, surfaced explicitly for the consumer's session callback. */
  readonly webid: string;
  /** The OIDC `sub` claim, when present (informational; the WebID is the identity). */
  readonly sub?: string;
  /** The issuer (OP) the user authenticated against, when present. */
  readonly iss?: string;
  /** `name`, when the OP advertised one (rare for Solid; the WebID profile is the real source). */
  readonly name?: string;
}

/**
 * The minimal Solid-auth state a consumer persists into the Auth.js JWT / session (or a database
 * session row) so that {@link buildSolidDpopFetch} can later mint DPoP-bound pod requests.
 *
 * SECURITY — every field here is a SECRET:
 *   - `accessToken` is a DPoP-bound (sender-constrained) access token.
 *   - `dpopKeyJwk` is the DPoP PRIVATE key (a JWK with the `d` component). It MUST be persisted so
 *     the SAME key (== the token's `jkt`) is used for every request and for refresh — the
 *     refresh-token `jkt` binding requires it. Persisting a private key into the session is a real
 *     tradeoff (see the README): use an ENCRYPTED JWT session (Auth.js encrypts the JWT with
 *     `AUTH_SECRET` by default) or a database session. This package never logs any of these.
 */
export interface SolidAuthState {
  /** The DPoP-bound access token (`token_type: "DPoP"`). */
  readonly accessToken: string;
  /** The DPoP PRIVATE key JWK (carries the public components) — the `jkt` the token is bound to. */
  readonly dpopKeyJwk: JWK;
  /** The issuer (OP) the token was obtained from, when known (informational). */
  readonly issuer?: string;
  /** The authenticated WebID, when known (informational). */
  readonly webid?: string;
}

/**
 * Options for the {@link import("./provider.js").Solid} provider factory.
 *
 * `issuer` + `clientId` are required. A PUBLIC Solid client (a Client Identifier Document) has NO
 * secret — omit `clientSecret`. A confidential / statically-registered client supplies one.
 */
export interface SolidProviderConfig {
  /** The Solid-OIDC issuer (OP) URL. Auth.js discovers `<issuer>/.well-known/openid-configuration`. */
  readonly issuer: string;
  /**
   * The client identifier. The PRIMARY Solid path is a Client Identifier Document URL (an `https:`
   * URL serving the client-id JSON-LD doc) — a public client with no secret. An opaque
   * statically-registered client id also works (pair it with `clientSecret`).
   */
  readonly clientId: string;
  /**
   * The client secret, for a CONFIDENTIAL client. OMIT for a public client (Client Identifier
   * Document) — Solid public clients have no secret. When omitted, the provider is configured as a
   * public client (`client_secret_post` is not used).
   */
  readonly clientSecret?: string;
  /**
   * Scopes to request. Defaults to `"openid webid offline_access"` (Solid-OIDC needs `webid`;
   * `offline_access` yields a refresh token). `openid` is forced on if a custom value omits it.
   */
  readonly scope?: string;
  /**
   * An existing DPoP keypair PRIVATE JWK to bind tokens to (e.g. restored so the refresh-token
   * `jkt` survives a restart). If omitted, a fresh ES256 keypair is generated per provider
   * instance. Asymmetric-only (ES256) — enforced by `@jeswr/solid-dpop`. (For most Auth.js apps you
   * persist the key via the documented `jwt` callback instead; this option is for advanced reuse.)
   */
  readonly dpopKeyJwk?: JWK;
  /**
   * Allow `http:` (non-TLS) issuer/endpoint URLs. OFF by default (Solid-OIDC requires TLS). Only
   * enable for a local-dev OP on loopback. When false, the DPoP `customFetch` rejects any `http:`
   * URL it is asked to hit (so a DPoP proof / token is never sent over plaintext).
   */
  readonly allowInsecure?: boolean;
  /** Override the provider `id` (default `"solid"`). */
  readonly id?: string;
  /** Override the provider display `name` (default `"Solid"`). */
  readonly name?: string;
}
