// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Build-time STUB for `jsonld`, aliased in by scripts/build-dist.mjs.
//
// @ulb-darmstadt/shacl-form STATICALLY imports `jsonld` (a ~500 KB optional widget
// dependency) at the top of its bundle, but its ONLY use is converting a JSON-LD
// *input string* to N-Quads inside shacl-form's own loader. <jeswr-shacl-view>
// NEVER hands shacl-form a JSON-LD string: it pre-parses every graph with
// @jeswr/fetch-rdf and ALWAYS passes shacl-form INLINE TURTLE (serialize.ts). So
// the `jsonld.toRDF` code path is unreachable from this wrapper.
//
// We therefore alias `jsonld` to this no-op stub at build time, keeping the heavy
// dep OUT of the committed dist/ (the §8 "do NOT pull jsonld into the base"
// requirement) while still satisfying shacl-form's static import. If shacl-form
// ever DID reach this path (it cannot, via our wrapper), the call throws loudly
// rather than silently mis-parsing.
const notBundled = () => {
  throw new Error(
    "[@jeswr/solid-components] jsonld is not bundled. <jeswr-shacl-view> only " +
      "passes inline Turtle to shacl-form; a JSON-LD code path was reached " +
      "unexpectedly. This is a bug.",
  );
};

export default {
  toRDF: notBundled,
  fromRDF: notBundled,
  expand: notBundled,
  compact: notBundled,
  flatten: notBundled,
  frame: notBundled,
  normalize: notBundled,
  canonize: notBundled,
};
