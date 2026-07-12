// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The typed RDF model for a Pod-Chat room — an ActivityStreams 2.0
 * `as:Collection`, ALSO typed `pc:ChatRoom` (the app's primary type-index class
 * and `fedapp:produces`/`consumes` shape).
 *
 * One pod resource holds the room descriptor; its subject is `<resource>#it`:
 *
 *   - `as:name` — the room's display name.
 *   - `dct:created` — the xsd:dateTime the room was created.
 *   - `dct:creator` — the room owner's WebID (an IRI).
 *   - `pc:participant` → an `as:Person` node per member, each `as:name` labelled,
 *     identified by the participant's WebID.
 *   - `as:items` → the message resource IRIs that belong to the room (a forward
 *     index, so the room descriptor lists its messages without a container scan;
 *     messages also point back via `as:context`).
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
import { AS, AS_CLASS, CHAT_ROOM_CLASS, DCT, PC, RDF_TYPE } from "./vocab.js";

/** A room participant as the UI consumes it (plain, serialisable). */
export interface Participant {
  /** The participant's WebID (an IRI). */
  webId: string;
  /** A human-readable display name, if recorded. */
  name?: string;
}

/** A chat room as the UI consumes it (plain, serialisable). */
export interface ChatRoom {
  /** Display name — `as:name`. */
  name: string;
  /** Owner WebID — `dct:creator` (an IRI). */
  creator?: string;
  /** Created stamp — `dct:created`, ISO-8601 string. */
  created?: string;
  /** The room's participants — `pc:participant` → `as:Person` nodes. */
  participants: Participant[];
  /**
   * The message resource IRIs that belong to the room — `as:items`. A forward
   * index so a room lists its messages without scanning the container.
   */
  messages: string[];
}

/** Typed `@rdfjs/wrapper` view of an `as:Person` participant subject. */
export class ParticipantDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markPerson(): this {
    this.types.add(AS_CLASS.Person);
    return this;
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.name, LiteralAs.string);
  }
  set name(v: string | undefined) {
    OptionalAs.object(this, AS.name, v, LiteralFrom.string);
  }
}

/** Typed `@rdfjs/wrapper` view of a single room's `#it` subject. */
export class RoomDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp the subject as both an `as:Collection` and the app's `pc:ChatRoom`. */
  mark(): this {
    this.types.add(AS_CLASS.Collection);
    this.types.add(CHAT_ROOM_CLASS);
    return this;
  }
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS.name, LiteralAs.string);
  }
  set name(v: string | undefined) {
    OptionalAs.object(this, AS.name, v, LiteralFrom.string);
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
  /** The set of participant WebIDs (`pc:participant` object IRIs). */
  get participantRefs(): Set<string> {
    return SetFrom.subjectPredicate(this, PC.participant, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** The set of message resource IRIs (`as:items` object IRIs). */
  get messageRefs(): Set<string> {
    return SetFrom.subjectPredicate(this, AS.items, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** The room subject IRI for a resource (`<resource>#it`). */
export function roomSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/**
 * Read every participant referenced by a room, head order preserved by the
 * referenced WebID's sort so the listing is stable. Each is an `as:Person`
 * node identified by its WebID, with an optional `as:name` label.
 */
function readParticipants(doc: RoomDoc, dataset: DatasetCore): Participant[] {
  const out: Participant[] = [];
  for (const webId of doc.participantRefs) {
    const person = new ParticipantDoc(webId, dataset, DataFactory);
    out.push({ webId, name: person.name });
  }
  return out.sort((a, b) => a.webId.localeCompare(b.webId));
}

/**
 * Parse a room resource's dataset into a {@link ChatRoom}, or `undefined` if the
 * resource holds no `pc:ChatRoom`.
 */
export function parseRoom(resourceUrl: string, dataset: DatasetCore): ChatRoom | undefined {
  const doc = new RoomDoc(roomSubject(resourceUrl), dataset, DataFactory);
  if (!doc.types.has(CHAT_ROOM_CLASS)) return undefined;
  return {
    name: doc.name ?? "",
    creator: doc.creator,
    created: doc.created?.toISOString(),
    participants: readParticipants(doc, dataset),
    messages: [...doc.messageRefs].sort((a, b) => a.localeCompare(b)),
  };
}

/** Input for {@link buildRoom}. */
export interface BuildRoomInput {
  /** Display name. */
  name: string;
  /** Owner WebID (an IRI). */
  creator?: string;
  /** Created stamp; defaults to `now`. */
  created?: Date;
  /** Participants to record; each becomes an `as:Person` node. */
  participants?: readonly Participant[];
  /** Message resource IRIs to index via `as:items`. */
  messages?: readonly string[];
  /** "Now" — injectable for deterministic tests; defaults to a real `new Date()`. */
  now?: Date;
}

/**
 * Serialise a {@link BuildRoomInput} into a fresh dataset rooted at
 * `<resource>#it`, typed `as:Collection` + `pc:ChatRoom`, with an `as:Person`
 * node per participant and an `as:items` reference per message.
 */
export function buildRoom(resourceUrl: string, input: BuildRoomInput): Store {
  const store = new Store();
  const now = input.created ?? input.now ?? new Date();

  const doc = new RoomDoc(roomSubject(resourceUrl), store, DataFactory).mark();
  doc.name = input.name || undefined;
  doc.creator = input.creator;
  doc.created = now;

  for (const p of input.participants ?? []) {
    doc.participantRefs.add(p.webId);
    const person = new ParticipantDoc(p.webId, store, DataFactory).markPerson();
    person.name = p.name;
  }

  for (const m of input.messages ?? []) {
    doc.messageRefs.add(m);
  }

  return store;
}
