// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of an intent / SHACL-shape / Protocol-Document
// graph via n3.Writer — the single sanctioned serialiser (never hand-concatenated
// RDF). Copied from M1 (@jeswr/solid-agent-card) with the prefix set adapted to
// the M2 vocabularies.

import type { Quad } from "@rdfjs/types";
import { Writer } from "n3";
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
 * Serialise quads to a string with `n3.Writer`. Defaults to Turtle; pass an RDF
 * media type (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  // An empty graph serialises to an empty string. n3.Writer otherwise emits the
  // prefix preamble even with no statements, producing a non-empty, content-free
  // document — short-circuit so a zero-quad input round-trips as truly empty.
  if (quads.length === 0) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format, prefixes: PREFIXES });
    writer.addQuads(quads as Quad[]);
    writer.end((error: Error | null, result: string) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
