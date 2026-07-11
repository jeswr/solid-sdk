import { type DpopKeyPair } from "./dpop.js";
import type { FetchLike, SolidSessionState } from "./session.js";
/** True iff `host` (a URL hostname, no port) is a loopback address. */
export declare function isLoopbackHost(host: string): boolean;
/**
 * Enforce the issuer transport policy: `https:` always allowed; `http:` allowed ONLY for loopback
 * hosts. This is the deliberate fix for the reactive-auth 0.1.3 "rejects all http issuers" bug —
 * it must NOT reject `http://localhost:3000/` while it MUST reject `http://idp.example.com/`.
 *
 * @throws if the issuer uses `http:` against a non-loopback host, or an unsupported scheme.
 */
export declare function assertIssuerTransport(issuer: string): void;
/**
 * Enforce the SAME https-or-loopback transport policy on a single DISCOVERED endpoint URL
 * (`authorization_endpoint`, `token_endpoint`, `registration_endpoint`, …). A malicious or
 * misconfigured discovery document could point an endpoint at an insecure non-loopback `http:` URL
 * (or a different origin) and siphon authorization codes, refresh tokens, or client secrets — so
 * every endpoint we will actually contact is validated, not just the input issuer.
 *
 * @throws if the endpoint uses `http:` against a non-loopback host, or an unsupported scheme.
 */
export declare function assertEndpointTransport(endpoint: string, name: string): void;
export interface PkcePair {
    /** High-entropy random verifier (43–128 chars, unreserved alphabet). */
    readonly verifier: string;
    /** `BASE64URL(SHA256(ASCII(verifier)))`. */
    readonly challenge: string;
    /** Always `"S256"` here — `plain` is not used. */
    readonly method: "S256";
}
/**
 * Derive the S256 PKCE challenge from a verifier: `BASE64URL-ENCODE(SHA256(ASCII(verifier)))`
 * (RFC 7636 §4.2). Exposed so the unit suite can assert the RFC 7636 Appendix-B test vector.
 */
export declare function pkceChallengeS256(verifier: string): string;
/**
 * Generate a fresh PKCE verifier + S256 challenge. The verifier is 32 random bytes encoded
 * base64url (43 chars), comfortably inside the RFC 7636 43–128 range and using only the
 * unreserved alphabet. node:crypto only — no hand-rolled randomness.
 */
export declare function generatePkce(): PkcePair;
/** The discovery fields this flow needs (OpenID Connect Discovery 1.0 + RFC 7591). */
export interface OidcProviderMetadata {
    readonly issuer: string;
    readonly authorization_endpoint: string;
    readonly token_endpoint: string;
    readonly registration_endpoint?: string;
    /** Advertised DPoP-binding algs, if any (RFC 9449 §5.1). Informational here. */
    readonly dpop_signing_alg_values_supported?: string[];
}
/**
 * Discover the provider metadata from `.well-known/openid-configuration`.
 *
 * Hardening (defence against a malicious / misconfigured discovery document):
 *  1. The INPUT issuer is transport-checked BEFORE the fetch (https-or-loopback).
 *  2. The RETURNED `issuer` MUST equal the requested issuer exactly — OIDC Discovery 1.0 §4.3
 *     requires issuer equality, and this stops a document that claims to speak for a different
 *     origin.
 *  3. EVERY endpoint we will actually contact (`authorization_endpoint`, `token_endpoint`, and
 *     `registration_endpoint` when present) is held to the SAME https-or-loopback bar as the
 *     issuer, so authorization codes / refresh tokens / client secrets cannot be redirected to an
 *     insecure non-loopback `http:` URL.
 *
 * All checks run BEFORE the metadata is returned (and before any downstream request is made).
 */
export declare function discoverProvider(issuer: string, fetchImpl?: FetchLike): Promise<OidcProviderMetadata>;
/** A registered (or statically configured) OAuth client. */
export interface ClientRegistration {
    readonly client_id: string;
    /** Present for confidential clients from DCR; absent for public clients / static Client IDs. */
    readonly client_secret?: string;
    readonly redirect_uris: readonly string[];
}
/**
 * Dynamic Client Registration (RFC 7591). CSS supports anonymous DCR, so no initial access token
 * is sent. We register a PUBLIC native client (no secret) using PKCE — `token_endpoint_auth_method:
 * "none"` — bound to the loopback `redirectUri`.
 *
 * TODO(client-identifier-document): the Solid-OIDC alternative to DCR is a static **Client
 * Identifier Document** — an https URL serving a JSON-LD client doc whose `client_id` equals that
 * URL. {@link staticClient} is the seam for that path; a deployed app SHOULD use it so the consent
 * screen shows a stable app name. DCR is the right default only for CLIs / local dev where no
 * public https client-doc URL exists.
 */
export declare function registerClient(meta: OidcProviderMetadata, redirectUri: string, opts?: {
    clientName?: string;
}, fetchImpl?: FetchLike): Promise<ClientRegistration>;
/**
 * Build a {@link ClientRegistration} from a STATIC client id (a Solid-OIDC Client Identifier
 * Document URL, or a pre-registered confidential client). No network call. This is the seam a
 * deployed app uses instead of {@link registerClient}.
 */
