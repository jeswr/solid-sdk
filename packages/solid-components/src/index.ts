// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-components — codegen-friendly, framework-agnostic Solid Web
// Components (Lit 3). PHASE 1 FOUNDATION:
//
//   1. DataController — the injectable READ seam (typed RDF read, container
//      listing, conditional GET, the 4-class error taxonomy). READ ONLY.
//   2. <jeswr-shacl-view> — a read-only (view-mode) wrapper over
//      @ulb-darmstadt/shacl-form, with the SSRF discipline that it never lets
//      shacl-form fetch (no `*-url` attrs, always `data-ignore-owl-imports`),
//      pre-fetching + inlining the shape + data itself.
//
// Importing this module SIDE-EFFECT registers <jeswr-shacl-view> (the
// `customElements.define` is guarded, so a re-import / double-load is safe).
//
//   import "@jeswr/solid-components";              // registers <jeswr-shacl-view>
//   import { DataController } from "@jeswr/solid-components";
//
// The committed dist/ inlines @ulb-darmstadt/shacl-form + n3 + shacl-engine +
// @jeswr/fetch-rdf (esbuild), so a `github:jeswr/solid-components#main` install
// imports with no build step under ignore-scripts=true. The optional widget peers
// (jsonld / rdfxml-streaming-parser / leaflet) are NOT bundled; @jeswr/guarded-
// fetch is loaded by dynamic import only for a user-configured remote source.

// Side-effect import: register the custom element.
import "./components/shacl-view.js";

// The read-only SHACL view element + its source/seam types.
export { JeswrShaclView } from "./components/shacl-view.js";
// The read-path controller + its seam/result types.
export {
  type ContainerChild,
  type ContainerListing,
  DataController,
  type DataSeam,
  type ListOptions,
  type ReadOptions,
  type ReadResult,
} from "./data-controller.js";
// The 4-class read-error taxonomy.
export {
  AccessDeniedError,
  classifyReadError,
  DataControllerError,
  DataFormatError,
  NetworkError,
  NotFoundError,
} from "./errors.js";
// The Turtle serialiser helper (n3.Writer-based; never hand-built triples).
export { serializeTurtle } from "./serialize.js";
export {
  type FetchSeam,
  type GraphSource,
  type ResolveOptions,
  resolveGraphToTurtle,
} from "./shacl-view-fetch.js";
