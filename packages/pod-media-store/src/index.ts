// AUTHORED-BY Claude Sonnet 5.5
/** @jeswr/pod-media-store: a binary plus one RDF description in a Solid or LWS pod. */
export type { MediaStoreError, MediaStoreErrorKind, MediaStoreReason, Result } from "./errors.js";
export type { ExposureCheck, ExposureState, OwnerOnlyLike } from "./exposure.js";
export { exposureFromOwnerOnly } from "./exposure.js";
export type { DeleteJournal, DeleteJournalEntry } from "./journal.js";
export { createMemoryJournal } from "./journal.js";
export { isInsideLibrary } from "./scope.js";
export type { Sniffed, Sniffer } from "./sniff.js";
export { defaultSniff } from "./sniff.js";
export { openMediaStore } from "./store.js";
export type {
  AttachThumbnailInput,
  BuildContext,
  Current,
  ListOptions,
  ListPage,
  MediaItem,
  MediaLocation,
  MediaStore,
  MediaStoreOptions,
  PutInput,
  PutOutcome,
  ResumeSummary,
  SerializedDescription,
  SkipCounts,
  SweepOptions,
  SweepSummary,
} from "./types.js";
