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
import type { CryptoKey, JWK } from "jose";
/** Signature algorithm used for the DPoP keypair. ES256 is the Solid-OIDC default. */
export declare const DPOP_ALG: "ES256";
export interface DpopKeyPair {
    readonly publicKey: CryptoKey;
    readonly privateKey: CryptoKey;
    /** Public JWK embedded in every proof header. */
    readonly publicJwk: JWK;
    /** RFC 7638 thumbprint of the public JWK — the `jkt` the token is bound to. */
    readonly thumbprint: string;
}
/**
 * Compute the RFC 9449 §4.2 `htu`: the request URI with query and fragment removed.
 * The scheme + authority + path are normalised by the URL parser.
 */
export declare function canonicalHtu(uri: string): string;
/**
 * Compute the `ath` claim: base64url( SHA-256( ASCII(access_token) ) ).  RFC 9449 §4.2.
 * jose has no public helper for this, so we use node:crypto's SHA-256 and jose-style
 * base64url (no padding, URL-safe alphabet). This is a digest, not a crypto primitive.
 */
export declare function accessTokenHash(accessToken: string): string;
/** Build a DPoP keypair wrapper from a jose-generated CryptoKey pair. */
export declare function toDpopKeyPair(publicKey: CryptoKey, privateKey: CryptoKey): Promise<DpopKeyPair>;
/** Generate a fresh DPoP keypair. jose/node:crypto only — no hand-rolled keygen. */
export declare function generateDpopKeyPair(): Promise<DpopKeyPair>;
/**
 * Export a DPoP keypair as a single **private** JWK (which carries the public components too).
 * This is the on-disk form a persisted session stores so the SAME `jkt` can be reused after a
 * process restart — REQUIRED because CSS/node-oidc-provider binds the refresh token to the
 * original DPoP `jkt` and rejects a refresh signed by a different key (`invalid_grant`).
 *
 * The keypair is generated `extractable`, so `exportJWK` of the private key succeeds. The returned
 * JWK is a plain JSON object suitable for `JSON.stringify`.
 */
export declare function exportDpopKeyPairJwk(keyPair: DpopKeyPair): Promise<JWK>;
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
export declare function importDpopKeyPairJwk(jwk: JWK): Promise<DpopKeyPair>;
export interface DpopProofParams {
    readonly keyPair: DpopKeyPair;
    readonly htm: string;
    readonly htu: string;
    /** Present iff this proof accompanies an access token (resource requests; some /token flows). */
    readonly accessToken?: string;
    /** Server-supplied DPoP nonce (RFC 9449 §8) echoed back in the proof, if any. */
    readonly nonce?: string;
}
/**
 * Mint a single-use DPoP proof JWS. A fresh `jti` is generated per call, so every proof
 * is unique; callers MUST NOT reuse a proof across requests.
 */
export declare function createDpopProof(params: DpopProofParams): Promise<string>;
//# sourceMappingURL=dpop.d.ts.map