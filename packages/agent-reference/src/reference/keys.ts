// AUTHORED-BY Claude Opus 5.5
/**
 * Fixed test keys for reproducible reference runs. Each key is an Ed25519 key whose seed is
 * the SHA-256 of a public label, so anyone can re-derive it: these keys protect nothing and
 * must never be used outside synthetic runs. Ed25519 signatures are deterministic, so the
 * same run yields the same bytes.
 */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, createPrivateKey } from "crypto";
import type { JWK } from "jose";
import { loadSigningKey, type SigningKey } from "../mechanisms/jws.js";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** A synthetic Ed25519 signing key derived from `label`. Public test material only. */
export function testKey(label: string): Promise<SigningKey> {
  const seed = createHash("sha256").update(`agent-reference test key: ${label}`).digest();
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const jwk = createPrivateKey({ key: der, format: "der", type: "pkcs8" }).export({
    format: "jwk",
  }) as JWK;
  return loadSigningKey(jwk, "EdDSA");
}

/** Deterministic identifiers: one counter per scope (memoised, so a scope never repeats). */
export function idSource(prefix: string): (scope: string) => () => string {
  const counters = new Map<string, () => string>();
  return (scope) => {
    let next = counters.get(scope);
    if (!next) {
      let n = 0;
      const safe = scope.replace(/[^A-Za-z0-9-]/g, "-");
      next = () => `urn:awp:${prefix}:${safe}:${String(++n).padStart(4, "0")}`;
      counters.set(scope, next);
    }
    return next;
  };
}
