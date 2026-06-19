import type { Quad } from "@rdfjs/types";
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
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map