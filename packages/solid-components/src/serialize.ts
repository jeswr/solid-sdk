// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Serialise an N3.Store / a quad list back to a Turtle STRING via `n3.Writer`
// (the suite-canonical serialiser — never hand-concatenate triples). The
// <jeswr-shacl-view> wrapper uses this to turn a pre-fetched + pre-parsed graph
// into the INLINE `data-shapes` / `data-values` string it hands to shacl-form,
// instead of giving shacl-form a URL to fetch itself (the §9 SSRF discipline).

import { type Quad, Store, Writer } from "n3";

/**
 * Serialise an N3 {@link Store} (or any quad iterable) to a Turtle string.
 *
 * We deliberately serialise the DEFAULT GRAPH only (`store.getQuads(... , null)`
 * already returns all quads; we strip the graph component so blank-node-scoped
 * shapes/data round-trip into shacl-form's single-graph loader). The Writer is
 * created without prefixes — shacl-form re-parses the string, so prefix prettiness
 * is irrelevant and omitting them avoids leaking an unexpected prefix map.
 */
export function serializeTurtle(quads: Store | Iterable<Quad>): Promise<string> {
  const store = quads instanceof Store ? quads : new Store([...quads]);
  return new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle" });
    for (const quad of store.getQuads(null, null, null, null)) {
      // Re-emit each quad into the default graph so the serialised Turtle is a
      // flat triples document (shacl-form's inline loader parses it as one graph).
      writer.addQuad(quad.subject, quad.predicate, quad.object);
    }
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}
