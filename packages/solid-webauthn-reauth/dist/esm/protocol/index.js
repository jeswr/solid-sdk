// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * `@jeswr/solid-webauthn-reauth/protocol` — the shared, pure, isomorphic
 * wire-format contract for Solid WebAuthn re-authentication.
 *
 * Zero runtime dependencies (the `@simplewebauthn/browser` types are erased at
 * build). Safe to import in a Node IdP verifier (ESM **or** CJS) as well as the
 * browser client — both sides then encode/decode/origin-check with identical
 * code. The browser client (`.`) re-uses this layer internally.
 */
export { decodeBase64url, encodeBase64url } from "./base64url.js";
export { decodeAssertionBundle, encodeAssertionBundle, MalformedBundleError, } from "./codec.js";
export { BUNDLE_VERSION, TOKEN_EXCHANGE_GRANT_TYPE, WEBAUTHN_ASSERTION_TOKEN_TYPE, } from "./constants.js";
export { allowedOriginsFor, isAllowedOrigin, normaliseOrigin, } from "./origin.js";
//# sourceMappingURL=index.js.map