/**
 * Protocol constants for Solid WebAuthn re-authentication.
 *
 * The token-type URN stays in the `urn:solid:` namespace for v1 (no IANA/IETF
 * registration yet); reversible.
 */
/**
 * `subject_token_type` for the re-auth token exchange — the WebAuthn assertion
 * bundle is the `subject_token`.
 */
export declare const WEBAUTHN_ASSERTION_TOKEN_TYPE: "urn:solid:token-type:webauthn-assertion";
/**
 * OAuth 2.0 Token Exchange grant type (RFC 8693) used for redirect-free re-auth.
 */
export declare const TOKEN_EXCHANGE_GRANT_TYPE: "urn:ietf:params:oauth:grant-type:token-exchange";
/**
 * Current assertion-bundle envelope version. The verifier rejects unknown
 * versions with `invalid_request`.
 */
export declare const BUNDLE_VERSION: 1;
//# sourceMappingURL=constants.d.ts.map