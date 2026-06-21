/**
 * The DPoP HTTP seam — the security-critical core of `@jeswr/auth-solid`.
 *
 * Auth.js / `@auth/core` does NOT itself perform DPoP: it builds a plain OAuth token request via
 * `oauth4webapi`. Solid-OIDC requires sender-constrained (DPoP-bound) tokens (RFC 9449). So this
 * module supplies BOTH places DPoP is needed, routing all proof generation through the suite's
 * vetted `@jeswr/solid-dpop` (jose-only, ES256 asymmetric) — we hand-roll no crypto:
 *
 *   1. {@link buildDpopCustomFetch} — the `[customFetch]` Auth.js calls for ALL OAuth endpoint
 *      HTTP (discovery, JWKS, token, userinfo). It DISCRIMINATES: it attaches a DPoP proof ONLY to
 *      the token-endpoint leg (a POST carrying a form-urlencoded grant body — the robust signal,
 *      since the token URL is only known after discovery). The token-endpoint proof carries NO
 *      `ath` (RFC 9449 §4.2 — `ath` is for requests that PRESENT an access token; the token request
 *      does not). It handles the §8 `use_dpop_nonce` retry exactly once. Discovery / JWKS /
 *      userinfo legs pass straight through untouched.
 *
 *   2. {@link buildSolidDpopFetch} (exported as `solidDpopFetch`) — a DPoP-attaching authed `fetch`
 *      for POD (resource-server) requests, built from a persisted {@link SolidAuthState}. Each
 *      request mints a proof bound to the access token via `ath` (RFC 9449 §4.2 / §6.1), sets
 *      `Authorization: DPoP <token>` + `DPoP: <proof>`, and handles the resource-server §8
 *      `DPoP-Nonce` (401) retry once.
 *
 * Transport guard (both paths): never attach a DPoP proof / access token to a plaintext `http:`
 * URL unless `allowInsecure` is set for a loopback host — so a token is never sent over the wire in
 * the clear. We never log tokens, proofs, keys, or request bodies.
 */
import { type DpopKeyPair } from "@jeswr/solid-dpop";
import type { FetchLike, SolidAuthState } from "./types.js";
/**
 * True iff `hostname` (as returned by `URL.hostname`) is a loopback host. Handles `localhost`, the
 * whole `127.0.0.0/8` IPv4 loopback range, and IPv6 `::1` — including Node's BRACKETED IPv6 form
 * (`URL.hostname` returns `[::1]`).
 */
export declare function isLoopbackHost(hostname: string): boolean;
/**
 * Assert a URL is https (or http-on-loopback only when `allowInsecure`). Throws via `makeError`.
 * This is the load-bearing guard that keeps the DPoP token/proof off a plaintext channel.
 */
export declare function assertSecureTransport(rawUrl: string, allowInsecure: boolean, makeError: (msg: string) => Error): void;
/**
 * Build the Auth.js `[customFetch]` that injects a DPoP proof on the token-endpoint leg only.
 *
 * @param keyPair       the DPoP keypair the tokens are (will be) bound to.
 * @param underlying    the base fetch Auth.js passes its requests to (the global `fetch`, or an
 *                      injected SSRF-guarded / test fetch).
 * @param allowInsecure permit http: on loopback (dev OP). Default false (https-only).
 */
export declare function buildDpopCustomFetch(keyPair: DpopKeyPair, underlying: FetchLike, allowInsecure: boolean): typeof fetch;
/** Options for {@link buildSolidDpopFetch}. */
export interface SolidDpopFetchOptions {
    /** The base fetch for the actual network call (global `fetch`, or an SSRF-guarded / test fetch). */
    readonly fetch?: FetchLike;
    /** Permit http: on loopback (dev pod). Default false (https-only). */
    readonly allowInsecure?: boolean;
}
/**
 * Build a DPoP-attaching authed `fetch` for POD (resource-server) requests, from a persisted
 * {@link SolidAuthState}. The returned `fetch`:
 *   - rebuilds the DPoP keypair from `state.dpopKeyJwk` (via `importDpopKeyPairJwk`),
 *   - mints a per-request proof bound to the access token via `ath` (RFC 9449 §4.2 / §6.1),
 *   - sets `Authorization: DPoP <accessToken>` + `DPoP: <proof>`,
 *   - retries ONCE on a resource-server §8 `DPoP-Nonce` (401) challenge.
 *
 * The keypair is rebuilt ONCE per returned fetch (an async import is awaited lazily on first use),
 * not per request. Transport-guarded: an `http:` resource URL is rejected unless `allowInsecure`
 * permits loopback — so the DPoP token is never sent over plaintext. Never logs the token/proof/key.
 */
export declare function buildSolidDpopFetch(state: SolidAuthState, options?: SolidDpopFetchOptions): FetchLike;
/** The §8 nonce-retry limit (exported for documentation / test assertion). */
export declare const DPOP_NONCE_RETRY_LIMIT = 1;
//# sourceMappingURL=dpopFetch.d.ts.map