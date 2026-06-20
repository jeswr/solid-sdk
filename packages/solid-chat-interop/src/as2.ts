// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * ActivityStreams 2.0 ↔ canonical — the suite's CANONICAL chat shape.
 *
 * A message is an `as:Note` (mirroring `@jeswr/pod-chat`'s `message.ts` exactly):
 * `as:content` / `as:mediaType` / `as:attributedTo` / `as:published` /
 * `as:context` / `as:inReplyTo`, with the actionable `wf:Task` overlay layered on
 * the SAME subject (via `@jeswr/solid-task-model`'s class + state consts). This
 * package additionally carries PROV-O provenance (AI/external attribution), the
 * `dct:isReplacedBy` edit pointer and the `schema:dateDeleted` tombstone so AS2.0
 * can round-trip the full canonical model.
 *
 * Everything goes through typed `@rdfjs/wrapper` accessors — never hand-built
 * quads (house rule). Every IRI-valued object (author / room / inReplyTo /
 * replacedBy / the provenance members / the task assignee) is filtered http(s)-only
 * via {@link isHttpIri} on READ AND WRITE — a non-http(s) value is DROPPED, never
 * coerced into a malformed `NamedNode`.
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
import type { CanonicalMessage, MessageProvenance, MessageTask, TaskState } from "./canonical.js";
import { httpIriOrUndefined } from "./iri.js";
import {
  AS_ATTRIBUTED_TO,
  AS_CONTENT,
  AS_CONTEXT,
  AS_IN_REPLY_TO,
  AS_MEDIA_TYPE,
  AS_NOTE,
  AS_PUBLISHED,
  DCT_IS_REPLACED_BY,
  DCT_TITLE,
  DEFAULT_MEDIA_TYPE,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  RDF_TYPE,
  SCHEMA_DATE_DELETED,
  TASK_CLASS,
  WF_ASSIGNEE,
  WF_CLOSED,
  WF_OPEN,
} from "./vocab.js";

/** Typed `@rdfjs/wrapper` view of a single AS2.0 message subject (`as:Note`). */
export class As2MessageDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp the subject as an `as:Note`. */
  markNote(): this {
    this.types.add(AS_NOTE);
    return this;
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_CONTENT, LiteralAs.string);
  }
  set content(v: string | undefined) {
    OptionalAs.object(this, AS_CONTENT, v, LiteralFrom.string);
  }
  get mediaType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_MEDIA_TYPE, LiteralAs.string);
  }
  set mediaType(v: string | undefined) {
    OptionalAs.object(this, AS_MEDIA_TYPE, v, LiteralFrom.string);
  }
  get author(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_ATTRIBUTED_TO, NamedNodeAs.string);
  }
  set author(v: string | undefined) {
    OptionalAs.object(this, AS_ATTRIBUTED_TO, v, NamedNodeFrom.string);
  }
  get published(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, AS_PUBLISHED, LiteralAs.date);
  }
  set published(v: Date | undefined) {
    OptionalAs.object(this, AS_PUBLISHED, v, LiteralFrom.dateTime);
  }
  get room(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_CONTEXT, NamedNodeAs.string);
  }
  set room(v: string | undefined) {
    OptionalAs.object(this, AS_CONTEXT, v, NamedNodeFrom.string);
  }
  get inReplyTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_IN_REPLY_TO, NamedNodeAs.string);
  }
  set inReplyTo(v: string | undefined) {
    OptionalAs.object(this, AS_IN_REPLY_TO, v, NamedNodeFrom.string);
  }
  get replacedBy(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_IS_REPLACED_BY, NamedNodeAs.string);
  }
  set replacedBy(v: string | undefined) {
    OptionalAs.object(this, DCT_IS_REPLACED_BY, v, NamedNodeFrom.string);
  }
  get deletedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHEMA_DATE_DELETED, LiteralAs.date);
  }
  set deletedAt(v: Date | undefined) {
    OptionalAs.object(this, SCHEMA_DATE_DELETED, v, LiteralFrom.dateTime);
  }
  // --- PROV-O provenance (AI / external-source attribution) ---
  get provAttributedTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_ATTRIBUTED_TO, NamedNodeAs.string);
  }
  set provAttributedTo(v: string | undefined) {
    OptionalAs.object(this, PROV_WAS_ATTRIBUTED_TO, v, NamedNodeFrom.string);
  }
  get provGeneratedBy(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_GENERATED_BY, NamedNodeAs.string);
  }
  set provGeneratedBy(v: string | undefined) {
    OptionalAs.object(this, PROV_WAS_GENERATED_BY, v, NamedNodeFrom.string);
  }
  get provDerivedFrom(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV_WAS_DERIVED_FROM, NamedNodeAs.string);
  }
  set provDerivedFrom(v: string | undefined) {
    OptionalAs.object(this, PROV_WAS_DERIVED_FROM, v, NamedNodeFrom.string);
  }
  // --- wf:Task overlay (the actionable facet, identical to pod-chat) ---
  get taskTitle(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set taskTitle(v: string | undefined) {
    OptionalAs.object(this, DCT_TITLE, v, LiteralFrom.string);
  }
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, WF_ASSIGNEE, NamedNodeAs.string);
  }
  set assignee(v: string | undefined) {
    OptionalAs.object(this, WF_ASSIGNEE, v, NamedNodeFrom.string);
  }
}

/** The conventional AS2.0 message subject IRI for a resource (`<resource>#it`). */
export function as2MessageSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/**
 * Read the shared-task overlay off a message subject, or `undefined` when the
 * subject is not typed `wf:Task`. A `wf:Closed` type wins over `wf:Open` (a
 * malformed note carrying both is treated as closed — the safe end-state read),
 * matching pod-chat's `readTask`.
 */
