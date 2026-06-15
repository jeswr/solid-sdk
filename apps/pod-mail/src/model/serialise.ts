// AUTHORED-BY Claude Opus 4.8
/**
 * Serialisation for the mail data layer. We serialise via `n3.Writer` only —
 * never by hand-concatenating Turtle. The resulting Turtle is what the store
 * layer conditional-PUTs back to the pod.
 */
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";
import { DCT, FOAF, LDP, RDF, RDFS, SCHEMA, SIOC, SOLID, XSD } from "./vocab.js";

/** Prefixes emitted in serialised mail documents (for human-readable Turtle). */
export const MailPrefixes: Record<string, string> = {
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
  schema: SCHEMA,
  sioc: SIOC,
  dct: DCT,
  foaf: FOAF,
  solid: SOLID,
  ldp: LDP,
};

/**
 * Serialise every quad in a dataset to a complete Turtle document, including
 * the `@prefix` declarations.
 *
 * NB: `n3.Writer.quadsToString` emits prefixed *names* but NOT the prefix
 * *declarations*, so its output does not round-trip. The `addQuads` + `end`
 * path does emit the declarations. For an in-memory writer (no file descriptor)
 * the `end` callback fires synchronously, so we can collect the result without
 * an async hop.
 */
export function serialiseToTurtle(dataset: DatasetCore): string {
  const writer = new Writer({ prefixes: MailPrefixes });
  writer.addQuads([...dataset]);
  // For an in-memory writer (no file descriptor) the `end` callback fires
  // synchronously, so `out` is always assigned before this function returns.
  let out = "";
  writer.end((error, result) => {
    /* v8 ignore next -- the in-memory n3.Writer never surfaces an error here;
       the guard is defensive and not reachable from a unit test. */
    if (error) throw error;
    out = result;
  });
  return out;
}
