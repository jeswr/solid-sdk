// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * @jeswr/pod-photos — the typed RDF data layer for Pod Photos.
 *
 * A Solid photo & album app modelled on standard W3C/schema.org vocabularies:
 * `schema:Photograph` for a photo (with its EXIF metadata extracted out into
 * W3C `exif:` triples and capture location into `geo:`), and
 * `schema:ImageGallery` for an album (members linked with `schema:hasPart`).
 *
 * Read with `@jeswr/fetch-rdf`, extract with `@solid/object` / `@rdfjs/wrapper`,
 * serialise with `n3.Writer` — never a bespoke parser, never hand-built quads.
 */

// --- Vocabulary ---
export {
  ALBUMS_SLUG,
  DCT,
  EXIF,
  GEO,
  IMAGE_GALLERY_CLASS,
  PHOTOGRAPH_CLASS,
  PHOTOS_SLUG,
  PREFIXES,
  RDF_TYPE,
  SCHEMA,
  XSD,
} from './photos/vocab.js';

// --- EXIF model ---
export type { ExifGpsDms, ExifMetadata, GeoPoint } from './photos/exif.js';
export {
  dmsToDecimal,
  exifDateToIso,
  geoPointFromExif,
  isExifEmpty,
  normaliseExif,
} from './photos/exif.js';

// --- Photograph (schema:Photograph + exif:) ---
export type { Photo } from './photos/photograph.js';
export {
  buildPhoto,
  normaliseKeywords,
  parseKeywordsInput,
  parsePhoto,
  PhotographDoc,
} from './photos/photograph.js';

// --- Album (schema:ImageGallery) ---
export type { Album } from './photos/album.js';
export {
  addMember,
  buildAlbum,
  ImageGalleryDoc,
  normaliseMembers,
  parseAlbum,
  removeMember,
} from './photos/album.js';

// --- Stores (CRUD + list + type-index) ---
export type { StoredItem, StoreConfig } from './photos/store.js';
export { createStore, PodStore } from './photos/store.js';
export {
  ALBUMS_CONFIG,
  albumsStore,
  PHOTOS_CONFIG,
  photosStore,
} from './photos/stores.js';

// --- Pod I/O primitives ---
export type { ContainerEntry } from './pod/container.js';
export { listContainer } from './pod/container.js';
export { OutOfScopeError, ResourceDeleteError, ResourceWriteError } from './pod/errors.js';
export type { WriteResourceOptions } from './pod/rdf.js';
export {
  deleteResource,
  ensureContainer,
  freshRdf,
  nameFromUrl,
  readResource,
  serializeTurtle,
  toSlug,
  writeResource,
} from './pod/rdf.js';
export type {
  DesiredRegistration,
  EnsureRegistrationsResult,
  RegisteredLocation,
  TypeIndexLinks,
} from './pod/type-index.js';
export {
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  typeIndexLinks,
  TypeIndexDocument,
  TypeRegistration,
} from './pod/type-index.js';
