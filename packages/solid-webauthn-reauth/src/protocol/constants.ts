// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

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
export const WEBAUTHN_ASSERTION_TOKEN_TYPE = "urn:solid:token-type:webauthn-assertion" as const;

/**
 * OAuth 2.0 Token Exchange grant type (RFC 8693) used for redirect-free re-auth.
 */
export const TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange" as const;

/**
 * Current assertion-bundle envelope version. The verifier rejects unknown
 * versions with `invalid_request`.
 */
export const BUNDLE_VERSION = 1 as const;
