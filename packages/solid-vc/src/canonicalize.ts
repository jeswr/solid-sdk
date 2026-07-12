// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The W3C Data Integrity "transformation" + "hashing" steps for the `*-rdfc-*`
// cryptosuites: RDF Dataset Canonicalization (RDFC-1.0, W3C Recommendation) over
// the document quads, then SHA-256 of the canonical N-Quads octets. This is the
// SECURITY-CRITICAL pre-image the signature is computed over — it MUST be done
// through the vetted `rdf-canonize` (the W3C RDFC-1.0 reference implementation),
// NEVER a bespoke canonicaliser, or the signature binds to the wrong bytes.
//
// Per Data Integrity §"Hashing", the signing input for an `-rdfc-` suite is:
//   hash(canonicalize(proofConfig)) || hash(canonicalize(documentWithoutProof))
// i.e. the SHA-256 of the canonical proof options concatenated with the SHA-256
// of the canonical credential graph (proof node removed). We follow that exactly.

import { createHash } from "node:crypto";
import type { Quad } from "@rdfjs/types";
import { canonize } from "rdf-canonize";

/**
 * Canonicalise a set of RDF/JS quads to the RDFC-1.0 canonical N-Quads string.
 * Delegates to `rdf-canonize` (the W3C reference implementation) — the only
 * sanctioned canonicaliser. Deterministic: the same graph always yields the same
 * bytes, regardless of input quad order or blank-node labelling.
 */
export async function canonicalNQuads(quads: readonly Quad[]): Promise<string> {
  return (await canonize(quads as Quad[], {
    algorithm: "RDFC-1.0",
    format: "application/n-quads",
  })) as string;
}

/** SHA-256 of a UTF-8 string, as raw bytes. */
function sha256(input: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input, "utf8").digest());
}

/**
 * Compute the Data Integrity signing input for an `-rdfc-` cryptosuite:
 * `SHA-256(canonicalize(proofOptionsQuads))` concatenated with
 * `SHA-256(canonicalize(documentQuads))` — 64 bytes total. The signature is then
 * computed over (verified against) exactly these octets.
 *
 * Binding BOTH the proof options (cryptosuite, verificationMethod, proofPurpose,
 * created) and the document into one hashed pre-image is what makes the proof
 * non-malleable: an attacker cannot swap the verification method, downgrade the
 * suite, or change the purpose without invalidating the signature.
 */
export async function dataIntegrityHash(
  documentQuads: readonly Quad[],
  proofOptionsQuads: readonly Quad[],
): Promise<Uint8Array> {
  const docCanon = await canonicalNQuads(documentQuads);
  const proofCanon = await canonicalNQuads(proofOptionsQuads);
  const proofHash = sha256(proofCanon);
  const docHash = sha256(docCanon);
  const out = new Uint8Array(proofHash.length + docHash.length);
  out.set(proofHash, 0);
  out.set(docHash, proofHash.length);
  return out;
}
