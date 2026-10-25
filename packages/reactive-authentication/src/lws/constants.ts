/*
 * Wire identifiers used by LWS 1.0 (w3c/lws-protocol@268fd25, 2026-09-25) and its authentication suites.
 */

export const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"

/** Subject token types (RFC 8693 §3, IANA "OAuth URI" registry) used by the LWS authentication suites. */
export const TokenType = {
    /** LWS OpenID Connect suite. */
    idToken: "urn:ietf:params:oauth:token-type:id_token",
    /** LWS SAML 2.0 suite: a base64url-encoded SAML 2.0 assertion. */
    saml2: "urn:ietf:params:oauth:token-type:saml2",
    /** LWS self-issued suites (controlled identifiers and did:key). */
    jwt: "urn:ietf:params:oauth:token-type:jwt",
} as const

/**
 * The lws10-core metadata example spells the ID token type `id-token`, while the OpenID suite and the
 * request example use the registered `id_token`. We send `id_token` and accept either when checking
 * `subject_token_types_supported`.
 */
export const tokenTypeAliases: Readonly<Record<string, readonly string[]>> = {
    [TokenType.idToken]: [TokenType.idToken, "urn:ietf:params:oauth:token-type:id-token"],
}

export const LWS_CONFIGURATION = "/.well-known/lws-configuration"
export const LWS_STORAGE_REL = "https://www.w3.org/ns/lws#storage"
export const LWS_STORAGE_DESCRIPTION_TYPE = "application/lws+cid"
export const SOLID_STORAGE_DESCRIPTION_REL = "http://www.w3.org/ns/solid/terms#storageDescription"
