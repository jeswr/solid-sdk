// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The typed RDF model for a Pod-Chat message — an ActivityStreams 2.0 `as:Note`,
 * optionally ALSO an actionable `wf:Task` carrying the shared cross-app task
 * model.
 *
 * One pod resource holds one message; its subject is `<resource>#it`:
 *
 *   - `as:content` — the message body text.
 *   - `as:mediaType` — the body content type (defaults to `text/plain`).
 *   - `as:attributedTo` — the author WebID (an IRI).
 *   - `as:published` — the xsd:dateTime the message was posted.
 *   - `as:context` — the room (`as:Collection`) the message belongs to.
 *   - `as:inReplyTo` — the message this one replies to, if any.
 *
 * **Actionable messages.** When `task` is supplied, the SAME subject is *also*
 * typed `wf:Task`, with a lifecycle-state class (`wf:Open`/`wf:Closed`), a
 * `dct:title` summary and a `wf:assignee` WebID — the shared task model from
 * `https://w3id.org/jeswr/task#`. solid-issues / Pod Manager then pick the note
 * up as a task with no Pod-Chat-specific code.
 *
 * Everything goes through typed `@rdfjs/wrapper` accessors — never hand-built
 * quads, never inline Turtle (house rule).
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
import { AS, AS_CLASS, DCT, DEFAULT_MEDIA_TYPE, RDF_TYPE, WF, WF_CLASS } from "./vocab.js";

/** The lifecycle state of an actionable message's task. */
export type TaskState = "open" | "closed";

/**
 * The shared-task overlay on an actionable message (the `wf:Task` facet). When a
 * message carries this, its subject is typed `wf:Task` in addition to `as:Note`.
 */
export interface MessageTask {
  /** Lifecycle state — `rdf:type wf:Open` / `wf:Closed`. */
  state: TaskState;
  /** Short task summary — `dct:title` (distinct from the chat body). */
  title?: string;
  /** The WebID the task is assigned to — `wf:assignee` (drives federation). */
  assignee?: string;
}

/** A message as the UI consumes it (plain, serialisable). */
export interface ChatMessage {
  /** Body text — `as:content`. */
  content: string;
  /** Body content type — `as:mediaType` (defaults to `text/plain`). */
  mediaType: string;
  /** Author WebID — `as:attributedTo` (an IRI). */
  author?: string;
  /** Posted stamp — `as:published`, ISO-8601 string. */
  published?: string;
  /** The room this message belongs to — `as:context` (an IRI). */
  room?: string;
  /** The message this one replies to — `as:inReplyTo` (an IRI). */
  inReplyTo?: string;
  /** The shared-task overlay when this message is actionable; absent otherwise. */
  task?: MessageTask;
}

/** Typed `@rdfjs/wrapper` view of a single message's `#it` subject. */
export class MessageDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp the subject as an `as:Note`. */
  markNote(): this {
    this.types.add(AS_CLASS.Note);
    return this;
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.content, LiteralAs.string);
  }
  set content(v: string | undefined) {
    OptionalAs.object(this, AS.content, v, LiteralFrom.string);
  }
  get mediaType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.mediaType, LiteralAs.string);
  }
  set mediaType(v: string | undefined) {
    OptionalAs.object(this, AS.mediaType, v, LiteralFrom.string);
  }
  get author(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.attributedTo, NamedNodeAs.string);
  }
  set author(v: string | undefined) {
    OptionalAs.object(this, AS.attributedTo, v, NamedNodeFrom.string);
  }
  get published(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, AS.published, LiteralAs.date);
  }
  set published(v: Date | undefined) {
    OptionalAs.object(this, AS.published, v, LiteralFrom.dateTime);
  }
  get room(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.context, NamedNodeAs.string);
  }
  set room(v: string | undefined) {
    OptionalAs.object(this, AS.context, v, NamedNodeFrom.string);
  }
  get inReplyTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.inReplyTo, NamedNodeAs.string);
  }
  set inReplyTo(v: string | undefined) {
    OptionalAs.object(this, AS.inReplyTo, v, NamedNodeFrom.string);
  }
  /** Task title — `dct:title` (the actionable overlay). */
  get taskTitle(): string | undefined {
    return OptionalFrom.subjectPredicate(this, DCT.title, LiteralAs.string);
  }
  set taskTitle(v: string | undefined) {
    OptionalAs.object(this, DCT.title, v, LiteralFrom.string);
  }
  /** Task assignee WebID — `wf:assignee` (the actionable overlay). */
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, WF.assignee, NamedNodeAs.string);
  }
  set assignee(v: string | undefined) {
    OptionalAs.object(this, WF.assignee, v, NamedNodeFrom.string);
  }
}

