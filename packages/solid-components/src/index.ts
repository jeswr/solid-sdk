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

// Side-effect imports: register the custom elements. Importing the package root
// registers EVERY element (each module self-`customElements.define`s), so a consumer
// `import "@jeswr/solid-components"` gets <jeswr-shacl-view>, the per-class read
// elements, and the <solid-view> composer all defined.
import "./components/shacl-view.js";
import "./components/task-list.js";
import "./components/contact-list.js";
import "./components/profile-card.js";
import "./components/bookmark-list.js";
import "./components/collection.js";
import "./components/solid-view.js";

export { JeswrBookmarkList } from "./components/bookmark-list.js";
export { JeswrCollection, type TypeIndexEntry } from "./components/collection.js";
export { JeswrContactList } from "./components/contact-list.js";
export { JeswrProfileCard } from "./components/profile-card.js";
// The read-only SHACL view element + its source/seam types.
export { JeswrShaclView } from "./components/shacl-view.js";
// The shared read-element base + DOM-boundary helpers (for custom elements).
export {
  AbstractReadElement,
  formatDate,
  type ReadStatus,
  safeHref,
  safeMailto,
  safeTel,
  stripScheme,
} from "./components/shared.js";
// The composition element.
export { SolidView } from "./components/solid-view.js";
// The per-class read elements.
export { JeswrTaskList } from "./components/task-list.js";
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
// The component resolver: the committed static map + the selection function.
export {
  type ComponentEntry,
  type ComponentMode,
  collectTypes,
  RESOLVER_ENTRIES,
  type ResolveComponentOptions,
  resolveComponent,
  resolveComponentForClass,
  type TypeScanDataset,
} from "./resolver.js";
// The Turtle serialiser helper (n3.Writer-based; never hand-built triples).
export { serializeTurtle } from "./serialize.js";
export {
  countTurtleQuads,
  type FetchSeam,
  type GraphSource,
  neutraliseValuesTurtle,
  type ResolveOptions,
  resolveGraphToTurtle,
  VALUES_SUBJECT_SENTINEL,
} from "./shacl-view-fetch.js";
// The RDF class IRIs the components bind to (the resolver-map keys).
export {
  BOOKMARK_CLASS,
  LDP_BASIC_CONTAINER,
  LDP_CONTAINER,
  RDF_TYPE,
  TASK_CLASS,
  VCARD_ADDRESS_BOOK,
  VCARD_INDIVIDUAL,
} from "./vocab.js";
