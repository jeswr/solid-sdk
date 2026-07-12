import type { Credential, DataIntegrityProof, VerifiableCredential } from "./types.js";
/**
 * Normalise a credential's `proof` (a single proof OR an array of proofs) to a
 * fresh array, preserving order and the original proof object references (so the
 * proof bytes are never rewritten). A credential with no `proof` yields `[]`.
 */
export declare function proofsOf(vc: VerifiableCredential): DataIntegrityProof[];
/**
 * Strip ALL proofs to recover the unsigned claim graph the signature(s) covered.
 * This is the exact pre-image both verify and countersign lower to RDF, so the
 * two agree byte-for-byte on what the proof set attests.
 */
export declare function unsigned(vc: VerifiableCredential): Credential;
//# sourceMappingURL=proof-set.d.ts.map