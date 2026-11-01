// AUTHORED-BY Claude Opus 4.8
/**
 * The bookmarks PARITY FACADE — a thin hand-written compat layer (the ~50–150 LOC
 * per-package facade the migration plan budgets, design §11) binding the GENERATED
 * generic model to `@jeswr/solid-bookmark`'s exact public API + vocab constants, so
 * the package's UNMODIFIED test suite can run against the generated wrapper as the
 * parity bar. This file is NOT generated — it is the one hand-written seam a
 * consumer writes to adopt a generated model under a domain-friendly surface.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { httpIriOrUndefined, isHttpIri } from "@jeswr/model-runtime";
import type { Store } from "n3";
import model, { type BookmarkData, entities } from "./generated/model.js";

export type { BookmarkData };
export { httpIriOrUndefined, isHttpIri };

const bm = entities.Bookmark;

/** `book:Bookmark` typed accessor — the generated wrapper + the domain `isBookmark`. */
export class Bookmark extends bm.Wrapper {
  /** Whether this subject is a `book:Bookmark`. */
  get isBookmark(): boolean {
    return this.isInstance;
  }
}

export const bookmarkSubject: (resourceUrl: string) => string = bm.subject;
export const buildBookmark: (resourceUrl: string, data: BookmarkData) => Store = bm.build;
export const parseBookmark: (
  resourceUrl: string,
  dataset: import("@rdfjs/types").DatasetCore,
) => BookmarkData | undefined = bm.parse;
export const serializeBookmark: (resourceUrl: string, data: BookmarkData) => Promise<string> =
  bm.serialize;
export const storeToTurtle: (store: Store) => Promise<string> = bm.storeToTurtle;
export const parseBookmarkTtl: (
  resourceUrl: string,
  body: string,
  contentType?: string | null,
) => Promise<BookmarkData | undefined> = bm.parseDocument;

// --- Vocabulary constants, derived from the generated manifest (the projection). ---
const P = model.prefixes;
export const BOOK = P.book as string;
export const SCHEMA = P.schema as string;
export const DCT = P.dct as string;
export const RDF = P.rdf as string;
export const RDFS = P.rdfs as string;
export const XSD = P.xsd as string;
export const CORE = "https://w3id.org/jeswr/core#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";

export const book = (local: string): string => `${BOOK}${local}`;
export const core = (local: string): string => `${CORE}${local}`;
export const schema = (local: string): string => `${SCHEMA}${local}`;
export const dct = (local: string): string => `${DCT}${local}`;
export const skos = (local: string): string => `${SKOS}${local}`;
export const rdf = (local: string): string => `${RDF}${local}`;
export const rdfs = (local: string): string => `${RDFS}${local}`;
export const xsd = (local: string): string => `${XSD}${local}`;

export const BOOKMARK_CLASS = bm.typeIri;
export const BOOK_ARCHIVED = book("archived");
export const BOOK_NOTES = book("notes");
export const SCHEMA_URL = schema("url");
export const SCHEMA_KEYWORDS = schema("keywords");
export const DCT_TITLE = dct("title");
export const DCT_DESCRIPTION = dct("description");
export const DCT_CREATED = dct("created");
export const DCT_MODIFIED = dct("modified");
export const RDF_TYPE = rdf("type");

export const PREFIXES = {
  book: BOOK,
  schema: SCHEMA,
  dct: DCT,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
} as const;

// --- Shape / ontology artifact readers (the generated shapes.ttl + source ontology). ---
const here = dirname(fileURLToPath(import.meta.url));
let cachedShape: string | undefined;
let cachedOntology: string | undefined;

/** The generated (skolemized) SHACL shape, as Turtle. */
export function bookmarkShapeTtl(): string {
  if (cachedShape === undefined) {
    cachedShape = readFileSync(join(here, "generated", "shapes.ttl"), "utf8");
  }
  return cachedShape;
}

/** The source bookmark ontology, as Turtle. */
export function bookmarkOntologyTtl(): string {
  if (cachedOntology === undefined) {
    cachedOntology = readFileSync(join(here, "bookmark.ttl"), "utf8");
  }
  return cachedOntology;
}
