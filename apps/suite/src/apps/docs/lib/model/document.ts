// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — include format changes in automatic revisions
// Ported from apps/pod-docs/src/document.ts.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6 — shared alias-aware property replacement
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
 * The document subject holds the latest snapshot; revision entities record
 * only policy-selected historical snapshots.
 *
 * Everything goes through typed `@rdfjs/wrapper` accessors — never hand-built
 * quads, never inline Turtle (house rule). The editor *engine* that interprets
 * the body string is a separate ADR; this layer is format-agnostic.
 */

import { canonicalize, LEGACY_NAMESPACES } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  type ITermFromValueMapping,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  DCT,
  DEFAULT_FORMAT,
  DOCUMENT_CLASS,
  PD,
  PROV,
  RDF_TYPE,
  RDFS_LABEL,
  WORD_COUNT,
} from "./vocab.js";

/** The canonical predicate and every recognised legacy spelling, canonical first. */
function documentPredicateAliases(predicate: string): Set<string> {
  const aliases = new Set([predicate]);
  for (const [legacy, base] of Object.entries(LEGACY_NAMESPACES)) {
    if (predicate.startsWith(base)) aliases.add(legacy + predicate.slice(base.length));
  }
  return aliases;
}

/** Read canonical predicates first, accepting the legacy namespace on old documents. */
function readDocumentValue<T>(
  anchor: TermWrapper,
  predicate: string,
  as: (term: TermWrapper) => T,
): T | undefined {
  for (const alias of documentPredicateAliases(predicate)) {
    const value = OptionalFrom.subjectPredicate(anchor, alias, as);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Replace all recognised spellings so clearing cannot reveal an older legacy value. */
function writeDocumentValue<T>(
  anchor: TermWrapper,
  predicate: string,
  value: T | undefined,
  from: ITermFromValueMapping<T>,
): void {
  for (const alias of documentPredicateAliases(predicate)) {
    SetFrom.subjectPredicate(anchor, alias, TermAs.term, TermFrom.itself).clear();
  }
  OptionalAs.object(anchor, predicate, value, from);
}

/** A single saved revision as the UI consumes it (plain, serialisable). */
export interface Revision {
  /** The revision entity's URL (`<resource>#rev-<n>`). */
  id: string;
  label?: string | undefined;
  /** The body snapshot at this revision. */
  body: string;
  /** The body's content format (a media-type string). */
  format: string;
  /** When this revision was generated — ISO-8601 string (serialisable). */
  generatedAt: string;
  /** The editor WebID this revision is attributed to, if recorded. */
  attributedTo?: string | undefined;
  /** The predecessor revision's URL, if this is not the first. */
  wasRevisionOf?: string | undefined;
}

/** A document as the UI consumes it (plain, serialisable). */
export interface PodDocument {
  /** Title — `dct:title`. */
  updateLog?: string | undefined;
  assets?: string | undefined;
  comments?: string | undefined;
  wordCount?: number | undefined;
  wasDerivedFrom?: string | undefined;
  title: string;
  /** The current rich-text body — `pd:body`. */
  body: string;
  /** The body's content format — `pd:format` (defaults to `text/html`). */
  format: string;
  /** Authoring WebID — `dct:creator` (an IRI). */
  creator?: string | undefined;
  /** Created stamp — `dct:created`, ISO-8601 string. */
  created?: string | undefined;
  /** Last-modified stamp — `dct:modified`, ISO-8601 string. */
  modified?: string | undefined;
  /**
   * The full revision history, head-first (newest → oldest), reconstructed by
   * walking `pd:currentRevision` then `prov:wasRevisionOf`. Empty for a document
   * with no recorded history.
   */
  revisions: Revision[];
}

/** Typed `@rdfjs/wrapper` view of a `prov:Entity` revision subject. */
export class RevisionDoc extends TermWrapper {
  get label(): string | undefined {
    return OptionalFrom.subjectPredicate(this, RDFS_LABEL, LiteralAs.string);
  }
  set label(value: string | undefined) {
    OptionalAs.object(this, RDFS_LABEL, value, LiteralFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(PROV.Entity);
    return this;
  }
  get body(): string | undefined {
    return readDocumentValue(this, PD.body, LiteralAs.string);
  }
  set body(v: string | undefined) {
    writeDocumentValue(this, PD.body, v, LiteralFrom.string);
  }
  get format(): string | undefined {
    return readDocumentValue(this, PD.format, LiteralAs.string);
  }
  set format(v: string | undefined) {
    writeDocumentValue(this, PD.format, v, LiteralFrom.string);
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
  get updateLog(): string | undefined {
    return readDocumentValue(this, PD.updateLog, NamedNodeAs.string);
  }
  set updateLog(value: string | undefined) {
    writeDocumentValue(this, PD.updateLog, value, NamedNodeFrom.string);
  }
  get assets(): string | undefined {
    return readDocumentValue(this, PD.assets, NamedNodeAs.string);
  }
  set assets(value: string | undefined) {
    writeDocumentValue(this, PD.assets, value, NamedNodeFrom.string);
  }
  get comments(): string | undefined {
    return readDocumentValue(this, PD.comments, NamedNodeAs.string);
  }
  set comments(value: string | undefined) {
    writeDocumentValue(this, PD.comments, value, NamedNodeFrom.string);
  }
  get wordCount(): number | undefined {
    return readDocumentValue(this, WORD_COUNT, LiteralAs.number);
  }
  set wordCount(value: number | undefined) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError("Word count must be a non-negative integer");
    }
    writeDocumentValue(this, WORD_COUNT, value, LiteralFrom.integer);
  }
  get wasDerivedFrom(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV.wasDerivedFrom, NamedNodeAs.string);
  }
  set wasDerivedFrom(value: string | undefined) {
    OptionalAs.object(this, PROV.wasDerivedFrom, value, NamedNodeFrom.string);
  }
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
    return readDocumentValue(this, PD.body, LiteralAs.string);
  }
  set body(v: string | undefined) {
    writeDocumentValue(this, PD.body, v, LiteralFrom.string);
  }
  get format(): string | undefined {
    return readDocumentValue(this, PD.format, LiteralAs.string);
  }
  set format(v: string | undefined) {
    writeDocumentValue(this, PD.format, v, LiteralFrom.string);
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
    return readDocumentValue(this, PD.currentRevision, NamedNodeAs.string);
  }
  set currentRevision(v: string | undefined) {
    writeDocumentValue(this, PD.currentRevision, v, NamedNodeFrom.string);
  }
}

