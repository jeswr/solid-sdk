// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Custom Elements Manifest analyzer config — generates the committed
// `custom-elements.json` that makes @jeswr/solid-elements machine-discoverable to
// LLM codegen tooling (the codegen-framework #11 manifest pipeline, Phase 0).
//
// - `litelement: true` teaches the analyzer Lit's `static properties` / decorators
//   so each element's reactive props + attributes + events land in the manifest.
// - `packagejson: false` — we add the `customElements` field to package.json
//   ONCE, deterministically (the analyzer's auto-add joins outdir to cwd, which is
//   wrong for an absolute path and mutates package.json on every run — both bad
//   for a no-diff `check:manifest` gate). The committed field is the source of truth.
// - `outdir: ""` writes `custom-elements.json` at the repo root (the analyzer
//   joins outdir to cwd, so a relative "" == repo root); the gate regenerates +
//   diffs against the committed file, exactly like `check:dist`.
// - `solidBindingPlugin` lifts the suite `@solid-*` binding tags into the manifest.

import { solidBindingPlugin } from "./scripts/cem/solid-binding-plugin.mjs";

export default {
  // The element modules + the package barrel. We deliberately scope OUT the
  // non-element modules (react wrappers, the auth adapter, theme/feedback core,
  // internal helpers): they define no custom elements, so the analyzer would emit
  // empty `javascript-module` entries that add noise without binding information.
  globs: ["src/components/*.ts", "src/index.ts"],
  litelement: true,
  // We own the package.json `customElements` field (added once, by hand).
  packagejson: false,
  outdir: "",
  plugins: [solidBindingPlugin()],
};
