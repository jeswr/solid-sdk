// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Vocabulary IRIs for the bookmark / read-it-later model (the data model for a
 * Linkding→Solid fork).
 *
 * **Mint the minimum; reuse dereferenceable standard terms for everything else.**
 * Per the suite federation policy (reuse established vocabularies rather than
 * minting new ones), this package mints exactly the **two** terms no widely-
 * deployed vocabulary already provides, both under the package namespace
 * `https://w3id.org/jeswr/bookmark#` (prefix `book:`):
 *
 * - **`book:Bookmark`** — the bookmark resource. Rooted into the gUFO-rebased
 *   suite core (`@jeswr/solid-federation-vocab`) via
 *   `rdfs:subClassOf core:InformationResource` (a saved bookmark IS an
 *   information resource — a stored reference to a web resource — which is the
 *   identity principle the `media:` sector classes also root in). It carries a
 *   thin `skos:closeMatch schema:BookmarkAction` ANNOTATION in the alignments
 *   (NOT `rdfs:subClassOf`): a Bookmark is the saved *thing*, whereas a
 *   `schema:BookmarkAction` is the *act* of bookmarking, so a hard subclass
 *   would be an over-strong identity claim. See {@link ../bookmark.ttl} for the
 *   rooting rationale and the alternative considered (rooting under
 *   `schema:BookmarkAction`), which was rejected for exactly this reason.
 * - **`book:archived`** — `xsd:boolean`; whether the bookmark is archived
 *   (Linkding's `is_archived`). schema.org/DC have no archived flag.
 * - **`book:notes`** — the user's free-text **markdown** notes literal (Linkding's
 *   `notes`). Distinct from {@link ../bookmark.ttl}'s reused `dct:description`
 *   (the short summary / Linkding `description`): notes are the longer markdown
 *   body, description the one-line blurb, so both are kept.
 *
 * **Reused terms (nothing minted):**
 * - **`schema:` — schema.org** (canonical `http://` scheme, matching the existing
 *   suite producers — `@jeswr/solid-task-model`'s `vocab.ts` uses the same
 *   scheme): `schema:url` (the bookmarked URL) and `schema:keywords` (tags — see
 *   the tags decision below).
 * - **`dct:` — Dublin Core Terms**: `dct:title` (Linkding `title`),
 *   `dct:description` (Linkding `description`), `dct:created` (Linkding
 *   `date_added`), `dct:modified` (Linkding `date_modified`).
 *
 * **Tags decision (documented per the proceed-without-greenlight rule).** Tags
 * are carried as **`schema:keywords`** string literals (one per tag), NOT as
 * `skos:Concept` resources. Rationale: Linkding tags are a flat, free-text label
 * list with no hierarchy, broader/narrower relations, or stable concept IRIs —
 * exactly what `schema:keywords` is for. Modelling each tag as a `skos:Concept`
 * would force minting/managing a concept IRI + a `skos:ConceptScheme` per pod for
 * no federation benefit, and `schema:keywords` is the term schema.org itself
 * recommends and that the broader web already uses for tags. (A future
 * SKOS-backed tag taxonomy can be layered on additively without changing this
 * core wire format — a `skos:Concept` whose `skos:prefLabel` equals a keyword.)
 *
 * The `book:` IRIs minted here are the SAME ones the
 * `@jeswr/solid-federation-vocab` media sector / `bookmarks#` alignments
 * reference, so this package is their canonical home, not a second dialect.
 */
/** This package's namespace — the bookmark / read-it-later vocabulary home. */
export const BOOK = "https://w3id.org/jeswr/bookmark#";
/**
 * The gUFO-rebased Solid Core ontology namespace
 * (`@jeswr/solid-federation-vocab`). `book:Bookmark` roots in
 * `core:InformationResource`; referenced here so the rooting predicate is
 * authored against the real IRI, not a string typo.
 */
export const CORE = "https://w3id.org/jeswr/core#";
/** schema.org (canonical http scheme, matching the suite producers) — `schema:url`, `schema:keywords`. */
export const SCHEMA = "http://schema.org/";
/** Dublin Core Terms — `dct:title`, `dct:description`, `dct:created`, `dct:modified`. */
export const DCT = "http://purl.org/dc/terms/";
/** SKOS — referenced only for the `skos:closeMatch` alignment annotation (see {@link ../bookmark.ttl}). */
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
/** RDF — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** RDF Schema — `rdfs:label`, `rdfs:subClassOf`. */
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
/** XSD datatypes — `xsd:boolean`, `xsd:dateTime`, `xsd:anyURI`. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
/** Build a `book:` term IRI. */
export const book = (local) => `${BOOK}${local}`;
/** Build a `core:` term IRI. */
export const core = (local) => `${CORE}${local}`;
/** Build a `schema:` term IRI. */
export const schema = (local) => `${SCHEMA}${local}`;
/** Build a `dct:` term IRI. */
export const dct = (local) => `${DCT}${local}`;
/** Build a `skos:` term IRI. */
export const skos = (local) => `${SKOS}${local}`;
/** Build an `rdf:` term IRI. */
export const rdf = (local) => `${RDF}${local}`;
/** Build an `rdfs:` term IRI. */
export const rdfs = (local) => `${RDFS}${local}`;
/** Build an `xsd:` term IRI. */
export const xsd = (local) => `${XSD}${local}`;
// --- The two minted terms (everything else is reused) ---
/** `rdf:type book:Bookmark` — the class every bookmark resource is stamped with. */
export const BOOKMARK_CLASS = book("Bookmark");
/** `book:archived` — `xsd:boolean`, whether the bookmark is archived (Linkding `is_archived`). */
export const BOOK_ARCHIVED = book("archived");
/** `book:notes` — the user's free-text markdown notes literal (Linkding `notes`). */
export const BOOK_NOTES = book("notes");
// --- Reused predicates (nothing minted) ---
/** `schema:url` — the bookmarked URL (an IRI). */
export const SCHEMA_URL = schema("url");
/** `schema:keywords` — a tag, as a string literal (one triple per tag). */
export const SCHEMA_KEYWORDS = schema("keywords");
/** `dct:title` — the bookmark title (Linkding `title`). */
export const DCT_TITLE = dct("title");
/** `dct:description` — the short summary / blurb (Linkding `description`). */
export const DCT_DESCRIPTION = dct("description");
/** `dct:created` — when the bookmark was added (Linkding `date_added`). */
export const DCT_CREATED = dct("created");
/** `dct:modified` — when the bookmark was last changed (Linkding `date_modified`). */
export const DCT_MODIFIED = dct("modified");
/** The `rdf:type` predicate IRI (convenience). */
export const RDF_TYPE = rdf("type");
/** Prefix map for an n3 Writer that serialises this model (pretty Turtle output). */
export const PREFIXES = {
    book: BOOK,
    schema: SCHEMA,
    dct: DCT,
    rdf: RDF,
    rdfs: RDFS,
    xsd: XSD,
};
//# sourceMappingURL=vocab.js.map