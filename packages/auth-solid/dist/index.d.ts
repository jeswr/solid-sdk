/**
 * `@jeswr/auth-solid` — a Solid-OIDC provider for Auth.js (next-auth v5 / `@auth/core`).
 *
 * Public API:
 *   - `Solid(config)` — the provider factory → an `OIDCConfig<SolidProfile>` for `NextAuth`.
 *   - `solidDpopFetch(state, opts?)` — a DPoP-attaching authed `fetch` for pod requests, from a
 *     persisted `SolidAuthState`.
 *   - `persistSolidTokensIntoJwt` / `extractSolidAuthState` — the `jwt`/`session` callback glue.
 *   - transport + DPoP-customFetch primitives (advanced) and the public types.
 *
 * Composes `@jeswr/solid-dpop` for RFC 9449 proofs (ES256, asymmetric-only) — no hand-rolled crypto
 * and no bespoke RDF/OAuth. See the README for wiring + the security tradeoffs.
 */
export { buildDpopCustomFetch, buildSolidDpopFetch as solidDpopFetch, DEFAULT_MAX_REPLAY_BODY_BYTES, DPOP_NONCE_RETRY_LIMIT, isLoopbackHost, type SolidDpopFetchOptions, } from "./dpopFetch.js";
export { DEFAULT_SCOPE, SOLID_CHECKS, Solid, type SolidProvider, } from "./provider.js";
export { type AccountLike, extractSolidAuthState, type PersistSolidTokensInput, persistSolidTokensIntoJwt, SOLID_JWT_KEY, type SolidJwtState, } from "./session.js";
export type { FetchLike, SolidAuthState, SolidProfile, SolidProviderConfig, } from "./types.js";
//# sourceMappingURL=index.d.ts.map