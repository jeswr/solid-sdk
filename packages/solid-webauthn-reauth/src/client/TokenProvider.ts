// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

import type * as oauth from "oauth4webapi";

/**
 * The minimal token-acquisition provider contract.
 *
 * This is byte-for-byte the public {@link TokenProvider} surface of the
 * published `@solid/reactive-authentication@0.1.x` (`dist/TokenProvider.d.ts`):
 * `matches` / `upgrade`, plus the optional `invalidate` that 0.1.x added for
 * stale-credential renewal. By implementing exactly this shape, the WebAuthn
 * provider drops into the apps' existing `TokenProvider[]` pipeline (the array
 * `ReactiveFetchManager` iterates) with **no change** to the published library —
 * ordering in the array controls precedence, first `matches` wins.
 *
 * It is re-declared here (rather than imported from
 * `@solid/reactive-authentication`) because that library is a *different
 * distribution* from the `reactive-authentication-js` fork this WebAuthn logic
 * grew up in: the fork exposes a `DPoPTokenProvider(exchange)` Strategy seam that
 * the published library does not. Declaring the interface keeps this package
 * dependency-light (no runtime dep on either reactive-auth distribution) while
 * staying structurally compatible with both.
 */
export interface TokenProvider {
  /** Whether this provider handles the given request's host/issuer. */
  matches(request: Request): Promise<boolean>;

  /**
   * Acquire credentials for `request` and return it upgraded with them
   * (`Authorization` + any sender-constraining proof headers).
   */
  upgrade(request: Request): Promise<Request>;

  /**
   * Optional: called when a request this provider upgraded was still rejected
   * with 401 — the attached credentials were revoked or invalidated early. The
   * provider should drop any cached state so the next {@link upgrade} renews.
   * WebAuthn re-auth is stateless per upgrade (a fresh ceremony + key every
   * time), so this is a no-op for the WebAuthn provider.
   */
  invalidate?(request: Request): Promise<void>;
}

/**
 * The context handed to a {@link TokenExchange} for a single 401-driven upgrade.
 *
 * The provider owns the DPoP mechanics (keypair, proof generation, nonce
 * tracking, resource binding); it generates the {@link oauth.DPoPHandle} and
 * passes it here so the exchange attaches DPoP proofs to its token request. The
 * exchange MUST NOT generate its own keypair — sender-constraint continuity (the
 * token-endpoint proof and the resource proof sharing one key, RFC 9449) is the
 * provider's responsibility.
 */
export interface TokenExchangeContext {
  /** The original request that triggered the 401 (target resource + signal). */
  readonly request: Request;

  /**
   * The shared DPoP handle to attach to token requests. The same handle is
   * reused by the provider to bind the upgraded resource request, so the
   * token-endpoint proof and the resource proof are signed by one key. The
   * handle also caches server-issued `DPoP-Nonce`s.
   */
  readonly dpop: oauth.DPoPHandle;
}

/**
 * The pluggable token-acquisition strategy for the WebAuthn provider.
 *
 * Performs *only* the token-acquisition step (discovery, the user ceremony, the
 * token request), returning the processed {@link oauth.TokenEndpointResponse}.
 * It does not touch DPoP keys or the upgraded request: that is the provider's
 * job. This is the one varying seam — the same Strategy interface the
 * `reactive-authentication-js` fork defines, kept so the exchange logic is
 * reused unchanged.
 */
export interface TokenExchange {
  matches(request: Request): Promise<boolean>;
  acquire(context: TokenExchangeContext): Promise<oauth.TokenEndpointResponse>;
}
