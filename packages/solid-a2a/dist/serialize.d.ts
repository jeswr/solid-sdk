import type { Quad } from "@rdfjs/types";
/**
 * Serialise quads to a string with `n3.Writer`. Defaults to Turtle; pass an RDF
 * media type (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 */
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map