// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Custom Elements Manifest analyzer config — generates the committed
// `custom-elements.json` that makes @jeswr/solid-components machine-discoverable to
// LLM codegen tooling (the codegen-framework #11 manifest pipeline). The manifest
// is the CODEGEN CONTRACT: each per-class read element carries the suite `@solid-*`
// JSDoc tags (`@solid-class` / `@solid-shape` / `@solid-mode` / `@solid-cardinality`)
// so a codegen tool can answer "which element renders this RDF class?" straight from
// the generated artifact, and the committed `resolveComponent` static map is derived
// from these same edges (one source of truth, zero network at runtime).
//
// REUSED FROM @jeswr/solid-elements PHASE 0 (do NOT mint a divergent setup):
//  - `litelement: true` teaches the analyzer Lit's `static properties` so each
//    element's reactive props + attributes + events land in the manifest.
//  - `packagejson: false` — we own the package.json `customElements` field (added
//    once, by hand); the analyzer's auto-add joins outdir to cwd (wrong for an
//    absolute path + mutates package.json every run — both break a no-diff gate).
//  - `outdir: ""` writes `custom-elements.json` at the repo root (the analyzer joins
//    outdir to cwd, so "" == repo root); the `check:manifest` gate regenerates +
//    diffs against the committed file, exactly like `check:dist`.
//  - `solidBindingPlugin` lifts the suite `@solid-*` binding tags into the manifest,
//    strips Lit `state: true` internal props, and drops `export type` re-exports
//    from the `kind: js` export list (the Phase-0 type-only-export-exclusion fix).

import { solidBindingPlugin } from "./scripts/cem/solid-binding-plugin.mjs";

export default {
  // The element modules + the package barrel. We deliberately scope OUT the
  // non-element modules (the React wrappers, the DataController/errors helpers, the
  // resolver map): they define no custom elements, so the analyzer would emit empty
  // `javascript-module` entries that add noise without binding information. The
  // pre-existing <jeswr-shacl-view> lives under src/components/ too, so the glob
  // already covers it.
  globs: ["src/components/*.ts", "src/index.ts"],
  litelement: true,
  // We own the package.json `customElements` field (added once, by hand).
  packagejson: false,
  outdir: "",
  plugins: [solidBindingPlugin()],
};
