/**
 * The bookmark / read-it-later model — typed read/write accessors over a single
 * `book:Bookmark` resource (the data model for a Linkding→Solid fork).
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store` — no quad is ever hand-concatenated. Serialisation is `n3.Writer`;
 * parsing of a fetched body is `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * See {@link ./vocab.ts} for the vocabulary rationale (mint only `book:Bookmark`,
 * `book:archived`, `book:notes`; reuse `schema:url`/`schema:keywords` + Dublin
 * Core for the rest) and the tags decision (`schema:keywords` literals, not SKOS).
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
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
export declare function bookmarkSubject(resourceUrl: string): string;
/**
 * Typed `@rdfjs/wrapper` view of a single bookmark subject. Each accessor
 * reads/writes through the vetted mappers — no quad is ever hand-built. Construct
 * it on the bookmark subject IRI (conventionally `${resourceUrl}#it`).
 */
export declare class Bookmark extends TermWrapper {
    /** The bookmark subject IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `book:Bookmark`. Idempotent; returns `this` for chaining. */
    mark(): this;
    /** Whether this subject is a `book:Bookmark`. */
    get isBookmark(): boolean;
    /** `schema:url` — the bookmarked URL (an http(s) IRI). */
    get url(): string | undefined;
    set url(value: string | undefined);
    /** `dct:title`. */
    get title(): string | undefined;
    set title(value: string | undefined);
    /** `dct:description` — the short summary / blurb. */
    get description(): string | undefined;
    set description(value: string | undefined);
    /** `book:notes` — the user's markdown notes. */
    get notes(): string | undefined;
    set notes(value: string | undefined);
    /**
     * `book:archived` — `xsd:boolean`. Absent triple reads as `false` (a bookmark
     * is not archived until explicitly so). The setter writes `false` explicitly
     * too, so the boolean is always observable on the wire rather than relying on
     * absence — except `undefined` clears it.
     */
    get archived(): boolean;
    set archived(value: boolean | undefined);
    /** `dct:created`. */
    get created(): Date | undefined;
    set created(value: Date | undefined);
    /** `dct:modified`. */
    get modified(): Date | undefined;
    set modified(value: Date | undefined);
    /**
     * `schema:keywords` — the tags, as a live set of free-text labels (one triple
     * per tag). A `Set` rather than a list because tags are unordered + unique.
     */
    get tags(): Set<string>;
}
/**
 * Build the RDF `Store` for a bookmark from a plain {@link BookmarkData} object,
 * via the typed accessors (no hand-built quads). The `url` is dropped (and the
 * result is therefore NOT a valid bookmark) if it is not an absolute http(s) IRI
 * — untrusted input is never coerced into a malformed `NamedNode`. Tags that are
 * empty/whitespace-only are skipped.
 */
export declare function buildBookmark(resourceUrl: string, data: BookmarkData): Store;
/** Serialise a `Store` to Turtle with the bookmark prefixes (pretty output). */
export declare function storeToTurtle(store: Store): Promise<string>;
/** Build + serialise a bookmark to a Turtle document in one call. */
export declare function serializeBookmark(resourceUrl: string, data: BookmarkData): Promise<string>;
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
export declare function parseBookmark(resourceUrl: string, dataset: DatasetCore): BookmarkData | undefined;
/**
 * Parse a fetched RDF document into {@link BookmarkData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam — never a bespoke parser). `contentType`
 * is the response `Content-Type` header (any format `parseRdf` supports — Turtle,
 * N-Triples, N-Quads, TriG, JSON-LD); a missing/`null` header is coalesced to
 * `text/turtle`, the suite default. The resource URL doubles as the base IRI so a
 * relative `#it` subject resolves.
 */
export declare function parseBookmarkTtl(resourceUrl: string, body: string, contentType?: string | null): Promise<BookmarkData | undefined>;
//# sourceMappingURL=bookmark.d.ts.map