export declare function staticClient(clientId: string, redirectUri: string, clientSecret?: string): ClientRegistration;
export interface AuthUrlParams {
    readonly meta: OidcProviderMetadata;
    readonly client: ClientRegistration;
    readonly redirectUri: string;
    readonly pkce: PkcePair;
    /** Anti-CSRF state echoed back on the redirect. */
    readonly state: string;
    /** OIDC replay nonce bound into the ID token. */
    readonly nonce: string;
    /** Defaults to `openid webid offline_access` (Solid-OIDC + a refresh token). */
    readonly scope?: string;
    /**
     * OIDC `prompt`. Defaults to `"consent"` when the scope requests `offline_access` (so CSS issues
     * a refresh token); pass an explicit value (e.g. `"none"`) to override.
     */
    readonly prompt?: "consent" | "login" | "none" | "select_account";
}
/** Default Solid-OIDC scope set: `openid` (OIDC), `webid` (Solid profile), `offline_access` (refresh). */
export declare const DEFAULT_SCOPE: "openid webid offline_access";
/**
 * Construct the authorization-request URL (RFC 6749 §4.1.1 + RFC 7636 §4.3 + OIDC). Includes
 * `response_type=code`, the S256 `code_challenge`, `state`, `nonce`, and the Solid-OIDC scope.
 *
 * When `offline_access` is requested, `prompt` DEFAULTS to `"consent"` (overridable via
 * `params.prompt`): CSS only issues a refresh token when consent is explicitly prompted, so without
 * this default the documented `refreshSession` would run on a tokenless session.
 */
export declare function buildAuthorizationUrl(params: AuthUrlParams): string;
export interface LoopbackListener {
    /** The `http://127.0.0.1:<port>/<path>` redirect URI the AS must redirect to. */
    readonly redirectUri: string;
    /** Resolves with the `{code, state}` (or `{error}`) once the browser hits the redirect. */
    readonly waitForCode: (timeoutMs?: number) => Promise<{
        code: string;
        state: string;
    }>;
    /** Close the listener. Idempotent. */
    readonly close: () => Promise<void>;
}
/**
 * Start a one-shot loopback HTTP listener on `127.0.0.1` and an ephemeral port (RFC 8252 §7.3) to
 * catch the authorization-code redirect for CLI / native apps. The browser is sent here; the AS
 * appends `?code=…&state=…`. We resolve on the first matching request and serve a tiny success
 * page so the user can close the tab.
 *
 * Binds to `127.0.0.1` (never `0.0.0.0`) so the listener is never reachable off-host.
 */
export declare function startLoopbackListener(path?: string): Promise<LoopbackListener>;
/**
 * Fired by {@link refreshSession} after the session adopts rotated tokens. The callback receives the
 * SAME mutated session (refreshed access token, rotated refresh token, same DPoP keypair), so a
 * consumer can re-persist it — e.g. re-write the chmod-600 session JSON so a restart loads the
 * rotated (still-valid) refresh token rather than the invalidated old one.
 *
 * The DPoP `jkt`/private-JWK binding is preserved across refresh (the keypair is reused), so
 * re-persisting via `saveSession` keeps the refresh token usable.
 */
export type OnTokensRefreshed = (session: AuthCodeSession) => void | Promise<void>;
/** The result of a successful code-exchange or refresh: an `authedFetch`-ready session + tokens. */
export interface AuthCodeSession extends SolidSessionState {
    /** The refresh token (RFC 6749 §6), if the AS issued one (requires `offline_access`). */
    refreshToken?: string;
    /** The provider metadata, retained so refresh can re-hit the token endpoint. */
    readonly providerMetadata: OidcProviderMetadata;
    /** The client used, retained for the refresh request. */
    readonly client: ClientRegistration;
    /**
     * Optional hook invoked AFTER each successful refresh (token rotation applied). Consumers set it
     * to re-persist the rotated tokens. NOT serialised by the session store; re-attach after load.
     */
    onRefresh?: OnTokensRefreshed;
}
/**
 * Exchange an authorization `code` (+ PKCE `verifier`) for a DPoP-bound access token (and a refresh
 * token when `offline_access` was granted). RFC 6749 §4.1.3 + RFC 7636 §4.5 + RFC 9449.
 */
export declare function exchangeCode(args: {
    readonly meta: OidcProviderMetadata;
    readonly client: ClientRegistration;
    readonly redirectUri: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly keyPair?: DpopKeyPair;
    readonly fetchImpl?: FetchLike;
}): Promise<AuthCodeSession>;
/**
 * Refresh an {@link AuthCodeSession} using its refresh token (RFC 6749 §6) with a DPoP proof, and
 * apply refresh-token ROTATION: if the AS returns a new `refresh_token`, the session adopts it and
 * the old one is discarded. Mutates `session` in place and returns it.
 *
 * The DPoP keypair is REUSED across refreshes — the access token stays bound to the same `jkt`.
 */
export declare function refreshSession(session: AuthCodeSession, fetchImpl?: FetchLike): Promise<AuthCodeSession>;
export interface CliLoginOptions {
    readonly issuer: string;
    /** Open the authorization URL in a browser. Defaults to printing it. CLIs pass a real opener. */
    readonly openBrowser?: (url: string) => void | Promise<void>;
    /** Static client id (Client Identifier Document); when omitted, anonymous DCR is used. */
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly clientName?: string;
    readonly scope?: string;
    readonly prompt?: AuthUrlParams["prompt"];
    /** Loopback callback path. Defaults to `/callback`. */
    readonly callbackPath?: string;
    readonly timeoutMs?: number;
    readonly fetchImpl?: FetchLike;
}
/**
 * The full user-delegated CLI login: discover → (register | static client) → start loopback
 * listener → build the authorization URL → open it → await the redirect → verify `state` →
 * exchange the code for a DPoP-bound session. Returns an {@link AuthCodeSession} usable with
 * `authedFetch` / `rdfFetchFor`.
 *
 * Headless test drivers can skip {@link cliLogin} and call the primitives directly (discover,
 * startLoopbackListener, buildAuthorizationUrl, exchangeCode) — that is what the live CSS spec does.
 */
export declare function cliLogin(opts: CliLoginOptions): Promise<AuthCodeSession>;
//# sourceMappingURL=authCode.d.ts.map