import type { Quad } from "@rdfjs/types";
/**
 * Serialise quads to a string with `n3.Writer` (via {@link legacySerialize} from
 * `@jeswr/rdf-serialize`). Defaults to Turtle; pass an RDF media type
 * (`text/turtle`, `application/n-triples`, `application/n-quads`,
 * `application/trig`) to choose another n3 format.
 *
 * An empty graph serialises to an empty string (n3.Writer otherwise emits a
 * content-free prefix preamble) — `legacySerialize`'s `emptyAsEmptyString`
 * default (`true`) preserves that behaviour, so a zero-quad input round-trips as
 * empty exactly as before.
 */
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
//# sourceMappingURL=serialize.d.ts.map