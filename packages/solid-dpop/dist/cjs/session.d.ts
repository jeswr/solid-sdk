/**
 * Server-side Solid-OIDC session: the consumer custodies one DPoP keypair + access token
 * per connection and uses them to make sender-constrained (RFC 9449) requests to a pod.
 *
 * Token acquisition here uses the **client-credentials** grant (CSS `.account` API):
 * the connection is provisioned with a CSS client-credentials token `{id, secret}` that
 * is exchanged at the OIDC `token_endpoint` for a DPoP-bound access token. This is the
 * grant a self-hosted / service-account consumer uses. A user-delegated consumer would
 * instead hold a refresh token from an authorization-code flow; the resource-request half
 * (`authedFetch`) is identical, only `acquireToken` differs.
 */
import { type DpopKeyPair } from "./dpop.js";
export interface ClientCredentials {
    /** OIDC issuer base URL (the pod's IdP), e.g. http://localhost:3099/ */
    readonly issuer: string;
    /** CSS client-credentials token id. */
    readonly id: string;
    /** CSS client-credentials token secret. */
    readonly secret: string;
}
export interface SolidSessionState {
    readonly keyPair: DpopKeyPair;
    accessToken: string;
    /** epoch ms after which the token is considered expired. */
    expiresAt: number;
    /** Last DPoP nonce handed back by the resource/AS server, if any. */
    nonce?: string;
}
/**
 * Minimal fetch-like signature so tests can inject a transport. Consumers only ever send a
 * `string` or `Uint8Array` body; both are valid runtime `BodyInit`s for global fetch, but we
 * keep the narrow union here (rather than DOM `BodyInit`) so tests can supply a simple stub.
 */
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
}) => Promise<Response>;
/**
 * Build the OIDC Discovery URL for an issuer. Per OpenID Connect Discovery 1.0 §4, the well-known
 * suffix is APPENDED to the issuer (including any path), so `https://host/realm` →
 * `https://host/realm/.well-known/openid-configuration`. The naive `new URL(".well-known/...",
 * issuer)` resolves relative to the issuer's *parent* and drops the last path segment (`/realm`),
 * breaking non-root issuers like Keycloak realms.
 */
export declare function discoveryUrl(issuer: string): string;
/** Generate a fresh DPoP keypair for a new session. node:crypto/jose only — no hand-rolled keygen. */
export declare function generateSessionKeyPair(): Promise<DpopKeyPair>;
/**
 * Exchange client-credentials for a DPoP-bound access token. Handles the RFC 9449 §8
 * `use_dpop_nonce` challenge: if the AS rejects the first attempt demanding a nonce, we
 * retry once with the supplied `DPoP-Nonce`.
 */
export declare function acquireToken(creds: ClientCredentials, keyPair: DpopKeyPair, fetchImpl?: FetchLike): Promise<{
    accessToken: string;
    expiresAt: number;
    nonce?: string;
}>;
/** Create a fully-initialised server-side session (keypair + first token). */
export declare function createSession(creds: ClientCredentials, fetchImpl?: FetchLike): Promise<SolidSessionState>;
/**
 * Make a DPoP-bound request to a pod resource. Sends `Authorization: DPoP <token>` plus a
 * fresh per-request DPoP proof carrying the `ath` binding. Handles the §8 nonce challenge
 * (401 + DPoP-Nonce) with a single retry, persisting the nonce on the session.
 *
 * `creds` is the client-credentials token used to silently re-mint an expired access token. It is
 * OPTIONAL: a user-delegated (authorization-code) session has no client-credentials and instead
 * refreshes via `refreshSession` from `authCode.ts`, so it passes `undefined` here — in that case
 * an expired token is left as-is for the caller (or its own refresh loop) to handle.
 */
export declare function authedFetch(session: SolidSessionState, creds: ClientCredentials | undefined, method: string, url: string, init?: {
    headers?: Record<string, string>;
    body?: string | Uint8Array;
}, fetchImpl?: FetchLike): Promise<Response>;
/**
 * Build an RDF-capable fetch (the signature `@jeswr/fetch-rdf` expects) bound to this session.
 * Adapts the standard DOM `fetch` signature down onto `authedFetch`, so RDF helpers that take a
 * `fetch` option can transparently issue DPoP-bound requests.
 */
export declare function rdfFetchFor(session: SolidSessionState, creds: ClientCredentials | undefined, fetchImpl?: FetchLike): typeof globalThis.fetch;
//# sourceMappingURL=session.d.ts.map