/** The document subject IRI for a resource (`<resource>#it`). */
export function documentSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/** The revision-entity IRI for a resource at index `n` (`<resource>#rev-<n>`). */
export function revisionSubject(resourceUrl: string, index: number | bigint): string {
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
      label: rev.label,
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
  const types = SetFrom.subjectPredicate(doc, RDF_TYPE, TermAs.term, TermFrom.itself);
  if (
    ![...types].some(
      (type) => type.termType === "NamedNode" && canonicalize(type.value) === DOCUMENT_CLASS,
    )
  )
    return undefined;
  return {
    updateLog: doc.updateLog,
    assets: doc.assets,
    comments: doc.comments,
    wordCount: doc.wordCount,
    wasDerivedFrom: doc.wasDerivedFrom,
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
  /** Revision author, separate from the original document creator. */
  editor?: string | undefined;
  updateLog?: string | undefined;
  assets?: string | undefined;
  comments?: string | undefined;
  wordCount?: number | undefined;
  wasDerivedFrom?: string | undefined;
  /** A nonblank label always records a revision, even for unchanged content. */
  revisionLabel?: string | undefined;
  title: string;
  /** The rich-text body; defaults to the empty string for a brand-new doc. */
  body?: string | undefined;
  /** Body content format; defaults to `text/html` when omitted/blank. */
  format?: string | undefined;
  /** Authoring WebID (an IRI). Also attributed to the new head revision. */
  creator?: string | undefined;
  /**
   * Created stamp; defaults to `now` for a brand-new document. On a SAVE, pass
   * back the document's existing `created` (a `Date` or the ISO string from a
   * prior {@link parseDocument}) so the original creation time is preserved
   * rather than silently rewritten to the edit time.
   */
  created?: Date | string | undefined;
  /**
   * Prior revisions to preserve, head-first (newest → oldest) — typically the
   * `revisions` array from the document just read. A head revision capturing
   * the supplied `body`/`format` is prepended according to the revision policy; pass `[]` for a
   * brand-new document.
   */
  priorRevisions?: readonly Revision[] | undefined;
  /** "Now" — injectable for deterministic tests; defaults to a real `new Date()`. */
  now?: Date | undefined;
}

/**
 * Serialise a {@link BuildDocumentInput} into a fresh dataset rooted at
 * `<resource>#it`, materialising history according to the ten-minute/named revision policy.
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

  if (input.title.length > 200) throw new RangeError("Document title exceeds 200 characters");
  if (input.revisionLabel !== undefined && !input.revisionLabel.trim()) {
    throw new RangeError("Revision label must not be blank");
  }
  const created = input.created === undefined ? now : new Date(input.created);
  const doc = new DocumentDoc(documentSubject(resourceUrl), store, DataFactory).mark();
  doc.updateLog = input.updateLog;
  doc.assets = input.assets;
  doc.comments = input.comments;
  doc.wordCount = input.wordCount;
  doc.wasDerivedFrom = input.wasDerivedFrom;
  doc.title = input.title || undefined;
  doc.body = body;
  doc.format = format;
  doc.creator = input.creator;
  doc.created = created;
  doc.modified = now;

  const revisions = applyRevisionPolicy(resourceUrl, prior, {
    body,
    format,
    now,
    attributedTo: input.editor ?? input.creator,
    label: input.revisionLabel,
  });
  doc.currentRevision = revisions[0]?.id;
  for (const rev of revisions) {
    const r = new RevisionDoc(rev.id, store, DataFactory).mark();
    r.body = rev.body;
    r.format = rev.format;
    r.generatedAt = new Date(rev.generatedAt);
    r.attributedTo = rev.attributedTo;
    r.wasRevisionOf = rev.wasRevisionOf;
    r.label = rev.label;
  }

  return store;
}

/**
 * Highest `rev-<n>` index among prior revisions that belong to THIS resource.
 * Revisions whose IRI doesn't match `<resource>#rev-<n>` (e.g. imported from
 * another resource) are ignored for indexing. Returns -1 when none match, so a
 * brand-new document's first revision is `rev-0`.
 */
function highestRevisionIndex(resourceUrl: string, revisions: readonly Revision[]): bigint {
  const prefix = `${resourceUrl}#rev-`;
  let max = BigInt(-1);
  for (const rev of revisions) {
    if (!rev.id.startsWith(prefix)) continue;
    const suffix = rev.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = BigInt(suffix);
    if (n > max) max = n;
  }
  return max;
}

/** Pure revision policy: snapshots remain current between durable history entries. */
export function applyRevisionPolicy(
  resourceUrl: string,
  prior: readonly Revision[],
  snapshot: {
    body: string;
    format: string;
    now: Date;
    attributedTo?: string | undefined;
    label?: string | undefined;
  },
): Revision[] {
  // Normalize repeated IDs and predecessor links before adding or pruning nodes.
  const revisions = [...new Map(prior.map((rev) => [rev.id, { ...rev }])).values()];
  const last = revisions[0];
  if (
    !last ||
    snapshot.label !== undefined ||
    (snapshot.now.getTime() - new Date(last.generatedAt).getTime() >= 600_000 &&
      (snapshot.body !== last.body || snapshot.format !== last.format))
  ) {
    revisions.unshift({
      id: revisionSubject(resourceUrl, highestRevisionIndex(resourceUrl, prior) + BigInt(1)),
      body: snapshot.body,
      format: snapshot.format,
      generatedAt: snapshot.now.toISOString(),
      attributedTo: snapshot.attributedTo,
      label: snapshot.label,
    });
  }
  const auto = revisions
    .filter((rev) => rev.label === undefined)
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  const pruned = new Set(auto.slice(100).map((rev) => rev.id));
  const kept = revisions.filter((rev) => !pruned.has(rev.id));
  for (let i = 0; i < kept.length; i++) {
    const rev = kept[i] as Revision;
    rev.wasRevisionOf = kept[i + 1]?.id;
  }
  return kept;
}
