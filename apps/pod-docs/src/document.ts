// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The typed RDF model for a Pod-Docs rich-text document with provenance history.
 *
 * One pod resource holds one document; its subjects are:
 *
 *   - `<resource>#it` — the `pd:Document`: title, created/modified stamps, the
 *     authoring WebID, the current body+format, and a `pd:currentRevision` link
 *     to the head of the history chain.
 *   - `<resource>#rev-<n>` — a `prov:Entity` per saved revision, each
 *     `prov:wasRevisionOf` its predecessor, carrying the body+format snapshot,
 *     `prov:generatedAtTime` and `prov:wasAttributedTo` (the editor WebID).
 *
 * The current body lives on BOTH the document subject (for a one-GET read of the
 * latest state) and the head revision entity (so the history chain is
 * self-contained). They are kept consistent by `buildDocument`.
 *
 * Everything goes through typed `@rdfjs/wrapper` accessors — never hand-built
 * quads, never inline Turtle (house rule). The editor *engine* that interprets
 * the body string is a separate ADR; this layer is format-agnostic.
 */

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
import { DCT, DEFAULT_FORMAT, DOCUMENT_CLASS, PD, PROV, RDF_TYPE } from "./vocab.js";

/** A single saved revision as the UI consumes it (plain, serialisable). */
export interface Revision {
  /** The revision entity's URL (`<resource>#rev-<n>`). */
  id: string;
  /** The body snapshot at this revision. */
  body: string;
  /** The body's content format (a media-type string). */
  format: string;
  /** When this revision was generated — ISO-8601 string (serialisable). */
  generatedAt: string;
  /** The editor WebID this revision is attributed to, if recorded. */
  attributedTo?: string;
  /** The predecessor revision's URL, if this is not the first. */
  wasRevisionOf?: string;
}

/** A document as the UI consumes it (plain, serialisable). */
export interface PodDocument {
  /** Title — `dct:title`. */
  title: string;
  /** The current rich-text body — `pd:body`. */
  body: string;
  /** The body's content format — `pd:format` (defaults to `text/html`). */
  format: string;
  /** Authoring WebID — `dct:creator` (an IRI). */
  creator?: string;
  /** Created stamp — `dct:created`, ISO-8601 string. */
  created?: string;
  /** Last-modified stamp — `dct:modified`, ISO-8601 string. */
  modified?: string;
  /**
   * The full revision history, head-first (newest → oldest), reconstructed by
   * walking `pd:currentRevision` then `prov:wasRevisionOf`. Empty for a document
   * with no recorded history.
   */
  revisions: Revision[];
}

/** Typed `@rdfjs/wrapper` view of a `prov:Entity` revision subject. */
export class RevisionDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(PROV.Entity);
    return this;
  }
  get body(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PD.body, LiteralAs.string);
  }
  set body(v: string | undefined) {
    OptionalAs.object(this, PD.body, v, LiteralFrom.string);
  }
  get format(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PD.format, LiteralAs.string);
  }
  set format(v: string | undefined) {
    OptionalAs.object(this, PD.format, v, LiteralFrom.string);
  }
  get generatedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, PROV.generatedAtTime, LiteralAs.date);
  }
  set generatedAt(v: Date | undefined) {
    OptionalAs.object(this, PROV.generatedAtTime, v, LiteralFrom.dateTime);
  }
  get attributedTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV.wasAttributedTo, NamedNodeAs.string);
  }
  set attributedTo(v: string | undefined) {
    OptionalAs.object(this, PROV.wasAttributedTo, v, NamedNodeFrom.string);
  }
  get wasRevisionOf(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV.wasRevisionOf, NamedNodeAs.string);
  }
  set wasRevisionOf(v: string | undefined) {
    OptionalAs.object(this, PROV.wasRevisionOf, v, NamedNodeFrom.string);
  }
}

/** Typed `@rdfjs/wrapper` view of a single document's `#it` subject. */
export class DocumentDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DOCUMENT_CLASS);
    return this;
  }
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.title, LiteralAs.string);
  }
  set title(v: string | undefined) {
    OptionalAs.object(this, DCT.title, v, LiteralFrom.string);
  }
  get body(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PD.body, LiteralAs.string);
  }
  set body(v: string | undefined) {
    OptionalAs.object(this, PD.body, v, LiteralFrom.string);
  }
  get format(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PD.format, LiteralAs.string);
  }
  set format(v: string | undefined) {
    OptionalAs.object(this, PD.format, v, LiteralFrom.string);
  }
  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.creator, NamedNodeAs.string);
  }
  set creator(v: string | undefined) {
    OptionalAs.object(this, DCT.creator, v, NamedNodeFrom.string);
  }
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.created, LiteralAs.date);
  }
  set created(v: Date | undefined) {
    OptionalAs.object(this, DCT.created, v, LiteralFrom.dateTime);
  }
  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.modified, LiteralAs.date);
  }
  set modified(v: Date | undefined) {
    OptionalAs.object(this, DCT.modified, v, LiteralFrom.dateTime);
  }
  /** The head of the revision chain (`pd:currentRevision`). */
  get currentRevision(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PD.currentRevision, NamedNodeAs.string);
  }
  set currentRevision(v: string | undefined) {
    OptionalAs.object(this, PD.currentRevision, v, NamedNodeFrom.string);
  }
}