/** The message subject IRI for a resource (`<resource>#it`). */
export function messageSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/**
 * Read the shared-task overlay off a message subject, or `undefined` when the
 * subject is not typed `wf:Task`. A `wf:Closed` type wins over `wf:Open` (a
 * malformed note carrying both is treated as closed — the safe end-state read).
 */
function readTask(doc: MessageDoc): MessageTask | undefined {
  const types = doc.types;
  if (!types.has(WF_CLASS.Task)) return undefined;
  const state: TaskState = types.has(WF_CLASS.Closed) ? "closed" : "open";
  return { state, title: doc.taskTitle, assignee: doc.assignee };
}

/**
 * Parse a message resource's dataset into a {@link ChatMessage}, or `undefined`
 * if the resource holds no `as:Note`.
 */
export function parseMessage(resourceUrl: string, dataset: DatasetCore): ChatMessage | undefined {
  const doc = new MessageDoc(messageSubject(resourceUrl), dataset, DataFactory);
  if (!doc.types.has(AS_CLASS.Note)) return undefined;
  const task = readTask(doc);
  return {
    content: doc.content ?? "",
    mediaType: doc.mediaType ?? DEFAULT_MEDIA_TYPE,
    author: doc.author,
    published: doc.published?.toISOString(),
    room: doc.room,
    inReplyTo: doc.inReplyTo,
    ...(task ? { task } : {}),
  };
}

/** Input for {@link buildMessage}. */
export interface BuildMessageInput {
  /** The message body text. */
  content: string;
  /** Body content type; defaults to `text/plain` when omitted/blank. */
  mediaType?: string;
  /** Author WebID (an IRI). */
  author?: string;
  /** The room (`as:Collection`) this message belongs to (an IRI). */
  room?: string;
  /** The message this one replies to (an IRI). */
  inReplyTo?: string;
  /** Posted stamp; defaults to `now`. */
  published?: Date;
  /** When set, the subject is ALSO typed `wf:Task` with the shared task model. */
  task?: MessageTask;
  /** "Now" — injectable for deterministic tests; defaults to a real `new Date()`. */
  now?: Date;
}

/**
 * Serialise a {@link BuildMessageInput} into a fresh dataset rooted at
 * `<resource>#it`, typed `as:Note` — and, when `task` is supplied, ALSO typed
 * `wf:Task` with its lifecycle-state class, `dct:title` and `wf:assignee`.
 */
export function buildMessage(resourceUrl: string, input: BuildMessageInput): Store {
  const store = new Store();
  const now = input.published ?? input.now ?? new Date();
  const mediaType = input.mediaType?.trim() || DEFAULT_MEDIA_TYPE;

  const doc = new MessageDoc(messageSubject(resourceUrl), store, DataFactory).markNote();
  doc.content = input.content;
  doc.mediaType = mediaType;
  doc.author = input.author;
  doc.published = now;
  doc.room = input.room;
  doc.inReplyTo = input.inReplyTo;

  if (input.task) {
    // The actionable overlay: the SAME subject is also a wf:Task, so the shared
    // cross-app task model picks it up with no Pod-Chat-specific code.
    doc.types.add(WF_CLASS.Task);
    doc.types.add(input.task.state === "closed" ? WF_CLASS.Closed : WF_CLASS.Open);
    doc.taskTitle = input.task.title;
    doc.assignee = input.task.assignee;
  }

  return store;
}
