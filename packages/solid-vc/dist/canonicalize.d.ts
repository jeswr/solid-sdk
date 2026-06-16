import type { Quad } from "@rdfjs/types";
/**
 * Canonicalise a set of RDF/JS quads to the RDFC-1.0 canonical N-Quads string.
 * Delegates to `rdf-canonize` (the W3C reference implementation) — the only
 * sanctioned canonicaliser. Deterministic: the same graph always yields the same
 * bytes, regardless of input quad order or blank-node labelling.
 */
export declare function canonicalNQuads(quads: readonly Quad[]): Promise<string>;
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
export declare function dataIntegrityHash(documentQuads: readonly Quad[], proofOptionsQuads: readonly Quad[]): Promise<Uint8Array>;
//# sourceMappingURL=canonicalize.d.ts.map