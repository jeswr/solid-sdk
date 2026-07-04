// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The shared "proof set" primitives — the ONE place that (a) normalises a
// credential's one-or-many `proof` to an array and (b) strips ALL proofs to
// recover the unsigned claim graph the signature(s) covered.
//
// These are LOAD-BEARING for correctness: both {@link verifyCredential} (which
// recomputes the claim graph to check each proof) and {@link countersign} (which
// signs a NEW proof over that same graph) MUST derive the signed bytes IDENTICALLY.
// Extracting them here guarantees a countersignature covers byte-for-byte the same
// quads the first proof covered — a proof SET (parallel independent attestations
// over the same claims), never a proof CHAIN (a signature over graph-plus-prior-proof).

import type { Credential, DataIntegrityProof, VerifiableCredential } from "./types.js";

/**
 * Normalise a credential's `proof` (a single proof OR an array of proofs) to a
 * fresh array, preserving order and the original proof object references (so the
 * proof bytes are never rewritten). A credential with no `proof` yields `[]`.
 */
export function proofsOf(vc: VerifiableCredential): DataIntegrityProof[] {
  const proof = vc.proof;
  if (proof === undefined) return [];
  return Array.isArray(proof)
    ? [...(proof as readonly DataIntegrityProof[])]
    : [proof as DataIntegrityProof];
}

/**
 * Strip ALL proofs to recover the unsigned claim graph the signature(s) covered.
 * This is the exact pre-image both verify and countersign lower to RDF, so the
 * two agree byte-for-byte on what the proof set attests.
 */
export function unsigned(vc: VerifiableCredential): Credential {
  const { proof: _proof, ...rest } = vc;
  return rest as Credential;
}
