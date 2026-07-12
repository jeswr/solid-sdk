import { type Quad, Store } from "n3";
/**
 * Serialise an N3 {@link Store} (or any quad iterable) to a Turtle string.
 *
 * We deliberately serialise the DEFAULT GRAPH only (`store.getQuads(... , null)`
 * already returns all quads; we strip the graph component so blank-node-scoped
 * shapes/data round-trip into shacl-form's single-graph loader). The Writer is
 * created without prefixes — shacl-form re-parses the string, so prefix prettiness
 * is irrelevant and omitting them avoids leaking an unexpected prefix map.
 */
export declare function serializeTurtle(quads: Store | Iterable<Quad>): Promise<string>;
