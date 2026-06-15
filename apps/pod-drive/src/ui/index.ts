// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Drive React view layer (`@jeswr/pod-drive/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic file-browser
// component + its data hook, sitting on top of the React-free data-layer core
// (`@jeswr/pod-drive`). React is a *peer* dependency so a data-layer-only
// consumer never pulls it in. The view never touches RDF/fetch directly — it
// drives the data layer through `useDriveListing`, and takes the authenticated
// fetch as an injected seam (post-#18 the create-solid-app shell patches the
// global fetch; until then a stub fetch makes it unit-testable today).

export { breadcrumbFor, type Crumb } from "./breadcrumb.js";
export { FileBrowser, type FileBrowserProps } from "./FileBrowser.js";
export {
  displayName,
  errorMessage,
  formatKind,
  formatModified,
  formatSize,
} from "./format.js";
export {
  type DriveListingState,
  type UseDriveListingOptions,
  useDriveListing,
} from "./useDriveListing.js";
