// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Key generation + JWK import/export for the bundled Data Integrity suite. All
// key material goes through `jose` / WebCrypto — NEVER a hand-rolled keygen (the
// same rule PSS's auth layer + @jeswr/solid-dpop follow). Asymmetric only:
// Ed25519 (eddsa-rdfc-2022) and P-256 (ecdsa-rdfc-2019).

import { exportJWK, type GenerateKeyPairOptions, generateKeyPair, importJWK, type JWK } from "jose";
import type { KeyPair } from "./types.js";

/** The asymmetric key types the bundled suite supports. */
export type SuiteKeyType = "Ed25519" | "P-256";

/** Map a key type to its (jose alg, cryptosuite). */
function paramsFor(type: SuiteKeyType): {
  alg: string;
  cryptosuite: string;
  options?: GenerateKeyPairOptions;
} {
  if (type === "Ed25519") {
    return {
      alg: "EdDSA",
      cryptosuite: "eddsa-rdfc-2022",
      options: { crv: "Ed25519", extractable: true },
    };
  }
  return { alg: "ES256", cryptosuite: "ecdsa-rdfc-2019", options: { extractable: true } };
}

/**
 * Generate a fresh asymmetric {@link KeyPair} for a verification method IRI. The
 * keys are WebCrypto `CryptoKey`s (extractable, so they can be JWK-exported for
 * persistence). `jose`/WebCrypto only — no hand-rolled keygen.
 */
export async function generateKeyPairForSuite(
  verificationMethod: string,
  type: SuiteKeyType = "Ed25519",
): Promise<KeyPair> {
  const { alg, options } = paramsFor(type);
  const { privateKey, publicKey } = await generateKeyPair(alg, options);
  return {
    verificationMethod,
    privateKey: privateKey as CryptoKey,
    publicKey: publicKey as CryptoKey,
  };
}

/** The cryptosuite id matching a key type (so a caller picks the right suite). */
export function cryptosuiteForKeyType(type: SuiteKeyType): string {
  return paramsFor(type).cryptosuite;
}

/** Export a key's public JWK (for publishing a verification method / a WebID profile). */
export async function exportPublicJwk(key: KeyPair): Promise<JWK> {
  return exportJWK(key.publicKey);
}

/** Export a key's private JWK (for secure persistence — handle with care). */
export async function exportPrivateJwk(key: KeyPair): Promise<JWK> {
  return exportJWK(key.privateKey);
}

/** Import a public verification key from a JWK (for the verifier `resolveKey`). */
export async function importPublicKey(jwk: JWK): Promise<CryptoKey> {
  const alg = algForJwk(jwk);
  return (await importJWK(jwk, alg, { extractable: true })) as CryptoKey;
}

/** Import a {@link KeyPair} from a private JWK + its verification method IRI. */
export async function importKeyPair(verificationMethod: string, privateJwk: JWK): Promise<KeyPair> {
  const alg = algForJwk(privateJwk);
  const privateKey = (await importJWK(privateJwk, alg, { extractable: true })) as CryptoKey;
  // Derive the public JWK by stripping private members, then import it.
  const { d: _d, ...pub } = privateJwk as JWK & { d?: string };
  const publicKey = (await importJWK(pub, alg, { extractable: true })) as CryptoKey;
  return { verificationMethod, privateKey, publicKey };
}

/** Infer the JOSE `alg` for a JWK (so import binds the correct algorithm). */
function algForJwk(jwk: JWK): string {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  throw new Error(`unsupported JWK: kty=${jwk.kty} crv=${jwk.crv ?? "?"}`);
}
