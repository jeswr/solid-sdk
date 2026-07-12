// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for @jeswr/pod-drive — the non-throwaway data-layer core.
//
// The Next.js UI + create-solid-app scaffold, the cross-server E2E matrix, and
// the coverage-ratchet against every well-known server are tracked follow-ups
// (see README). What is published here is the typed RDF model that survives
// those follow-ups: read a Solid pod's containers/resources, register the app's
// DriveRoot class in the type index, and serialise writes via n3.Writer.

export {
  type ContainerListing,
  DriveAccessError,
  type ListOptions,
  listContainer,
} from "./drive.js";
export {
  DriveContainer,
  DriveContainerDataset,
  DriveResource,
  isFolder,
  readContainer,
  resourceSubject,
} from "./model.js";
export { iri, quadsToTurtle } from "./serialize.js";
export {
  buildDriveRootMarker,
  buildDriveRootRegistration,
  findDriveRoots,
  TypeRegistration,
} from "./type-index.js";
export {
  DCTERMS,
  LDP,
  PIM,
  PODDRIVE,
  POSIX,
  RDF,
  SOLID,
  XSD,
} from "./vocab.js";
