import * as oauth from "oauth4webapi";
import type { TokenExchange, TokenExchangeContext } from "./TokenProvider.js";
/**
 * Per-OpenID-Provider configuration for {@link WebAuthnTokenExchange}.
 *
 * The exchange matches a request to an OP by host (see {@link WebAuthnConfig}),
 * fetches a challenge from {@link WebAuthnIssuerConfig.assertionOptionsEndpoint},
 * relays a WebAuthn assertion to {@link WebAuthnIssuerConfig.tokenEndpoint}, and
 * returns a DPoP-bound token (the binding to the resource request is performed
 * by {@link WebAuthnTokenProvider}).
 */
export interface WebAuthnIssuerConfig {
    /** The OP issuer URL (e.g. `https://op.example`). */
    issuer: string | URL;
    /**
     * The conventional WebAuthn assertion-options endpoint that issues the
     * single-use challenge. Defaults to
     * `<issuer>/.oidc/webauthn/assertion-options` when omitted.
     */
    assertionOptionsEndpoint?: string | URL;
    /**
     * HTTP method for the assertion-options request. Issuing a single-use
     * challenge is a state-changing, non-cacheable operation, so this defaults to
     * `POST`. Set to `'GET'` for OPs that expose the challenge as a safe read.
     */
    assertionOptionsMethod?: "GET" | "POST";
    /**
     * The token endpoint for the RFC 8693 token exchange. Defaults to the
     * issuer's OIDC-discovered `token_endpoint`, falling back to
     * `<issuer>/.oidc/token`.
     */
    tokenEndpoint?: string | URL;
    /**
     * The application's Solid-OIDC **Client ID Document URI** — the public
     * `client_id` the OP authenticates at the token endpoint (the app is a public
     * client, `token_endpoint_auth_method: none`). It is sent in the RFC 8693
     * body so the OP can (a) dereference the document to resolve the app's allowed
     * origins and (b) bind the issued token's `client_id`/`azp` claim. Defaults to
     * the app's own origin (`<page-origin>/`) when omitted, but a Solid-OIDC
     * client SHOULD set its Client ID Document URI.
     */
    clientId?: string | URL;
}
/**
 * Maps a request host to a {@link WebAuthnIssuerConfig}. The exchange is selected
 * (via {@link WebAuthnTokenExchange.matches}) only for hosts present here, so the
 * owning provider can sit alongside other providers in the array — ordering
 * controls precedence, first match wins.
 */
export type WebAuthnConfig = Record<string, WebAuthnIssuerConfig>;
/**
 * The redirect-free WebAuthn {@link TokenExchange}:
 *
 * 1. resolves the OP for the target request;
 * 2. `POST`s the OP assertion-options endpoint for a single-use challenge;
 * 3. runs the WebAuthn `get()` ceremony (`navigator.credentials.get`, via
 *    SimpleWebAuthn's `startAuthentication`) — the app is the Relying Party, so
 *    the assertion's `clientDataJSON.origin` unspoofably attests the app;
 * 4. encodes the assertion as the versioned bundle `subject_token`; and
 * 5. exchanges it at the token endpoint (RFC 8693) with the provider-supplied
 *    DPoP proof.
 *
 * The DPoP keypair, resource binding, and upgraded request are owned by
 * {@link WebAuthnTokenProvider}; this exchange only attaches the shared DPoP
 * handle to the RFC 8693 grant and asserts the issued token is
 * sender-constrained.
 */
export declare class WebAuthnTokenExchange implements TokenExchange {
    #private;
    constructor(config: WebAuthnConfig);
    /** Select this exchange when the request host has WebAuthn config. */
    matches(request: Request): Promise<boolean>;
    acquire({ request, dpop }: TokenExchangeContext): Promise<oauth.TokenEndpointResponse>;
}
//# sourceMappingURL=WebAuthnTokenExchange.d.ts.map