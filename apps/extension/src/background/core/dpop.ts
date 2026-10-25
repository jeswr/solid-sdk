// AUTHORED-BY Claude Opus 4.8
/**
 * DPoP proof generation (RFC 9449) for the MV3 service-worker context — the
 * security-critical core of the Solid-OIDC path.
 *
 * This MIRRORS the discipline of `@jeswr/solid-dpop` (`src/dpop.ts`), reused as the
 * canonical spec, but is reimplemented on **Web Crypto + jose** rather than
 * `node:crypto`: an extension service worker has no Node `crypto` module, so the suite
 * package's `node:crypto`-backed `createHash`/`randomUUID` cannot run here. The proof
 * SHAPE is identical to the package's so behaviour matches the rest of the suite:
 *
 *   - header  `typ` = "dpop+jwt", `alg` = ES256, `jwk` = the PUBLIC key (kty/crv/x/y only).
 *   - payload `htm` = HTTP method (upper-cased), `htu` = canonical URI (no query/fragment),
 *             `iat` = now, `jti` = unique nonce, and — when presenting an access token —
 *             `ath` = base64url(SHA-256(access_token)). RFC 9449 §4.2 / §6.1. A
 *             server-supplied `nonce` (RFC 9449 §8) is echoed when present.
 *
 * The `ath` claim binds the proof to a specific access token; the `cnf.jkt` binds the
 * token to this keypair. Nothing is hand-rolled beyond calling jose + Web Crypto: all
 * JWS/base64url operations go through jose; the only direct crypto call is Web Crypto's
 * SHA-256 for the `ath` digest (jose exposes no helper for it), exactly as the suite
 * package does with node:crypto.
 */

import * as jose from 'jose';

/** Signature algorithm used for the DPoP keypair. ES256 is the Solid-OIDC default. */
export const DPOP_ALG = 'ES256' as const;

/** The EC named curve paired with {@link DPOP_ALG}. */
export const DPOP_CURVE = 'P-256' as const;

/**
 * Compute the RFC 9449 §4.2 `htu`: the request URI with query and fragment removed.
 * The scheme + authority + path are normalised by the URL parser. Throws on an
 * unparseable URI (a proof for a non-URL request must not be minted).
 */
export function canonicalHtu(uri: string): string {
  const u = new URL(uri);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Compute the `ath` claim: base64url( SHA-256( ASCII(access_token) ) ). RFC 9449 §4.2.
 * Web Crypto's SHA-256 + jose-style base64url (no padding, URL-safe alphabet). This is
 * a digest, not a crypto primitive.
 */
export async function accessTokenHash(accessToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(accessToken);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return jose.base64url.encode(new Uint8Array(digest));
}

/**
 * RFC 7638 JWK thumbprint (`jkt`) of a DPoP public key — the value a DPoP-bound access/
 * refresh token's `cnf.jkt` claim is checked against server-side. Recorded on `StoredSession`
 * at key-mint time so a later SW wake can tell "the persisted key still matches what THIS
 * session expects" from "the persisted key was unexpectedly lost or replaced" (see
 * `dpop-key-store.ts` `loadSessionDpopKeyPair`) — the two call for different handling: the
 * latter must never be silently papered over with a freshly-minted, unrelated key.
 */
export async function dpopThumbprint(publicKey: CryptoKey): Promise<string> {
  const jwk = (await crypto.subtle.exportKey('jwk', publicKey)) as jose.JWK;
  return jose.calculateJwkThumbprint(jwk, 'sha256');
}

/**
 * Generate a fresh DPoP keypair as **non-extractable** Web Crypto keys.
 *
 * SECURITY (hardened — see `core/dpop-key-db.ts` for the full rationale): the private key
 * is `extractable: false`, so `crypto.subtle.exportKey(...)` on it always rejects — the
 * private scalar can never be serialised out of Web Crypto, not even by code running in
 * this same service-worker context. Persistence across the MV3 service-worker's aggressive
 * kill/restart cycle is handled by `core/dpop-key-store.ts`, which writes the live
 * `CryptoKeyPair` object directly into IndexedDB (structured-clone-safe for non-extractable
 * keys per the WebCrypto spec) rather than exporting it to JWK. Only the PUBLIC key is ever
 * exported (e.g. for the DPoP proof header's `jwk` — see {@link createDpopProof} below).
 */
export async function generateDpopKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: DPOP_CURVE }, false, [
    'sign',
    'verify',
  ]);
}

export interface DpopProofParams {
  readonly keyPair: CryptoKeyPair;
  readonly htm: string;
  readonly htu: string;
  /** Present iff this proof accompanies an access token (resource requests; some /token flows). */
  readonly accessToken?: string;
  /** Server-supplied DPoP nonce (RFC 9449 §8) echoed back in the proof, if any. */
  readonly nonce?: string;
}

/**
 * Mint a single-use DPoP proof JWS. A fresh `jti` is generated per call, so every proof
 * is unique; callers MUST NOT reuse a proof across requests. The header `jwk` carries
 * ONLY the public components (kty/crv/x/y) — never the private scalar `d`.
 */
export async function createDpopProof(params: DpopProofParams): Promise<string> {
  const { keyPair, htm, htu, accessToken, nonce } = params;

  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  const headerJwk = {
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
    y: publicJwk.y,
  };

  const payload: Record<string, unknown> = {
    htm: htm.toUpperCase(),
    htu: canonicalHtu(htu),
    jti: crypto.randomUUID(),
  };
  if (accessToken !== undefined) {
    payload.ath = await accessTokenHash(accessToken);
  }
  if (nonce !== undefined) {
    payload.nonce = nonce;
  }

  return new jose.SignJWT(payload)
    .setProtectedHeader({
      typ: 'dpop+jwt',
      alg: DPOP_ALG,
      jwk: headerJwk as jose.JWK,
    })
    .setIssuedAt()
    .sign(keyPair.privateKey);
}
