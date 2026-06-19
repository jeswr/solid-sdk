// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of an agent-description (or pointer) graph.
// A THIN ADAPTER over the suite's single sanctioned serialiser
// `@jeswr/rdf-serialize` (n3.Writer under the hood — never hand-concatenated RDF).
// This package keeps only its own prefix map; the serialisation mechanics live in
// the one shared, audited implementation.

import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { ANP_AD, DCTERMS, FOAF, INTEROP, RDF, RDFS, SCHEMA } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  ad: ANP_AD,
  interop: INTEROP,
  schema: SCHEMA,
  foaf: FOAF,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS,
} as const;

/**
 * Serialise quads to a string. Defaults to Turtle; pass an RDF media type
 * (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 *
 * Delegates to `@jeswr/rdf-serialize`'s `legacySerialize` with this package's
 * prefix map. The empty-graph short-circuit (a zero-quad input serialises to the
 * empty string rather than n3.Writer's content-free prefix preamble) is the
 * shared serialiser's default behaviour (`emptyAsEmptyString = true`).
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES);
}
