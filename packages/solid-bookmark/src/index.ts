// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-bookmark` — the RDF vocabulary + typed model for bookmarks /
 * read-it-later (the data model for a Linkding→Solid fork).
 *
 * Mints only the two terms standard vocabularies lack — `book:Bookmark` (rooted
 * `rdfs:subClassOf core:InformationResource`, the gUFO-rebased suite core),
 * `book:archived` (`xsd:boolean`) and `book:notes` (markdown) — and reuses
 * `schema:url` / `schema:keywords` + Dublin Core for everything else. Ships the
 * ontology TTL + a SHACL shape that pin the contract, plus typed read/write
 * accessors that never hand-build a triple.
 *
 * **Browser-safe root.** This entry point pulls in NO `node:*` built-ins — the
 * vocab + the typed model (`buildBookmark`/`parseBookmark`/…) run in the browser.
 * The shape/ontology file readers live behind the `@jeswr/solid-bookmark/shape`
 * subpath ONLY (they `readFileSync` the shipped `.ttl`s, so they are Node-only);
 * a browser bundle that imports from the root therefore never drags in `node:fs`.
 *
 * @packageDocumentation
 */

export {
  Bookmark,
  type BookmarkData,
  bookmarkSubject,
  buildBookmark,
  isHttpIri,
  parseBookmark,
  parseBookmarkTtl,
  serializeBookmark,
  storeToTurtle,
} from "./bookmark.js";
// NOTE: the Node-only shape/ontology readers (bookmarkShapeTtl,
// bookmarkOntologyTtl, *_PATH) are intentionally NOT re-exported here — they
// statically import node:fs/node:url, so re-exporting them from the root would
// pull Node built-ins into every browser bundle. Import them from the dedicated
// `@jeswr/solid-bookmark/shape` subpath instead.
export {
  BOOK,
  BOOK_ARCHIVED,
  BOOK_NOTES,
  BOOKMARK_CLASS,
  book,
  CORE,
  core,
  DCT,
  DCT_CREATED,
  DCT_DESCRIPTION,
  DCT_MODIFIED,
  DCT_TITLE,
  dct,
  PREFIXES,
  RDF,
  RDF_TYPE,
  RDFS,
  rdf,
  rdfs,
  SCHEMA,
  SCHEMA_KEYWORDS,
  SCHEMA_URL,
  SKOS,
  schema,
  skos,
  XSD,
  xsd,
} from "./vocab.js";
