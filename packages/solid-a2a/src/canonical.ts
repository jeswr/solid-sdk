// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Canonical N-Quads serialisation for content-addressing a Protocol Document
// (protocol.ts), computed with **RDFC-1.0** — the RDF Dataset Canonicalization
// algorithm, a W3C Recommendation (2024-05-21) — via `rdf-canonize`, the W3C
// reference implementation (digitalbazaar/rdf-canonize).
//
// WHY RDFC-1.0 (and not a bespoke scheme): a content hash only works as a trust
// anchor if *independent* implementations produce byte-identical canonical bytes
// over the same graph. RDFC-1.0 is the standard that guarantees this, so a peer
// using ANY conformant canonicalizer computes the same `sha256:` protocol hash.
// The a2a-rdf extension spec (https://w3id.org/jeswr/a2a-rdf/v1, §"Content
// addressing") normatively requires exactly this construction: RDFC-1.0 canonical
// N-Quads, then SHA-256. An earlier version of this package used a bespoke
// deterministic sorted-N-Quads form (iterative blank-node refinement) that was
// NOT RDFC-1.0 and therefore did not agree with independent implementations; this
// module now delegates to the reference algorithm so hashes are interoperable.
//
// The canonicalization is graph-isomorphism-invariant: two datasets that are equal
// up to blank-node renaming + quad order canonicalize to the same string (and thus
// the same hash) — the property a content address needs.

import type { Quad } from "@rdfjs/types";
import canonize from "rdf-canonize";

/** The W3C Recommendation algorithm name understood by rdf-canonize (>= 4.x). */
const RDFC_1_0 = "RDFC-1.0" as const;

/**
 * Canonicalize quads to their RDFC-1.0 canonical N-Quads serialisation. The output
 * is stable across runs / builders / parse round-trips and byte-identical for any
 * conformant RDFC-1.0 implementation, so a SHA-256 over it is a portable content
 * address. An empty input canonicalizes to the empty string.
 *
 * Async because the reference implementation's public API (`canonize`) is async;
 * see `hashQuads` in protocol.ts for the hashing wrapper.
 */
export function canonicalNQuads(quads: readonly Quad[]): Promise<string> {
  // rdf-canonize accepts a readonly array of RDF/JS quads as a dataset; RDFC-1.0
  // is deterministic and does not mutate the input.
  return canonize.canonize(quads, { algorithm: RDFC_1_0 });
}
