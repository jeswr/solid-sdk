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

import { createHash, randomUUID } from "node:crypto";
import type { CryptoKey, JWK } from "jose";

/**
 * jose@6 is ESM-only. A *static* import makes the CJS build emit `require("jose")`, which throws
 * `ERR_REQUIRE_ESM` on Node releases where require(ESM) is not enabled (e.g. Node 20.x < 20.19,
 * 22.x < 22.12), breaking CJS consumers such as n8n-solid. We instead load jose lazily via a true
 * dynamic `import()`, which is valid from CJS on every supported Node. Under Vitest/ESM this runs
 * as-is; in the CJS build, tsc down-levels `import()` to `require()`, so the build:cjs step
 * rewrites that one call back into a real `import()` (see scripts/fix-cjs-jose-import.mjs).
 */
let josePromise: Promise<typeof import("jose")> | undefined;
function loadJose(): Promise<typeof import("jose")> {
  if (!josePromise) {
    josePromise = import("jose");
  }
  return josePromise;
}

/** Signature algorithm used for the DPoP keypair. ES256 is the Solid-OIDC default. */
export const DPOP_ALG = "ES256" as const;

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
export function canonicalHtu(uri: string): string {
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
export function accessTokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}

/** Build a DPoP keypair wrapper from a jose-generated CryptoKey pair. */
export async function toDpopKeyPair(
  publicKey: CryptoKey,
  privateKey: CryptoKey,
): Promise<DpopKeyPair> {
  const { exportJWK, calculateJwkThumbprint } = await loadJose();
  const publicJwk = await exportJWK(publicKey);
  const thumbprint = await calculateJwkThumbprint(publicJwk);
  return { publicKey, privateKey, publicJwk, thumbprint };
}

/** Generate a fresh DPoP keypair. jose/node:crypto only — no hand-rolled keygen. */
export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const { generateKeyPair } = await loadJose();
  const { publicKey, privateKey } = await generateKeyPair(DPOP_ALG, { extractable: true });
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
export async function exportDpopKeyPairJwk(keyPair: DpopKeyPair): Promise<JWK> {
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
export async function importDpopKeyPairJwk(jwk: JWK): Promise<DpopKeyPair> {
  if (!jwk.d) {
    throw new Error(
      "importDpopKeyPairJwk: JWK has no private component (`d`); cannot reconstruct keypair.",
    );
  }
  const { importJWK } = await loadJose();
  const { d: _d, ...publicJwkInput } = jwk;
  const privateKey = (await importJWK({ ...jwk, alg: DPOP_ALG }, DPOP_ALG, {
    extractable: true,
  })) as CryptoKey;
  const publicKey = (await importJWK({ ...publicJwkInput, alg: DPOP_ALG }, DPOP_ALG)) as CryptoKey;
  return toDpopKeyPair(publicKey, privateKey);
}

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
export async function createDpopProof(params: DpopProofParams): Promise<string> {
  const { keyPair, htm, htu, accessToken, nonce } = params;

  const payload: Record<string, unknown> = {
    htm: htm.toUpperCase(),
    htu: canonicalHtu(htu),
    jti: randomUUID(),
  };
  if (accessToken !== undefined) {
    payload.ath = accessTokenHash(accessToken);
  }
  if (nonce !== undefined) {
    payload.nonce = nonce;
  }

  const { SignJWT } = await loadJose();
  return new SignJWT(payload)
    .setProtectedHeader({
      typ: "dpop+jwt",
      alg: DPOP_ALG,
      jwk: keyPair.publicJwk,
    })
    .setIssuedAt()
    .sign(keyPair.privateKey);
}
