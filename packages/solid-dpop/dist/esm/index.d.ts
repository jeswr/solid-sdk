/**
 * @jeswr/solid-dpop — canonical Solid-OIDC client-credentials session + RFC 9449 DPoP proof
 * primitives, shared by the W6.5 integration prototypes (dpop-bridge, solid-sync, solid-mcp,
 * n8n-solid, wix-solid, slack-solid). PRIVATE / UNPUBLISHED — consumed via `file:` deps only.
 */
export type { AuthCodeSession, AuthUrlParams, ClientRegistration, CliLoginOptions, LoopbackListener, OidcProviderMetadata, OnTokensRefreshed, PkcePair, } from "./authCode.js";
/**
 * Solid-OIDC authorization-code + PKCE + DPoP — the *user-delegated* login. Produces an
 * `AuthCodeSession` (a `SolidSessionState` + refresh token) usable with the same `authedFetch` /
 * `rdfFetchFor` surface as the client-credentials session.
 */
export { assertEndpointTransport, assertIssuerTransport, buildAuthorizationUrl, cliLogin, DEFAULT_SCOPE, discoverProvider, exchangeCode, generatePkce, isLoopbackHost, pkceChallengeS256, refreshSession, registerClient, startLoopbackListener, staticClient, } from "./authCode.js";
export type { DpopKeyPair, DpopProofParams } from "./dpop.js";
export { accessTokenHash, canonicalHtu, createDpopProof, DPOP_ALG, exportDpopKeyPairJwk, generateDpopKeyPair, importDpopKeyPairJwk, toDpopKeyPair, } from "./dpop.js";
export type { ClientCredentials, FetchLike, SolidSessionState } from "./session.js";
export { acquireToken, authedFetch, createSession, discoveryUrl, generateSessionKeyPair, rdfFetchFor, } from "./session.js";
export type { StoredSession } from "./sessionStore.js";
/**
 * Persist a user-delegated session to disk (`0600`) so a CLI logs in once and later runs reuse it
 * via the refresh grant. The DPoP private key is stored because CSS binds the refresh token to the
 * original `jkt` — regenerating the keypair fails refresh (verified live). See sessionStore.ts.
 */
export { deserializeSession, loadSession, saveSession, serializeSession, } from "./sessionStore.js";
//# sourceMappingURL=index.d.ts.map