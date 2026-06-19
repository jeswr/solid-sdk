import type { Quad } from "@rdfjs/types";
/**
 * Serialise federation quads to a string with `n3.Writer` (via
 * `@jeswr/rdf-serialize`). Defaults to Turtle; pass an RDF media type
 * (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 *
 * `emptyAsEmptyString: false` reproduces federation-client's long-standing
 * behaviour: an empty graph emits the bare prefix preamble that `n3.Writer`
 * produces (a non-empty string), NOT the `""` short-circuit that four of the
 * five consolidated suite copies use. (`n3.Writer` already emits `""` for the
 * line-based N-Triples / N-Quads formats with no quads — that is its own
 * behaviour, not the short-circuit, and is unchanged here.)
 */
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map