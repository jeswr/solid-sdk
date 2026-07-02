"use strict";
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseOrigin = exports.isAllowedOrigin = exports.allowedOriginsFor = exports.WEBAUTHN_ASSERTION_TOKEN_TYPE = exports.TOKEN_EXCHANGE_GRANT_TYPE = exports.BUNDLE_VERSION = exports.MalformedBundleError = exports.encodeAssertionBundle = exports.decodeAssertionBundle = exports.encodeBase64url = exports.decodeBase64url = void 0;
/**
 * `@jeswr/solid-webauthn-reauth/protocol` — the shared, pure, isomorphic
 * wire-format contract for Solid WebAuthn re-authentication.
 *
 * Zero runtime dependencies (the `@simplewebauthn/browser` types are erased at
 * build). Safe to import in a Node IdP verifier (ESM **or** CJS) as well as the
 * browser client — both sides then encode/decode/origin-check with identical
 * code. The browser client (`.`) re-uses this layer internally.
 */
var base64url_js_1 = require("./base64url.js");
Object.defineProperty(exports, "decodeBase64url", { enumerable: true, get: function () { return base64url_js_1.decodeBase64url; } });
Object.defineProperty(exports, "encodeBase64url", { enumerable: true, get: function () { return base64url_js_1.encodeBase64url; } });
var codec_js_1 = require("./codec.js");
Object.defineProperty(exports, "decodeAssertionBundle", { enumerable: true, get: function () { return codec_js_1.decodeAssertionBundle; } });
Object.defineProperty(exports, "encodeAssertionBundle", { enumerable: true, get: function () { return codec_js_1.encodeAssertionBundle; } });
Object.defineProperty(exports, "MalformedBundleError", { enumerable: true, get: function () { return codec_js_1.MalformedBundleError; } });
var constants_js_1 = require("./constants.js");
Object.defineProperty(exports, "BUNDLE_VERSION", { enumerable: true, get: function () { return constants_js_1.BUNDLE_VERSION; } });
Object.defineProperty(exports, "TOKEN_EXCHANGE_GRANT_TYPE", { enumerable: true, get: function () { return constants_js_1.TOKEN_EXCHANGE_GRANT_TYPE; } });
Object.defineProperty(exports, "WEBAUTHN_ASSERTION_TOKEN_TYPE", { enumerable: true, get: function () { return constants_js_1.WEBAUTHN_ASSERTION_TOKEN_TYPE; } });
var origin_js_1 = require("./origin.js");
Object.defineProperty(exports, "allowedOriginsFor", { enumerable: true, get: function () { return origin_js_1.allowedOriginsFor; } });
Object.defineProperty(exports, "isAllowedOrigin", { enumerable: true, get: function () { return origin_js_1.isAllowedOrigin; } });
Object.defineProperty(exports, "normaliseOrigin", { enumerable: true, get: function () { return origin_js_1.normaliseOrigin; } });
//# sourceMappingURL=index.js.map