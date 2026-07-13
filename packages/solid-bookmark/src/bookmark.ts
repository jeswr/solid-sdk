// AUTHORED-BY Codex GPT-5
/**
 * The bookmark / read-it-later model — typed read/write accessors over a single
 * `book:Bookmark` resource (the data model for a Linkding→Solid fork).
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store` — no quad is ever hand-concatenated. Serialisation uses the shared
 * `@jeswr/rdf-serialize`; parsing uses `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * See {@link ./vocab.ts} for the vocabulary rationale (mint only `book:Bookmark`,
 * `book:archived`, `book:notes`; reuse `schema:url`/`schema:keywords` + Dublin
 * Core for the rest) and the tags decision (`schema:keywords` literals, not SKOS).
 */

import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import {
  BOOK_ARCHIVED,
  BOOK_NOTES,
  BOOKMARK_CLASS,
  DCT_CREATED,
  DCT_DESCRIPTION,
  DCT_MODIFIED,
  DCT_TITLE,
  PREFIXES,
  RDF_TYPE,
  SCHEMA_KEYWORDS,
  SCHEMA_URL,
} from "./vocab.js";

// Re-exported so the `.` entry point keeps exposing the untrusted-input filter.
export { isHttpIri } from "./iri.js";

/**
 * A bookmark as a plain, serialisable object — the shape an app's UI works with.
 * Field names map to the Linkding model so a Linkding→Solid fork is a flat
 * projection; the RDF predicate for each is named in its doc comment.
 */
export interface BookmarkData {
  /** `schema:url` — the bookmarked URL (the one required field; an http(s) IRI). */
  url: string;
  /** `dct:title` — the bookmark title (Linkding `title`). */
  title?: string;
  /** `dct:description` — the short summary / blurb (Linkding `description`). */
  description?: string;
  /** `book:notes` — the user's free-text markdown notes (Linkding `notes`). */
  notes?: string;
  /** `book:archived` — whether the bookmark is archived (Linkding `is_archived`). Defaults to false. */
  archived?: boolean;
  /** `schema:keywords` — tags, as free-text labels (one triple per tag; Linkding `tag_names`). */
  tags?: string[];
  /** `dct:created` — when the bookmark was added (Linkding `date_added`). */
  created?: Date;
  /** `dct:modified` — when the bookmark was last changed (Linkding `date_modified`). */
  modified?: Date;
}

/** The conventional subject IRI for a bookmark stored at `resourceUrl`. */
export function bookmarkSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/**
 * Assign `target[key] = value` ONLY when `value` is defined — the "copy an
 * optional field through, omitting it when absent" pattern, so a plain data
 * projection reads as a flat list of field copies. Typed so each call binds a
 * single named field of `T` to a value of that field's exact type.
 */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Typed `@rdfjs/wrapper` view of a single bookmark subject. Each accessor
 * reads/writes through the vetted mappers — no quad is ever hand-built. Construct
 * it on the bookmark subject IRI (conventionally `${resourceUrl}#it`).
 */
export class Bookmark extends TermWrapper {
  /** The bookmark subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `book:Bookmark`. Idempotent; returns `this` for chaining. */
  mark(): this {
    this.types.add(BOOKMARK_CLASS);
    return this;
  }

  /** Whether this subject is a `book:Bookmark`. */
  get isBookmark(): boolean {
    return this.types.has(BOOKMARK_CLASS);
  }

  /** `schema:url` — the bookmarked URL (an http(s) IRI). */
  get url(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHEMA_URL, NamedNodeAs.string);
  }
  set url(value: string | undefined) {
    OptionalAs.object(this, SCHEMA_URL, value, NamedNodeFrom.string);
  }

  /** `dct:title`. */
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
  }

  /** `dct:description` — the short summary / blurb. */
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_DESCRIPTION, LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, DCT_DESCRIPTION, value, LiteralFrom.string);
  }

  /** `book:notes` — the user's markdown notes. */
  get notes(): string | undefined {
    return OptionalFrom.subjectPredicate(this, BOOK_NOTES, LiteralAs.string);
  }
  set notes(value: string | undefined) {
    OptionalAs.object(this, BOOK_NOTES, value, LiteralFrom.string);
  }

  /**
   * `book:archived` — `xsd:boolean`. Absent triple reads as `false` (a bookmark
   * is not archived until explicitly so). The setter writes `false` explicitly
   * too, so the boolean is always observable on the wire rather than relying on
   * absence — except `undefined` clears it.
   */
  get archived(): boolean {
    return OptionalFrom.subjectPredicate(this, BOOK_ARCHIVED, LiteralAs.boolean) ?? false;
  }
  set archived(value: boolean | undefined) {
    OptionalAs.object(this, BOOK_ARCHIVED, value, LiteralFrom.boolean);
  }

  /** `dct:created`. */
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_CREATED, LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, DCT_CREATED, value, LiteralFrom.dateTime);
  }

  /** `dct:modified`. */
  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_MODIFIED, LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, DCT_MODIFIED, value, LiteralFrom.dateTime);
  }

  /**
   * `schema:keywords` — the tags, as a live set of free-text labels (one triple
   * per tag). A `Set` rather than a list because tags are unordered + unique.
   */
  get tags(): Set<string> {
    return SetFrom.subjectPredicate(this, SCHEMA_KEYWORDS, LiteralAs.string, LiteralFrom.string);
  }
}

