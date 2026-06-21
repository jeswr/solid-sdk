// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Build-time STUB for `rdfxml-streaming-parser`, aliased in by build-dist.mjs.
//
// @ulb-darmstadt/shacl-form STATICALLY imports `RdfXmlParser` from
// `rdfxml-streaming-parser`, but only uses it inside its own loader when an INPUT
// string is detected as RDF/XML (`<?xml`). <jeswr-shacl-view> ALWAYS passes
// shacl-form inline TURTLE (never RDF/XML), so this code path is unreachable from
// the wrapper. We alias it to this stub to keep RDF/XML parsing OUT of the
// committed dist/ (the §8 "do NOT pull rdfxml-streaming-parser into the base"
// requirement). Constructing it throws loudly — it should never be reached.
export class RdfXmlParser {
  constructor() {
    throw new Error(
      "[@jeswr/solid-components] rdfxml-streaming-parser is not bundled. " +
        "<jeswr-shacl-view> only passes inline Turtle to shacl-form; an RDF/XML " +
        "code path was reached unexpectedly. This is a bug.",
    );
  }
}
