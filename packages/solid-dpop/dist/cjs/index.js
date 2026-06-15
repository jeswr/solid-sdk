"use strict";
/**
 * @jeswr/solid-dpop — canonical Solid-OIDC client-credentials session + RFC 9449 DPoP proof
 * primitives, shared by the W6.5 integration prototypes (dpop-bridge, solid-sync, solid-mcp,
 * n8n-solid, wix-solid, slack-solid). PRIVATE / UNPUBLISHED — consumed via `file:` deps only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeSession = exports.saveSession = exports.loadSession = exports.deserializeSession = exports.rdfFetchFor = exports.generateSessionKeyPair = exports.discoveryUrl = exports.createSession = exports.authedFetch = exports.acquireToken = exports.toDpopKeyPair = exports.importDpopKeyPairJwk = exports.generateDpopKeyPair = exports.exportDpopKeyPairJwk = exports.DPOP_ALG = exports.createDpopProof = exports.canonicalHtu = exports.accessTokenHash = exports.staticClient = exports.startLoopbackListener = exports.registerClient = exports.refreshSession = exports.pkceChallengeS256 = exports.isLoopbackHost = exports.generatePkce = exports.exchangeCode = exports.discoverProvider = exports.DEFAULT_SCOPE = exports.cliLogin = exports.buildAuthorizationUrl = exports.assertIssuerTransport = exports.assertEndpointTransport = void 0;
/**
 * Solid-OIDC authorization-code + PKCE + DPoP — the *user-delegated* login. Produces an
 * `AuthCodeSession` (a `SolidSessionState` + refresh token) usable with the same `authedFetch` /
 * `rdfFetchFor` surface as the client-credentials session.
 */
var authCode_js_1 = require("./authCode.js");
Object.defineProperty(exports, "assertEndpointTransport", { enumerable: true, get: function () { return authCode_js_1.assertEndpointTransport; } });
Object.defineProperty(exports, "assertIssuerTransport", { enumerable: true, get: function () { return authCode_js_1.assertIssuerTransport; } });
Object.defineProperty(exports, "buildAuthorizationUrl", { enumerable: true, get: function () { return authCode_js_1.buildAuthorizationUrl; } });
Object.defineProperty(exports, "cliLogin", { enumerable: true, get: function () { return authCode_js_1.cliLogin; } });
Object.defineProperty(exports, "DEFAULT_SCOPE", { enumerable: true, get: function () { return authCode_js_1.DEFAULT_SCOPE; } });
Object.defineProperty(exports, "discoverProvider", { enumerable: true, get: function () { return authCode_js_1.discoverProvider; } });
Object.defineProperty(exports, "exchangeCode", { enumerable: true, get: function () { return authCode_js_1.exchangeCode; } });
Object.defineProperty(exports, "generatePkce", { enumerable: true, get: function () { return authCode_js_1.generatePkce; } });
Object.defineProperty(exports, "isLoopbackHost", { enumerable: true, get: function () { return authCode_js_1.isLoopbackHost; } });
Object.defineProperty(exports, "pkceChallengeS256", { enumerable: true, get: function () { return authCode_js_1.pkceChallengeS256; } });
Object.defineProperty(exports, "refreshSession", { enumerable: true, get: function () { return authCode_js_1.refreshSession; } });
Object.defineProperty(exports, "registerClient", { enumerable: true, get: function () { return authCode_js_1.registerClient; } });
Object.defineProperty(exports, "startLoopbackListener", { enumerable: true, get: function () { return authCode_js_1.startLoopbackListener; } });
Object.defineProperty(exports, "staticClient", { enumerable: true, get: function () { return authCode_js_1.staticClient; } });
var dpop_js_1 = require("./dpop.js");
Object.defineProperty(exports, "accessTokenHash", { enumerable: true, get: function () { return dpop_js_1.accessTokenHash; } });
Object.defineProperty(exports, "canonicalHtu", { enumerable: true, get: function () { return dpop_js_1.canonicalHtu; } });
Object.defineProperty(exports, "createDpopProof", { enumerable: true, get: function () { return dpop_js_1.createDpopProof; } });
Object.defineProperty(exports, "DPOP_ALG", { enumerable: true, get: function () { return dpop_js_1.DPOP_ALG; } });
Object.defineProperty(exports, "exportDpopKeyPairJwk", { enumerable: true, get: function () { return dpop_js_1.exportDpopKeyPairJwk; } });
Object.defineProperty(exports, "generateDpopKeyPair", { enumerable: true, get: function () { return dpop_js_1.generateDpopKeyPair; } });
Object.defineProperty(exports, "importDpopKeyPairJwk", { enumerable: true, get: function () { return dpop_js_1.importDpopKeyPairJwk; } });
Object.defineProperty(exports, "toDpopKeyPair", { enumerable: true, get: function () { return dpop_js_1.toDpopKeyPair; } });
var session_js_1 = require("./session.js");
Object.defineProperty(exports, "acquireToken", { enumerable: true, get: function () { return session_js_1.acquireToken; } });
Object.defineProperty(exports, "authedFetch", { enumerable: true, get: function () { return session_js_1.authedFetch; } });
Object.defineProperty(exports, "createSession", { enumerable: true, get: function () { return session_js_1.createSession; } });
Object.defineProperty(exports, "discoveryUrl", { enumerable: true, get: function () { return session_js_1.discoveryUrl; } });
Object.defineProperty(exports, "generateSessionKeyPair", { enumerable: true, get: function () { return session_js_1.generateSessionKeyPair; } });
Object.defineProperty(exports, "rdfFetchFor", { enumerable: true, get: function () { return session_js_1.rdfFetchFor; } });
/**
 * Persist a user-delegated session to disk (`0600`) so a CLI logs in once and later runs reuse it
 * via the refresh grant. The DPoP private key is stored because CSS binds the refresh token to the
 * original `jkt` — regenerating the keypair fails refresh (verified live). See sessionStore.ts.
 */
var sessionStore_js_1 = require("./sessionStore.js");
Object.defineProperty(exports, "deserializeSession", { enumerable: true, get: function () { return sessionStore_js_1.deserializeSession; } });
Object.defineProperty(exports, "loadSession", { enumerable: true, get: function () { return sessionStore_js_1.loadSession; } });
Object.defineProperty(exports, "saveSession", { enumerable: true, get: function () { return sessionStore_js_1.saveSession; } });
Object.defineProperty(exports, "serializeSession", { enumerable: true, get: function () { return sessionStore_js_1.serializeSession; } });
//# sourceMappingURL=index.js.map