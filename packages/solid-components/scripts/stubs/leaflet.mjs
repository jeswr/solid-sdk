// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Build-time STUB for `leaflet` (+ its plugins), aliased in by build-dist.mjs.
//
// @ulb-darmstadt/shacl-form's GEO widget plugin (`dist/plugins/*`) uses Leaflet to
// render a map editor for geo literals. The CORE shacl-form bundle we inline does
// NOT statically import leaflet (it is a separate plugin under `./plugins/*`), but
// we alias it defensively so the geo plugin, if ever pulled in transitively, never
// drags the heavy mapping stack into the committed dist/. <jeswr-shacl-view> is a
// read-only view that registers no geo plugin, so Leaflet is unreachable here.
// Accessing any member throws loudly.
const stub = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "[@jeswr/solid-components] leaflet is not bundled (the geo widget plugin " +
          "is excluded from the base). This is a bug if reached.",
      );
    },
  },
);
export default stub;