/** The document subject IRI for a resource (`<resource>#it`). */
export function documentSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/** The revision-entity IRI for a resource at index `n` (`<resource>#rev-<n>`). */
export function revisionSubject(resourceUrl: string, index: number): string {
  return `${resourceUrl}#rev-${index}`;
}

/**
 * Walk the revision chain from `pd:currentRevision` along `prov:wasRevisionOf`,
 * head-first. Self-referential or cyclic `wasRevisionOf` links are broken by a
 * visited-set guard (a malformed/hostile document must not loop forever).
 */
function readRevisions(doc: DocumentDoc, dataset: DatasetCore): Revision[] {
  const out: Revision[] = [];
  const seen = new Set<string>();
  let cursor = doc.currentRevision;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const rev = new RevisionDoc(cursor, dataset, DataFactory);
    if (!rev.types.has(PROV.Entity)) break;
    const generatedAt = rev.generatedAt;
    out.push({
      id: cursor,
      body: rev.body ?? "",
      format: rev.format ?? DEFAULT_FORMAT,
      generatedAt: (generatedAt ?? new Date(0)).toISOString(),
      attributedTo: rev.attributedTo,
      wasRevisionOf: rev.wasRevisionOf,
    });
    cursor = rev.wasRevisionOf;
  }
  return out;
}

/**
 * Parse a document resource's dataset into a {@link PodDocument}, or `undefined`
 * if the resource holds no `pd:Document`.
 */
export function parseDocument(resourceUrl: string, dataset: DatasetCore): PodDocument | undefined {
  const doc = new DocumentDoc(documentSubject(resourceUrl), dataset, DataFactory);
  if (!doc.types.has(DOCUMENT_CLASS)) return undefined;
  return {
    title: doc.title ?? "",
    body: doc.body ?? "",
    format: doc.format ?? DEFAULT_FORMAT,
    creator: doc.creator,
    created: doc.created?.toISOString(),
    modified: doc.modified?.toISOString(),
    revisions: readRevisions(doc, dataset),
  };
}

/** Input for {@link buildDocument} — the current state plus its prior history. */
export interface BuildDocumentInput {
  title: string;
  /** The rich-text body; defaults to the empty string for a brand-new doc. */
  body?: string;
  /** Body content format; defaults to `text/html` when omitted/blank. */
  format?: string;
  /** Authoring WebID (an IRI). Also attributed to the new head revision. */
  creator?: string;
  /** Created stamp; defaults to `now` for a brand-new document. */
  created?: Date;
  /**
   * Prior revisions to preserve, head-first (newest → oldest) — typically the
   * `revisions` array from the document just read. A NEW head revision capturing
   * the supplied `body`/`format` is prepended automatically; pass `[]` for a
   * brand-new document.
   */
  priorRevisions?: readonly Revision[];
  /** "Now" — injectable for deterministic tests; defaults to a real `new Date()`. */
  now?: Date;
}

/**
 * Serialise a {@link BuildDocumentInput} into a fresh dataset rooted at
 * `<resource>#it`, materialising a new head `prov:Entity` revision that records
 * the current body/format and links to the previous head.
 *
 * The new revision is indexed one past the highest existing index parsed from
 * the prior revisions' IRIs, so revision IRIs never collide across saves.
 */
export function buildDocument(resourceUrl: string, input: BuildDocumentInput): Store {
  const store = new Store();
  const now = input.now ?? new Date();
  const format = input.format?.trim() || DEFAULT_FORMAT;
  const body = input.body ?? "";
  const prior = input.priorRevisions ?? [];

  const doc = new DocumentDoc(documentSubject(resourceUrl), store, DataFactory).mark();
  doc.title = input.title || undefined;
  doc.body = body;
  doc.format = format;
  doc.creator = input.creator;
  doc.created = input.created ?? now;
  doc.modified = now;

  // New head revision index = (max prior index for THIS resource) + 1.
  const nextIndex = highestRevisionIndex(resourceUrl, prior) + 1;
  const headUrl = revisionSubject(resourceUrl, nextIndex);
  const prevHeadUrl = prior[0]?.id;

  const head = new RevisionDoc(headUrl, store, DataFactory).mark();
  head.body = body;
  head.format = format;
  head.generatedAt = now;
  head.attributedTo = input.creator;
  head.wasRevisionOf = prevHeadUrl;
  doc.currentRevision = headUrl;

  // Re-materialise the prior revision chain so the history resource is
  // self-contained (one resource per document holds its whole history).
  for (const rev of prior) {
    const r = new RevisionDoc(rev.id, store, DataFactory).mark();
    r.body = rev.body;
    r.format = rev.format;
    r.generatedAt = new Date(rev.generatedAt);
    r.attributedTo = rev.attributedTo;
    r.wasRevisionOf = rev.wasRevisionOf;
  }

  return store;
}

/**
 * Highest `rev-<n>` index among prior revisions that belong to THIS resource.
 * Revisions whose IRI doesn't match `<resource>#rev-<n>` (e.g. imported from
 * another resource) are ignored for indexing. Returns -1 when none match, so a
 * brand-new document's first revision is `rev-0`.
 */
function highestRevisionIndex(resourceUrl: string, revisions: readonly Revision[]): number {
  const prefix = `${resourceUrl}#rev-`;
  let max = -1;
  for (const rev of revisions) {
    if (!rev.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rev.id.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
