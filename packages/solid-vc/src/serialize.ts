// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of a VC graph via n3.Writer — the single
// sanctioned serialiser (never hand-concatenated RDF). Same pattern as the M1–M3
// suite packages, with the prefix set adapted to the VC / Data Integrity vocab.

import type { Quad } from "@rdfjs/types";
import { Writer } from "n3";
import { ACL, DC_CREATED, ODRL, RDF, RDFS, SCHEMA, SEC, SVC, VC, XSD } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  cred: VC,
  sec: SEC,
  svc: SVC,
  acl: ACL,
  odrl: ODRL,
  schema: SCHEMA,
  xsd: XSD,
  rdf: RDF,
  rdfs: RDFS,
  dcterms: DC_CREATED.replace("created", ""),
} as const;

/**
 * Serialise quads to a string with `n3.Writer`. Defaults to Turtle; pass an RDF
 * media type (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  // An empty graph serialises to an empty string (n3.Writer otherwise emits a
  // content-free prefix preamble) — so a zero-quad input round-trips as empty.
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
