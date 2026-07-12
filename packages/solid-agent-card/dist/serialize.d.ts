import type { Quad } from "@rdfjs/types";
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
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map