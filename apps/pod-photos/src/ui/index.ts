// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Photos React view layer (`@jeswr/pod-photos/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic photo-gallery
// component + its data hook, sitting on top of the React-free data-layer core
// (`@jeswr/pod-photos`). React is a *peer* dependency so a data-layer-only
// consumer never pulls it in. The view never touches RDF/fetch directly — it
// drives the data layer through `usePhotoGallery`, and takes the authenticated
// fetch as an injected seam (post-#18 the create-solid-app shell patches the
// global fetch; until then a stub fetch makes it unit-testable today).

export { breadcrumbFor, type Crumb } from './breadcrumb.js';
export {
  errorMessage,
  photoAltText,
  photoDimensions,
  photoTitle,
} from './format.js';
export {
  type FolderEntry,
  GalleryAccessError,
  type GalleryListing,
  type ListGalleryOptions,
  listGallery,
  type PhotoEntry,
} from './gallery.js';
export { PhotoGallery, type PhotoGalleryProps } from './PhotoGallery.js';
export {
  type PhotoGalleryState,
  type UsePhotoGalleryOptions,
  usePhotoGallery,
} from './usePhotoGallery.js';
