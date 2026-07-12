// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of an intent / SHACL-shape / Protocol-Document
// graph — a thin adapter over the shared `@jeswr/rdf-serialize` package (the single
// audited n3.Writer serialiser for the @jeswr suite; never hand-concatenated RDF).
//
// Phase-2 consolidation: the previous inline n3.Writer copy here was one of five
// near-identical `serialize.ts` files across the suite, from which
// `@jeswr/rdf-serialize` was extracted. This adapter preserves this package's exact
// public surface (`serialize(quads, format)`) and observable output — it keeps the
// M2 prefix map and the empty-graph-to-`""` short-circuit (the shared package's
// default `emptyAsEmptyString = true`, the behaviour 4 of the 5 copies — including
// this one — had) — while delegating the actual quad→string work to the one
// audited serialiser.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { A2A, ACL, DCTERMS, LDP, RDF, RDFS, SCHEMA, SH, XSD } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  a2a: A2A,
  schema: SCHEMA,
  acl: ACL,
  ldp: LDP,
  sh: SH,
  xsd: XSD,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS,
} as const;

/**
 * Serialise quads to a string with `@jeswr/rdf-serialize` (n3.Writer under the
 * hood). Defaults to Turtle; pass an RDF media type (`text/turtle`,
 * `application/n-triples`, `application/n-quads`, `application/trig`) to choose
 * another n3 format.
 *
 * An empty graph serialises to an empty string (the shared serialiser's default
 * `emptyAsEmptyString` behaviour) — n3.Writer otherwise emits the prefix preamble
 * even with no statements, so a zero-quad input round-trips as truly empty.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES);
}
