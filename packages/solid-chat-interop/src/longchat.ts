// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * SolidOS `meeting:LongChat` ↔ canonical — the installed-base READ shape.
 *
 * A LongChat message is a `sioc:Note` carrying `sioc:content` (body),
 * `foaf:maker` (author WebID) and `dct:created` (timestamp); a reply is
 * `sioc:has_reply` / `as:inReplyTo`; an edit is `dct:isReplacedBy`; a delete is a
 * `schema:dateDeleted` tombstone. This mirrors the SolidOS chat pane and the Pod
 * Manager's longChat-reader (#95). On WRITE we stamp BOTH `sioc:Note` AND
 * `as:Note` (and `schema:Message`) — exactly as PM's `chat.ts` does — so the
 * message is recognisable to AS2.0-only readers too.
 *
 * The `wf:Task` actionable overlay carries through on the SAME subject (the shared
 * `@jeswr/solid-task-model` shape), so an actionable LongChat message federates as
 * a task with no chat-specific code.
 *
 * Typed `@rdfjs/wrapper` accessors only — never hand-built quads (house rule).
 * Every IRI-valued object is filtered http(s)-only on READ AND WRITE — a
 * non-http(s) value is DROPPED, never coerced.
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
import { httpIriOrUndefined, readIsoDate } from "./iri.js";
import {
  AS_ATTRIBUTED_TO,
  AS_CONTENT,
  AS_IN_REPLY_TO,
  AS_NOTE,
  AS_PUBLISHED,
  DCT_CREATED,
  DCT_IS_REPLACED_BY,
  DCT_TITLE,
  DEFAULT_MEDIA_TYPE,
  FOAF_MAKER,
  PROV_WAS_ATTRIBUTED_TO,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  RDF_TYPE,
  SCHEMA_DATE_DELETED,
  SCHEMA_MESSAGE,
  SIOC_CONTENT,
  SIOC_HAS_REPLY,
  SIOC_NOTE,
  TASK_CLASS,
  WF_ASSIGNEE,
  WF_CLOSED,
  WF_OPEN,
} from "./vocab.js";

/** Typed `@rdfjs/wrapper` view of a single SolidOS LongChat message subject. */
export class LongChatMessageDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Stamp the subject as a LongChat message: `sioc:Note` (the SolidOS read shape)
   * PLUS `as:Note` and `schema:Message` (so AS2.0-only / schema.org readers see
   * it too) — exactly how PM's `chat.ts` marks a message.
   */
  mark(): this {
    this.types.add(SIOC_NOTE);
    this.types.add(AS_NOTE);
    this.types.add(SCHEMA_MESSAGE);
    return this;
  }
  /**
   * Body text. Read prefers `sioc:content` (the SolidOS form) and falls back to
   * `as:content` (an AS2-only message). The setter writes BOTH so the resource is a
   * COMPLETE message to a sioc reader AND to an AS2.0-only reader (the doc is
   * stamped `sioc:Note` + `as:Note`; writing only sioc would leave the `as:Note`
   * blank for an AS2 reader).
   */
  get content(): string | undefined {
    return (
      OptionalFrom.subjectPredicate(this, SIOC_CONTENT, LiteralAs.string) ??
      OptionalFrom.subjectPredicate(this, AS_CONTENT, LiteralAs.string)
    );
  }
  set content(v: string | undefined) {
    OptionalAs.object(this, SIOC_CONTENT, v, LiteralFrom.string);
    OptionalAs.object(this, AS_CONTENT, v, LiteralFrom.string);
  }
  /** Author WebID — read prefers `foaf:maker` (SolidOS), falls back to `as:attributedTo`; writes BOTH. */
  get author(): string | undefined {
    return (
      OptionalFrom.subjectPredicate(this, FOAF_MAKER, NamedNodeAs.string) ??
      OptionalFrom.subjectPredicate(this, AS_ATTRIBUTED_TO, NamedNodeAs.string)
    );
  }
  set author(v: string | undefined) {
    OptionalAs.object(this, FOAF_MAKER, v, NamedNodeFrom.string);
    OptionalAs.object(this, AS_ATTRIBUTED_TO, v, NamedNodeFrom.string);
  }
  /** Created stamp — read prefers `dct:created` (SolidOS), falls back to `as:published`; writes BOTH. */
  get created(): Date | undefined {
    return (
      OptionalFrom.subjectPredicate(this, DCT_CREATED, LiteralAs.date) ??
      OptionalFrom.subjectPredicate(this, AS_PUBLISHED, LiteralAs.date)
    );
  }
  set created(v: Date | undefined) {
    OptionalAs.object(this, DCT_CREATED, v, LiteralFrom.dateTime);
    OptionalAs.object(this, AS_PUBLISHED, v, LiteralFrom.dateTime);
  }
  /**
   * The reply target — this message replies TO `inReplyTo`. The reply→parent edge
   * is `as:inReplyTo` (used by AS2.0 AND by SolidOS LongChat on the message
   * itself). We deliberately do NOT use `sioc:has_reply` here: `sioc:has_reply` is
   * the INVERSE (parent→reply) direction, so writing it on this message pointing at
   * its parent would reverse the thread edge for sioc readers. Filtered http(s)-only
   * by the reconciler.
   */
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
  // --- PROV-O provenance (carried through so AI/imported LongChat is honest) ---
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

