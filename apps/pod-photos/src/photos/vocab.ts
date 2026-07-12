// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Vocabulary IRIs for the Pod Photos data layer — one place, so a predicate is
 * never re-typed and a typo can't silently mint a private term.
 *
 * The domain model is intentionally W3C/standard-vocabulary first:
 *
 * - **schema:Photograph** (schema.org) — the class for a single photo. Has the
 *   richest, most widely-recognised media vocabulary (`contentUrl`, `width`,
 *   `height`, `dateCreated`, `keywords`, `contentLocation`, `geo`).
 * - **EXIF → RDF** via the W3C `exif:` vocabulary
 *   (`http://www.w3.org/2003/12/exif/ns#`) — the canonical RDF rendering of the
 *   EXIF tag set (make, model, focal length, exposure, ISO, …). EXIF technical
 *   metadata is extracted out of the binary into these triples so it is
 *   queryable RDF rather than opaque file bytes.
 * - **schema:ImageGallery** — the class for an album/gallery; members are linked
 *   with `schema:hasPart` to the photos (and back with `schema:isPartOf`).
 * - **geo:** (W3C Basic Geo / WGS84) — `geo:lat` / `geo:long` for the capture
 *   location decimal degrees, the standard for point coordinates in RDF.
 *
 * The `exif:` and `geo:` namespaces are the published W3C namespaces; nothing
 * here is bespoke. All RDF is built/parsed through `@rdfjs/wrapper` typed
 * accessors + `n3.Writer` (house rule: never hand-build / hand-concat triples).
 */

/** schema.org. */
export const SCHEMA = 'https://schema.org/';
/** W3C EXIF-in-RDF vocabulary — the canonical RDF rendering of EXIF tags. */
export const EXIF = 'http://www.w3.org/2003/12/exif/ns#';
/** W3C Basic Geo (WGS84 lat/long) vocabulary. */
export const GEO = 'http://www.w3.org/2003/01/geo/wgs84_pos#';
/** rdf:type. */
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
/** Dublin Core terms (used for created/modified fallbacks if ever needed). */
export const DCT = 'http://purl.org/dc/terms/';
/** XSD datatype namespace. */
export const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** The RDF class a single photo is stamped + Type-Index-registered with. */
export const PHOTOGRAPH_CLASS = `${SCHEMA}Photograph`;
/** The RDF class an album/gallery is stamped + registered with. */
export const IMAGE_GALLERY_CLASS = `${SCHEMA}ImageGallery`;

/** Turtle prefix map for readable photo/album documents. */
export const PREFIXES = {
  schema: SCHEMA,
  exif: EXIF,
  geo: GEO,
  dct: DCT,
  xsd: XSD,
} as const;

/** Container slug (under the pod root) where photo descriptions live. */
export const PHOTOS_SLUG = 'photos/';
/** Container slug (under the pod root) where album descriptions live. */
export const ALBUMS_SLUG = 'albums/';
