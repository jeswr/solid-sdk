// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Docs React view layer (`@jeswr/pod-docs/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic
// document-browser component + its data hook, sitting on top of the React-free
// data-layer core (`@jeswr/pod-docs`). React is a *peer* dependency so a
// data-layer-only consumer never pulls it in. The view never touches RDF/fetch
// directly — it drives the data layer (`DocsStore`) through `useDocsListing`,
// and takes the authenticated fetch as an injected seam (post-#18 the
// create-solid-app shell patches the global fetch; until then a stub fetch makes
// it unit-testable today).

export {
  DocumentBrowser,
  type DocumentBrowserProps,
} from "./DocumentBrowser.js";
export {
  displayTitle,
  errorMessage,
  formatModified,
} from "./format.js";
export {
  type DocsListingState,
  type SaveStatus,
  type UseDocsListingOptions,
  useDocsListing,
} from "./useDocsListing.js";