/**
 * Build the RDF `Store` for a bookmark from a plain {@link BookmarkData} object,
 * via the typed accessors (no hand-built quads). The `url` is dropped (and the
 * result is therefore NOT a valid bookmark) if it is not an absolute http(s) IRI
 * — untrusted input is never coerced into a malformed `NamedNode`. Tags that are
 * empty/whitespace-only are skipped.
 */
export function buildBookmark(resourceUrl: string, data: BookmarkData): Store {
  const store = new Store();
  const doc = new Bookmark(bookmarkSubject(resourceUrl), store, DataFactory).mark();

  // url is the required field, but still filtered: a non-http(s) value is dropped
  // rather than written, so a hostile `javascript:`/`data:` URL never lands.
  doc.url = httpIriOrUndefined(data.url);
  // Empty-string text fields are DELIBERATELY dropped (`|| undefined`), not
  // written as noise `dct:title ""` triples: an empty title/description/notes
  // carries no information, the SHACL shape makes all three optional, and this
  // matches the suite convention (task-model's `data.title || undefined`). So a
  // round-trip of `{ title: "" }` yields a bookmark with no title — intentional.
  doc.title = data.title || undefined;
  doc.description = data.description || undefined;
  doc.notes = data.notes || undefined;
  // Always write the boolean (default false) so the flag is explicit on the wire.
  doc.archived = data.archived ?? false;
  doc.created = data.created ?? new Date();
  doc.modified = data.modified;

  const tags = doc.tags;
  for (const raw of data.tags ?? []) {
    const tag = raw.trim();
    if (tag.length > 0) tags.add(tag);
  }

  return store;
}

/** Serialise a `Store` to Turtle with the bookmark prefixes (pretty output). */
export function storeToTurtle(store: Store): Promise<string> {
  return serialize([...store], {
    format: "text/turtle",
    prefixes: { ...PREFIXES },
    emptyAsEmptyString: false,
  });
}

/** Build + serialise a bookmark to a Turtle document in one call. */
export function serializeBookmark(resourceUrl: string, data: BookmarkData): Promise<string> {
  return storeToTurtle(buildBookmark(resourceUrl, data));
}

/**
 * Read a {@link BookmarkData} back from an RDF dataset (the inverse of
 * {@link buildBookmark}). Returns `undefined` if the subject is not a
 * `book:Bookmark`, OR if its `schema:url` is missing / not an absolute http(s)
 * IRI — pod data is untrusted, so the SAME http(s)-only filter the writer applies
 * is enforced on read (the suite's filter-on-read-AND-write rule): a hostile
 * `schema:url <javascript:...>` / `<data:...>` stored by any route is never
 * surfaced to a caller as a clickable bookmark URL. (A bookmark with no usable
 * URL is not a usable bookmark, and the SHACL shape flags it non-conforming
 * anyway.) Absent optional fields are omitted from the result. Tags are returned
 * sorted for a stable, comparable projection (the wire `Set` is unordered).
 */
export function parseBookmark(resourceUrl: string, dataset: DatasetCore): BookmarkData | undefined {
  const doc = new Bookmark(bookmarkSubject(resourceUrl), dataset, DataFactory);
  if (!doc.isBookmark) return undefined;

  // url is the one required field AND a security-sensitive surface (it becomes a
  // clickable link). Reject the whole bookmark if it is absent or not http(s),
  // and return the CANONICAL href (httpIriOrUndefined normalizes) — never surface
  // a non-http(s) or whitespace-bearing IRI a caller might render as a link.
  const url = httpIriOrUndefined(doc.url);
  if (url === undefined) return undefined;

  const data: BookmarkData = { url };
  setIfDefined(data, "title", doc.title);
  setIfDefined(data, "description", doc.description);
  setIfDefined(data, "notes", doc.notes);
  // archived is always meaningful (false when absent), so always project it.
  data.archived = doc.archived;
  setIfDefined(data, "created", doc.created);
  setIfDefined(data, "modified", doc.modified);

  const tags = [...doc.tags].sort();
  if (tags.length > 0) data.tags = tags;
  return data;
}

/**
 * Parse a fetched RDF document into {@link BookmarkData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam — never a bespoke parser). `contentType`
 * is the response `Content-Type` header (any format `parseRdf` supports — Turtle,
 * N-Triples, N-Quads, TriG, JSON-LD); a missing/`null` header is coalesced to
 * `text/turtle`, the suite default. The resource URL doubles as the base IRI so a
 * relative `#it` subject resolves.
 */
export async function parseBookmarkTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<BookmarkData | undefined> {
  // Coalesce BEFORE parsing: callers routinely pass `Response.headers.get(
  // "content-type")`, which is `null` for a header-less response. The default
  // parameter only fires for `undefined`, so honour the documented ⇒ text/turtle
  // default for an explicit `null` too.
  const resolvedContentType = contentType ?? "text/turtle";
  // Lazy import keeps the (Node-targeted) fetch-rdf dep off any pure-parse path a
  // consumer might tree-shake — and matches how the apps import it.
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
  return parseBookmark(resourceUrl, dataset);
}
