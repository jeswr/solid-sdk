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
import type { OIDCConfig } from "@auth/core/providers";
import { type DpopKeyPair } from "@jeswr/solid-dpop";
import type { JWK } from "jose";
import type { SolidProfile, SolidProviderConfig } from "./types.js";
/** Default scopes. `webid` is Solid-OIDC's WebID scope; `offline_access` yields a refresh token. */
export declare const DEFAULT_SCOPE = "openid webid offline_access";
/** The mandatory Solid-OIDC checks: PKCE (S256), state (CSRF), nonce (ID-token binding). */
export declare const SOLID_CHECKS: readonly ["pkce", "state", "nonce"];
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
export declare function Solid(config: SolidProviderConfig): Promise<SolidProvider>;
//# sourceMappingURL=provider.d.ts.map