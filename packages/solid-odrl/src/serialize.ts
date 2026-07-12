// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of an ODRL policy graph — now a THIN ADAPTER
// over the shared, single-audited suite serialiser `@jeswr/rdf-serialize`
// (Phase-2 consolidation). `@jeswr/rdf-serialize` was extracted from the
// near-identical `src/serialize.ts` copies in this package and its M1/M2/M4
// siblings, so this delegation is behaviour-preserving: `legacySerialize` is the
// exact positional `serialize(quads, format)` shape with the same `n3.Writer`
// pipeline and the same empty-graph short-circuit (`emptyAsEmptyString = true`,
// the 4-of-5 majority default that this package always used). The only local
// concern that remains here is the ODRL-specific prefix map.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { ACL, DCTERMS, DPV, ODRL, RDF, RDFS, XSD } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  odrl: ODRL,
  acl: ACL,
  dpv: DPV,
  xsd: XSD,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS,
} as const;

/**
 * Serialise quads to a string via the shared `@jeswr/rdf-serialize` serialiser
 * (`n3.Writer` under the hood — never hand-concatenated). Defaults to Turtle;
 * pass an RDF media type (`text/turtle`, `application/n-triples`,
 * `application/n-quads`, `application/trig`) to choose another n3 format.
 *
 * An empty graph serialises to an empty string (rather than the bare prefix
 * preamble `n3.Writer` would otherwise emit) — preserved via
 * `legacySerialize`'s default `emptyAsEmptyString = true`.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES);
}
