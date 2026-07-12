import type { Quad } from "@rdfjs/types";
/**
 * Serialise federation-registry quads to a string with `n3.Writer`. Defaults to
 * Turtle; pass an RDF media type (`text/turtle`, `application/n-triples`,
 * `application/n-quads`, `application/trig`) to choose another n3 format.
 */
export declare function serialize(quads: readonly Quad[], format?: string): Promise<string>;
/**
 * The structural shape of a finished build — quads plus a lazy serialise. The
 * public `BuiltGraph` (registry) and `BuiltStorage` (storage) interfaces are
 * structurally this; {@link built} produces it and each caller assigns it to its
 * own named public interface (which stays unchanged).
 */
export interface SerializableGraph {
    /** The constructed quads. */
    readonly quads: readonly Quad[];
    /** Serialise to Turtle (default) or another n3 format. */
    toString(format?: string): Promise<string>;
}
/**
 * Wrap a finished quad set as a {@link SerializableGraph} — `{ quads, toString }`
 * where `toString` lazily serialises via {@link serialize}. The single shared tail
 * of every build path (buildRegistry / buildMembership / describeStorage), so the
 * `{ quads, toString }` shape is constructed in ONE reviewed place.
 */
export declare function built(quads: readonly Quad[]): SerializableGraph;
//# sourceMappingURL=serialize.d.ts.map