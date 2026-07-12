// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

/**
 * `@jeswr/solid-webauthn-reauth` — redirect-free WebAuthn (passkey)
 * re-authentication for Solid-OIDC.
 *
 * The **app is the WebAuthn Relying Party** and the resource server is untouched:
 * after a normal login the app {@link registerPasskey registers} an
 * origin-bound passkey with the user's OP, then
 * {@link WebAuthnTokenProvider re-authenticates without a redirect} by relaying a
 * WebAuthn assertion to the OP (RFC 8693 token-exchange), which returns ordinary
 * DPoP-bound Solid-OIDC tokens. One origin-bound assertion attests **both** the
 * user (who holds the authenticator) and the app (whose origin the browser signs
 * into the assertion).
 *
 * This barrel is the **browser client** entry (`.`). Depends on `oauth4webapi`
 * (ESM-only) + `@simplewebauthn/browser`, so it is ESM-only. The pure,
 * isomorphic wire-format contract for an IdP verifier is the separate
 * `@jeswr/solid-webauthn-reauth/protocol` subexport (ESM + CJS). See `DESIGN.md`.
 *
 * Complements `@jeswr/solid-dpop` and `@jeswr/solid-session-restore`.
 */

// The redirect-free re-auth provider + its Strategy seam.
export { dpopBoundRequest } from "./client/dpopBoundRequest.js";
// Registration (once per app+device, after login).
export type {
  AuthenticatedFetch,
  RegisterPasskeyOptions,
  RegisterPasskeyResult,
} from "./client/registration.js";
export { registerPasskey } from "./client/registration.js";
export type {
  TokenExchange,
  TokenExchangeContext,
  TokenProvider,
} from "./client/TokenProvider.js";
export type {
  WebAuthnConfig,
  WebAuthnIssuerConfig,
} from "./client/WebAuthnTokenExchange.js";
export { WebAuthnTokenExchange } from "./client/WebAuthnTokenExchange.js";
export { WebAuthnTokenProvider } from "./client/WebAuthnTokenProvider.js";
export type {
  AssertionBundle,
  AssertionOptions,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationBundle,
  RegistrationOptions,
  RegistrationResponseJSON,
} from "./protocol/index.js";
// Re-export the shared wire-format contract for convenience (also available as
// the `./protocol` subexport, which additionally ships a CJS build).
export {
  allowedOriginsFor,
  BUNDLE_VERSION,
  decodeAssertionBundle,
  decodeBase64url,
  encodeAssertionBundle,
  encodeBase64url,
  isAllowedOrigin,
  MalformedBundleError,
  normaliseOrigin,
  TOKEN_EXCHANGE_GRANT_TYPE,
  WEBAUTHN_ASSERTION_TOKEN_TYPE,
} from "./protocol/index.js";