/** The conventional LongChat message subject IRI for a resource (`<resource>#it`). */
export function longChatMessageSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

function readTask(doc: LongChatMessageDoc): MessageTask | undefined {
  const types = doc.types;
  if (!types.has(TASK_CLASS)) return undefined;
  const state: TaskState = types.has(WF_CLOSED) ? "closed" : "open";
  const task: MessageTask = { state };
  if (doc.taskTitle !== undefined) task.title = doc.taskTitle;
  const assignee = httpIriOrUndefined(doc.assignee);
  if (assignee !== undefined) task.assignee = assignee;
  return task;
}

function readProvenance(doc: LongChatMessageDoc): MessageProvenance | undefined {
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
 * Parse a SolidOS LongChat message subject into a {@link CanonicalMessage}, or
 * `undefined` if the subject is not a `sioc:Note` (nor an `as:Note`, since a
 * suite-written message stamps both — accept either as the message marker).
 *
 * Every IRI-valued object is filtered http(s)-only on read (untrusted input).
 *
 * @param subject - the message subject IRI (e.g. {@link longChatMessageSubject}).
 */
export function parseLongChatMessage(
  subject: string,
  dataset: DatasetCore,
): CanonicalMessage | undefined {
  const doc = new LongChatMessageDoc(subject, dataset, DataFactory);
  const types = doc.types;
  if (!types.has(SIOC_NOTE) && !types.has(AS_NOTE)) return undefined;

  const msg: CanonicalMessage = {
    id: subject,
    content: doc.content ?? "",
    // LongChat does not carry a media type; the canonical default applies.
    mediaType: DEFAULT_MEDIA_TYPE,
  };
  const author = httpIriOrUndefined(doc.author);
  if (author !== undefined) msg.author = author;
  const published = readIsoDate(() => doc.created);
  if (published !== undefined) msg.published = published;
  const inReplyTo = httpIriOrUndefined(doc.inReplyTo);
  if (inReplyTo !== undefined) msg.inReplyTo = inReplyTo;
  const replacedBy = httpIriOrUndefined(doc.replacedBy);
  if (replacedBy !== undefined) msg.replacedBy = replacedBy;
  const deletedAt = readIsoDate(() => doc.deletedAt);
  if (deletedAt !== undefined) msg.deletedAt = deletedAt;
  const provenance = readProvenance(doc);
  if (provenance !== undefined) msg.provenance = provenance;
  const task = readTask(doc);
  if (task !== undefined) msg.task = task;
  return msg;
}

/**
 * Build a fresh n3 `Store` holding one SolidOS LongChat message rooted at
 * `subject`, stamped `sioc:Note` + `as:Note` + `schema:Message`. When `msg.task`
 * is supplied the SAME subject is ALSO typed `wf:Task` with its lifecycle-state
 * class, `dct:title` and `wf:assignee` (the shared overlay).
 *
 * The canonical `room` and `mediaType` are NOT written: SolidOS LongChat models
 * the room by the message's CONTAINER (the `chat.ttl` it lives in), not an
 * `as:context` triple, and carries no per-message media type. They are preserved
 * across an AS2.0 round-trip but are not part of the LongChat wire shape.
 *
 * Every IRI-valued object is filtered http(s)-only on write. `created` defaults to
 * `now` when omitted.
 */
export function buildLongChatMessage(subject: string, msg: CanonicalMessage): Store {
  const store = new Store();
  const doc = new LongChatMessageDoc(subject, store, DataFactory).mark();

  doc.content = msg.content;
  doc.author = httpIriOrUndefined(msg.author);
  doc.created = msg.published ? new Date(msg.published) : new Date();
  doc.inReplyTo = httpIriOrUndefined(msg.inReplyTo);
  doc.replacedBy = httpIriOrUndefined(msg.replacedBy);
  doc.deletedAt = msg.deletedAt ? new Date(msg.deletedAt) : undefined;

  if (msg.provenance) {
    doc.provAttributedTo = httpIriOrUndefined(msg.provenance.attributedTo);
    doc.provGeneratedBy = httpIriOrUndefined(msg.provenance.generatedBy);
    doc.provDerivedFrom = httpIriOrUndefined(msg.provenance.derivedFrom);
  }

  if (msg.task) {
    doc.types.add(TASK_CLASS);
    doc.types.add(msg.task.state === "closed" ? WF_CLOSED : WF_OPEN);
    doc.taskTitle = msg.task.title;
    doc.assignee = httpIriOrUndefined(msg.task.assignee);
  }

  return store;
}
