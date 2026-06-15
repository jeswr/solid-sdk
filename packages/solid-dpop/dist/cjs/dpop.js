"use strict";
/**
 * DPoP proof generation (RFC 9449) — the security-critical core of the Solid-OIDC path.
 *
 * A DPoP proof is a JWS whose:
 *   - header  `typ` = "dpop+jwt", `alg` = the key's signature alg, `jwk` = the PUBLIC key.
 *   - payload `htm` = HTTP method, `htu` = HTTP URI (no query/fragment), `iat` = now,
 *             `jti` = unique nonce, and — when presenting an access token —
 *             `ath` = base64url(SHA-256(access_token)).  RFC 9449 §4.2 / §6.1.
 *
 * The `ath` claim binds the proof to a specific access token: a stolen proof cannot be
 * replayed with a different token, and a stolen token cannot be replayed without the
 * private key that produced the matching `cnf.jkt`. We hand-roll NOTHING here beyond
 * calling jose; all JWS/thumbprint/base64url operations go through `jose`. The only
 * non-jose call is node:crypto SHA-256 for the `ath` digest (jose exposes no helper for it).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DPOP_ALG = void 0;
exports.canonicalHtu = canonicalHtu;
exports.accessTokenHash = accessTokenHash;
exports.toDpopKeyPair = toDpopKeyPair;
exports.generateDpopKeyPair = generateDpopKeyPair;
exports.exportDpopKeyPairJwk = exportDpopKeyPairJwk;
exports.importDpopKeyPairJwk = importDpopKeyPairJwk;
exports.createDpopProof = createDpopProof;
const node_crypto_1 = require("node:crypto");
/**
 * jose@6 is ESM-only. A *static* import makes the CJS build emit `require("jose")`, which throws
 * `ERR_REQUIRE_ESM` on Node releases where require(ESM) is not enabled (e.g. Node 20.x < 20.19,
 * 22.x < 22.12), breaking CJS consumers such as n8n-solid. We instead load jose lazily via a true
 * dynamic `import()`, which is valid from CJS on every supported Node. Under Vitest/ESM this runs
 * as-is; in the CJS build, tsc down-levels `import()` to `require()`, so the build:cjs step
 * rewrites that one call back into a real `import()` (see scripts/fix-cjs-jose-import.mjs).
 */
let josePromise;
function loadJose() {
    if (!josePromise) {
        josePromise = import("jose");
    }
    return josePromise;
}
/** Signature algorithm used for the DPoP keypair. ES256 is the Solid-OIDC default. */
exports.DPOP_ALG = "ES256";
/**
 * Compute the RFC 9449 §4.2 `htu`: the request URI with query and fragment removed.
 * The scheme + authority + path are normalised by the URL parser.
 */
function canonicalHtu(uri) {
    const u = new URL(uri);
    u.search = "";
    u.hash = "";
    return u.toString();
}
/**
 * Compute the `ath` claim: base64url( SHA-256( ASCII(access_token) ) ).  RFC 9449 §4.2.
 * jose has no public helper for this, so we use node:crypto's SHA-256 and jose-style
 * base64url (no padding, URL-safe alphabet). This is a digest, not a crypto primitive.
 */
function accessTokenHash(accessToken) {
    return (0, node_crypto_1.createHash)("sha256").update(accessToken, "ascii").digest("base64url");
}
/** Build a DPoP keypair wrapper from a jose-generated CryptoKey pair. */
async function toDpopKeyPair(publicKey, privateKey) {
    const { exportJWK, calculateJwkThumbprint } = await loadJose();
    const publicJwk = await exportJWK(publicKey);
    const thumbprint = await calculateJwkThumbprint(publicJwk);
    return { publicKey, privateKey, publicJwk, thumbprint };
}
/** Generate a fresh DPoP keypair. jose/node:crypto only — no hand-rolled keygen. */
async function generateDpopKeyPair() {
    const { generateKeyPair } = await loadJose();
    const { publicKey, privateKey } = await generateKeyPair(exports.DPOP_ALG, { extractable: true });
    return toDpopKeyPair(publicKey, privateKey);
}
/**
 * Export a DPoP keypair as a single **private** JWK (which carries the public components too).
 * This is the on-disk form a persisted session stores so the SAME `jkt` can be reused after a
 * process restart — REQUIRED because CSS/node-oidc-provider binds the refresh token to the
 * original DPoP `jkt` and rejects a refresh signed by a different key (`invalid_grant`).
 *
 * The keypair is generated `extractable`, so `exportJWK` of the private key succeeds. The returned
 * JWK is a plain JSON object suitable for `JSON.stringify`.
 */
async function exportDpopKeyPairJwk(keyPair) {
    const { exportJWK } = await loadJose();
    return exportJWK(keyPair.privateKey);
}
/**
 * Reconstruct a {@link DpopKeyPair} from a private JWK previously produced by
 * {@link exportDpopKeyPairJwk}. The private key is imported directly; the public key is imported
 * from the same JWK with the private scalar `d` removed. The reconstructed keypair's thumbprint
 * equals the original (verified by round-trip), so the `jkt` binding survives a restart.
 *
 * The private key is imported `extractable` so a loaded session can be re-serialized — e.g. after a
 * mid-flight refresh re-persists the rotated tokens via {@link exportDpopKeyPairJwk}. This adds no
 * exposure beyond the session store, which already persists the private JWK to disk (chmod 600).
 */
async function importDpopKeyPairJwk(jwk) {
    if (!jwk.d) {
        throw new Error("importDpopKeyPairJwk: JWK has no private component (`d`); cannot reconstruct keypair.");
    }
    const { importJWK } = await loadJose();
    const { d: _d, ...publicJwkInput } = jwk;
    const privateKey = (await importJWK({ ...jwk, alg: exports.DPOP_ALG }, exports.DPOP_ALG, {
        extractable: true,
    }));
    const publicKey = (await importJWK({ ...publicJwkInput, alg: exports.DPOP_ALG }, exports.DPOP_ALG));
    return toDpopKeyPair(publicKey, privateKey);
}
/**
 * Mint a single-use DPoP proof JWS. A fresh `jti` is generated per call, so every proof
 * is unique; callers MUST NOT reuse a proof across requests.
 */
async function createDpopProof(params) {
    const { keyPair, htm, htu, accessToken, nonce } = params;
    const payload = {
        htm: htm.toUpperCase(),
        htu: canonicalHtu(htu),
        jti: (0, node_crypto_1.randomUUID)(),
    };
    if (accessToken !== undefined) {
        payload["ath"] = accessTokenHash(accessToken);
    }
    if (nonce !== undefined) {
        payload["nonce"] = nonce;
    }
    const { SignJWT } = await loadJose();
    return new SignJWT(payload)
        .setProtectedHeader({
        typ: "dpop+jwt",
        alg: exports.DPOP_ALG,
        jwk: keyPair.publicJwk,
    })
        .setIssuedAt()
        .sign(keyPair.privateKey);
}
//# sourceMappingURL=dpop.js.map