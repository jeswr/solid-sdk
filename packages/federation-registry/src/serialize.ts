// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Turtle / N-Triples serialisation of a federation registry graph via n3.Writer —
// the single sanctioned serialiser (never hand-concatenated RDF). JSON-LD is not
// produced here: callers who need JSON-LD already have the quads and the published
// `fedreg-context.jsonld`.

import type { Quad } from "@rdfjs/types";
import { Writer } from "n3";
import { DCAT, FEDAPP, FEDREG } from "./vocab.js";

/** Prefixes emitted in the serialised Turtle for readability. */
const PREFIXES = {
  fedreg: FEDREG,
  fedapp: FEDAPP,
  dcat: DCAT,
  dct: "http://purl.org/dc/terms/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
} as const;

/**
 * Serialise federation-registry quads to a string with `n3.Writer`. Defaults to
 * Turtle; pass an RDF media type (`text/turtle`, `application/n-triples`,
 * `application/n-quads`, `application/trig`) to choose another n3 format.
 */
export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
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
