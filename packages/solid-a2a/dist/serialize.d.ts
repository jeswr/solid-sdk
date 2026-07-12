import type { Quad } from "@rdfjs/types";
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
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map