// AUTHORED-BY Codex GPT-5
//
// Serialise an N3.Store / a quad list back to a Turtle STRING via the shared
// suite serializer (never hand-concatenate triples). The
// <jeswr-shacl-view> wrapper uses this to turn a pre-fetched + pre-parsed graph
// into the INLINE `data-shapes` / `data-values` string it hands to shacl-form,
// instead of giving shacl-form a URL to fetch itself (the §9 SSRF discipline).

import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, type Quad, Store } from "n3";

/**
 * Serialise an N3 {@link Store} (or any quad iterable) to a Turtle string.
 *
 * We deliberately serialise the DEFAULT GRAPH only (`store.getQuads(... , null)`
 * already returns all quads; we strip the graph component so blank-node-scoped
 * shapes/data round-trip into shacl-form's single-graph loader). Serialization
 * uses no prefixes — shacl-form re-parses the string, so prefix prettiness is
 * irrelevant and omitting them avoids leaking an unexpected prefix map.
 */
export function serializeTurtle(quads: Store | Iterable<Quad>): Promise<string> {
  const store = quads instanceof Store ? quads : new Store([...quads]);
  const flatQuads = store.getQuads(null, null, null, null).map((quad) =>
    // Re-emit each quad into the default graph so the serialised Turtle is a
    // flat triples document (shacl-form's inline loader parses it as one graph).
    DataFactory.quad(quad.subject, quad.predicate, quad.object, DataFactory.defaultGraph()),
  );
  return serialize(flatQuads, {
    format: "text/turtle",
    emptyAsEmptyString: false,
  });
}