function readTask(doc: As2MessageDoc): MessageTask | undefined {
  const types = doc.types;
  if (!types.has(TASK_CLASS)) return undefined;
  const state: TaskState = types.has(WF_CLOSED) ? "closed" : "open";
  const task: MessageTask = { state };
  if (doc.taskTitle !== undefined) task.title = doc.taskTitle;
  const assignee = httpIriOrUndefined(doc.assignee);
  if (assignee !== undefined) task.assignee = assignee;
  return task;
}

/** Read the PROV-O provenance off a subject, or `undefined` if it carries none. */
function readProvenance(doc: As2MessageDoc): MessageProvenance | undefined {
  const attributedTo = httpIriOrUndefined(doc.provAttributedTo);
  const generatedBy = httpIriOrUndefined(doc.provGeneratedBy);
  const derivedFrom = httpIriOrUndefined(doc.provDerivedFrom);
  if (attributedTo === undefined && generatedBy === undefined && derivedFrom === undefined) {
    return undefined;
  }
  const prov: MessageProvenance = {};
  if (attributedTo !== undefined) prov.attributedTo = attributedTo;
  if (generatedBy !== undefined) prov.generatedBy = generatedBy;
  if (derivedFrom !== undefined) prov.derivedFrom = derivedFrom;
  return prov;
}

/**
 * Parse an AS2.0 message subject out of a dataset into a {@link CanonicalMessage},
 * or `undefined` if the subject is not an `as:Note`.
 *
 * Every IRI-valued object is filtered http(s)-only on read (a foreign document is
 * untrusted input): a non-http(s) author/room/inReplyTo/replacedBy/provenance/
 * assignee is dropped, never surfaced.
 *
 * @param subject - the message subject IRI (e.g. {@link as2MessageSubject}).
 */
export function parseAs2Message(
  subject: string,
  dataset: DatasetCore,
): CanonicalMessage | undefined {
  const doc = new As2MessageDoc(subject, dataset, DataFactory);
  if (!doc.types.has(AS_NOTE)) return undefined;

  const msg: CanonicalMessage = {
    id: subject,
    content: doc.content ?? "",
    mediaType: doc.mediaType ?? DEFAULT_MEDIA_TYPE,
  };
  const author = httpIriOrUndefined(doc.author);
  if (author !== undefined) msg.author = author;
  const published = doc.published?.toISOString();
  if (published !== undefined) msg.published = published;
  const room = httpIriOrUndefined(doc.room);
  if (room !== undefined) msg.room = room;
  const inReplyTo = httpIriOrUndefined(doc.inReplyTo);
  if (inReplyTo !== undefined) msg.inReplyTo = inReplyTo;
  const replacedBy = httpIriOrUndefined(doc.replacedBy);
  if (replacedBy !== undefined) msg.replacedBy = replacedBy;
  const deletedAt = doc.deletedAt?.toISOString();
  if (deletedAt !== undefined) msg.deletedAt = deletedAt;
  const provenance = readProvenance(doc);
  if (provenance !== undefined) msg.provenance = provenance;
  const task = readTask(doc);
  if (task !== undefined) msg.task = task;
  return msg;
}

/**
 * Build a fresh n3 `Store` holding one AS2.0 message rooted at `subject`, typed
 * `as:Note` — and, when `msg.task` is supplied, ALSO typed `wf:Task` with its
 * lifecycle-state class, `dct:title` and `wf:assignee` (the shared overlay).
 *
 * Every IRI-valued object is filtered http(s)-only on write: a non-http(s)
 * author/room/inReplyTo/replacedBy/provenance/assignee is dropped rather than
 * coerced into a malformed `NamedNode` (keeping the graph well-formed). `published`
 * defaults to `now` when omitted.
 */
export function buildAs2Message(subject: string, msg: CanonicalMessage): Store {
  const store = new Store();
  const doc = new As2MessageDoc(subject, store, DataFactory).markNote();

  doc.content = msg.content;
  doc.mediaType = msg.mediaType?.trim() || DEFAULT_MEDIA_TYPE;
  doc.author = httpIriOrUndefined(msg.author);
  doc.published = msg.published ? new Date(msg.published) : new Date();
  doc.room = httpIriOrUndefined(msg.room);
  doc.inReplyTo = httpIriOrUndefined(msg.inReplyTo);
  doc.replacedBy = httpIriOrUndefined(msg.replacedBy);
  doc.deletedAt = msg.deletedAt ? new Date(msg.deletedAt) : undefined;

  if (msg.provenance) {
    doc.provAttributedTo = httpIriOrUndefined(msg.provenance.attributedTo);
    doc.provGeneratedBy = httpIriOrUndefined(msg.provenance.generatedBy);
    doc.provDerivedFrom = httpIriOrUndefined(msg.provenance.derivedFrom);
  }

  if (msg.task) {
    // The actionable overlay: the SAME subject is also a wf:Task, so the shared
    // cross-app task model (solid-issues / PM) picks it up with no chat-specific
    // code. Uses @jeswr/solid-task-model's class + state consts (re-exported).
    doc.types.add(TASK_CLASS);
    doc.types.add(msg.task.state === "closed" ? WF_CLOSED : WF_OPEN);
    doc.taskTitle = msg.task.title;
    doc.assignee = httpIriOrUndefined(msg.task.assignee);
  }

  return store;
}

// Re-export the IRI guard so callers of the AS2.0 surface have it to hand.
export { isHttpIri } from "./iri.js";
