// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-docs/src/vocab.ts.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The RDF vocabulary Pod Docs reads and writes — namespace prefixes and the
 * exact predicate/class IRIs of the rich-text document model.
 *
 * **The document model.** A Pod-Docs document is one resource per document under
 * the app container, with its primary subject at `<resource>#it`. The model is
 * deliberately built from *existing, dereferenceable* vocabularies wherever one
 * fits, with a small app-namespace (`pd:`) only for the rich-text body and the
 * provenance-history glue:
 *
 *   - `pd:Document` (`https://jeswr.org/ns/pod-docs#Document`) — the class, the
 *     app's primary type-index class and the `fedapp:produces`/`consumes` shape.
 *   - `dct:title` — the document title.
 *   - `dct:created` / `dct:modified` — xsd:dateTime stamps.
 *   - `dct:creator` — the authoring WebID (an IRI).
 *   - `pd:body` — the rich-text body, stored as a single content literal.
 *   - `pd:format` — the body's content format (a media-type string, e.g.
 *     `text/html`, `text/markdown`, `application/json` for a portable doc model).
 *     The *editor engine* that interprets the body is a separate ADR; the data
 *     layer is format-agnostic and round-trips whatever it is given.
 *
 * **Provenance history.** Each saved revision is a `prov:Entity` (W3C PROV-O)
 * that `prov:wasRevisionOf` the prior revision, carrying `prov:generatedAtTime`,
 * `prov:wasAttributedTo` (the editor WebID) and the body+format snapshot. The
 * document's current state is `pd:currentRevision` → the latest entity. This is
 * the durable, vocabulary-correct way to keep a document's edit history in the
 * pod, independent of any editor (CRDT / OT / plain overwrite are all expressible
 * on top of it). The history-compaction strategy is a follow-up ADR.
 *
 * House rule: nothing here builds RDF — these are IRI constants consumed by the
 * typed `@rdfjs/wrapper` accessors in `document.ts` and `type-index.ts`.
 */

import { NS as SUITE_NS } from "@jeswr/suite-vocab";

/** Namespace base IRIs. */
export const NS = {
  PD: SUITE_NS.POD_DOCS,
  DCT: SUITE_NS.DCT,
  PROV: SUITE_NS.PROV,
  RDF: SUITE_NS.RDF,
  XSD: SUITE_NS.XSD,
  SOLID: SUITE_NS.SOLID,
  RDFS: SUITE_NS.RDFS,
  SCHEMA: SUITE_NS.SCHEMA,
  LDP: SUITE_NS.LDP,
} as const;

/** `rdf:type`. */
export const RDF_TYPE = `${NS.RDF}type`;

/** The class a Pod-Docs document is stamped + type-index-registered with. */
export const DOCUMENT_CLASS = `${NS.PD}Document`;

/** Document predicates. */
export const PD = {
  body: `${NS.PD}body`,
  format: `${NS.PD}format`,
  currentRevision: `${NS.PD}currentRevision`,
  updateLog: `${NS.PD}updateLog`,
  assets: `${NS.PD}assets`,
  comments: `${NS.PD}comments`,
} as const;

/** Dublin Core Terms predicates used by the document. */
export const DCT = {
  title: `${NS.DCT}title`,
  created: `${NS.DCT}created`,
  modified: `${NS.DCT}modified`,
  creator: `${NS.DCT}creator`,
} as const;

/** W3C PROV-O terms used by the revision history. */
export const PROV = {
  wasDerivedFrom: `${NS.PROV}wasDerivedFrom`,
  Entity: `${NS.PROV}Entity`,
  wasRevisionOf: `${NS.PROV}wasRevisionOf`,
  generatedAtTime: `${NS.PROV}generatedAtTime`,
  wasAttributedTo: `${NS.PROV}wasAttributedTo`,
} as const;

/** The default body format when an author supplies none. */
export const DEFAULT_FORMAT = "text/html";

/**
 * Turtle prefix map for readable Pod-Docs documents on the wire. Passed to the
 * n3.Writer so serialised documents prefix-compress cleanly.
 */
export const PREFIXES: Readonly<Record<string, string>> = {
  pd: NS.PD,
  dct: NS.DCT,
  prov: NS.PROV,
  xsd: NS.XSD,
} as const;

export const RDFS_LABEL = `${NS.RDFS}label`;
export const WORD_COUNT = `${NS.SCHEMA}wordCount`;
