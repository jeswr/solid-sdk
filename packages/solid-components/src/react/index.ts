// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-components/react — React wrappers for the Web Components.
//
// PHASE 1 PLACEHOLDER. The foundation ships the framework-agnostic custom element
// (<jeswr-shacl-view>) and the DataController seam; the typed React component
// wrappers (via `@lit/react`'s `createComponent`) land alongside the first batch
// of per-class components in a later phase. For now this subexport re-exports the
// element CLASS (so a React app can `createComponent` it itself if needed) and the
// DataController, which is framework-agnostic and usable from React directly.
//
// The native custom element works in React today — register it with
// `import "@jeswr/solid-components"` and use `<jeswr-shacl-view>` in JSX, setting
// the object properties (`.shapes` / `.values` / `.fetch`) via a ref. The typed
// wrapper here exists to remove that ref boilerplate; it is intentionally minimal
// in Phase 1.

export { JeswrBookmarkForm } from "../components/bookmark-form.js";
export { JeswrContactForm } from "../components/contact-form.js";
// The read-only chat-message list element (registered by the package root; exposed
// here so a React app can `@lit/react` `createComponent` it without ref boilerplate).
export { JeswrMessageList } from "../components/message-list.js";
export type { MergeSaveCallback, SaveEventDetail } from "../components/shacl-form-edit.js";
export { JeswrShaclForm } from "../components/shacl-form-edit.js";
export { JeswrShaclView } from "../components/shacl-view.js";
export { JeswrTaskForm } from "../components/task-form.js";
export {
  type ContainerChild,
  type ContainerListing,
  DataController,
  type DataSeam,
  type ListOptions,
  type ReadOptions,
  type ReadResult,
} from "../data-controller.js";
// Phase-2 WRITE-path controller + its types (framework-agnostic, usable from React).
export {
  type ConditionalWriteOptions,
  DataWriter,
  type SaveMergedOptions,
  type SaveStatus,
  type ShapedNodeMutator,
  UnconditionalOverwriteError,
  WriteConflictError,
  WriteFailedError,
  type WriteResult,
  WriteScopeError,
  type WriteSeam,
} from "../data-writer.js";
export {
  AccessDeniedError,
  classifyReadError,
  DataControllerError,
  DataFormatError,
  NetworkError,
  NotFoundError,
} from "../errors.js";
export type {
  FetchSeam,
  GraphSource,
  ResolveOptions,
} from "../shacl-view-fetch.js";
