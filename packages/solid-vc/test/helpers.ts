// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared test fixtures: a deterministic issuer keypair bound to a WebID-style
// verification method, and a resolveKey that returns its public key.

import type { KeyPair, VerifyCredentialOptions } from "../src/index.js";
import { generateKeyPairForSuite, type SuiteKeyType } from "../src/keys.js";

export const ISSUER = "https://alice.example/profile#me";
export const VERIFICATION_METHOD = `${ISSUER}#key-1`;
export const AGENT = "https://bob.example/agent#card";
export const ACL_READ = "http://www.w3.org/ns/auth/acl#Read";

/** A keypair whose verificationMethod is a fragment of the issuer WebID. */
export async function issuerKey(type: SuiteKeyType = "Ed25519"): Promise<KeyPair> {
  const key = await generateKeyPairForSuite(VERIFICATION_METHOD, type);
  return key;
}

/** A resolveKey closing over a set of (verificationMethod → publicKey) pairs. */
export function keyResolver(...keys: KeyPair[]): VerifyCredentialOptions["resolveKey"] {
  const map = new Map(keys.map((k) => [k.verificationMethod, k.publicKey]));
  return (vm: string) => map.get(vm);
}

/**
 * Assert a value is defined and narrow it — a test-only alternative to the
 * non-null `!` assertion (which the lint forbids), so a `undefined` slip is a
 * clear test failure rather than a runtime crash downstream.
 */
export function expectDefined<T>(value: T | undefined | null, label = "value"): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}
