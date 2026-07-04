import type { Quad } from "@rdfjs/types";
/**
 * The VCDM 2.0 `digestMultibase` of a set of RDF quads: multibase(base58btc) of
 * the sha2-256 multihash over the RDFC-1.0 canonical N-Quads. Deterministic —
 * quad order and blank-node labelling do not affect the result.
 */
export declare function digestQuads(quads: readonly Quad[]): Promise<string>;
/**
 * The VCDM 2.0 `digestMultibase` of an RDF resource given as SOURCE TEXT
 * (Turtle by default; any `parseRdf`-supported content type). The content is
 * parsed and canonicalized first, so two serialisations of the SAME graph —
 * reordered triples, different prefixes, different blank-node labels — produce
 * the SAME digest, and any graph change produces a different one.
 *
 * FAIL-CLOSED guards (both throw — a digest silently computed over nothing
 * would let an empty/unparseable "policy" be bound and later "verified"):
 *  - unparseable content → the parser's error propagates;
 *  - an EMPTY graph → throws (an authorization bound to zero triples is
 *    meaningless and almost certainly a caller bug — wrong content type or an
 *    empty fetch body).
 */
export declare function digestRdfContent(content: string, contentType?: string): Promise<string>;
//# sourceMappingURL=digest.d.ts.map