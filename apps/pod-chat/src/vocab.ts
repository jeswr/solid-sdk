// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The RDF vocabulary Pod Chat reads and writes — namespace prefixes and the
 * exact predicate/class IRIs of the chat model.
 *
 * **The chat model.** Pod Chat is modelled on **ActivityStreams 2.0** (`as:`),
 * the W3C standard the wider social ecosystem (ActivityPub, Mastodon, the SolidOS
 * chat pane) already speaks, so a Pod-Chat room/message is interoperable rather
 * than bespoke:
 *
 *   - A **room** is an `as:Collection` (the `pc:ChatRoom` class is layered on top
 *     as the app's primary type-index class and `fedapp:produces`/`consumes`
 *     shape). It carries `as:name`, `dct:created`, `dct:creator` (the room
 *     owner's WebID), and `as:items` references to its messages.
 *   - A **message** is an `as:Note`: `as:content` (the body text),
 *     `as:mediaType` (the body's content type, defaulting to `text/plain`),
 *     `as:attributedTo` (the author WebID), `as:published` (the xsd:dateTime),
 *     `as:context` (the room it belongs to) and an optional `as:inReplyTo` link.
 *   - A **participant** is an `as:Person` reference (a WebID) listed on the room
 *     via `pc:participant`, with a human label via `as:name`.
 *
 * **Actionable messages (the shared task model).** A message may also be an
 * actionable item — a "could you do X" turned into a tracked task — by *also*
 * typing the same subject `wf:Task` and carrying the shared cross-app task model
 * from `https://w3id.org/jeswr/task#` (re-using the SolidOS workflow ontology
 * `wf:`, Dublin Core `dct:` and ActivityStreams `as:`, NOT a new ontology):
 *
 *   - `rdf:type wf:Task` — marks the note as a task as well as a message.
 *   - `rdf:type wf:Open` / `wf:Closed` — the task's lifecycle state (a class on
 *     the subject, never a literal — the shared-model rule).
 *   - `dct:title` — the task's short summary (distinct from the chat body).
 *   - `wf:assignee` — the WebID the task is assigned to (drives the cross-app
 *     "tasks assigned to me" federation query).
 *
 * Because the actionable note is BOTH an `as:Note` and a `wf:Task` on one
 * subject, solid-issues / Pod Manager pick it up via the shared task model with
 * no Pod-Chat-specific code, and the chat UI renders it as a message — the whole
 * point of re-using the agreed vocabulary.
 *
 * House rule: nothing here builds RDF — these are IRI constants consumed by the
 * typed `@rdfjs/wrapper` accessors in `message.ts`, `room.ts` and
 * `type-index.ts`.
 */

/** Namespace base IRIs. */
export const NS = {
  /** Pod-Chat application vocabulary (the ChatRoom class + participant glue). */
  PC: "https://w3id.org/jeswr/pod-chat#",
  /** ActivityStreams 2.0 — the chat room/message/person model. */
  AS: "https://www.w3.org/ns/activitystreams#",
  /** SolidOS / W3C workflow ontology — the shared task model. */
  WF: "http://www.w3.org/2005/01/wf/flow#",
  /** Dublin Core Terms — created / creator / title. */
  DCT: "http://purl.org/dc/terms/",
  /** RDF core — rdf:type. */
  RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  /** XSD datatypes. */
  XSD: "http://www.w3.org/2001/XMLSchema#",
  /** Solid terms — type index. */
  SOLID: "http://www.w3.org/ns/solid/terms#",
} as const;

/** `rdf:type`. */
export const RDF_TYPE = `${NS.RDF}type`;

/** The class a Pod-Chat room is stamped + type-index-registered with. */
export const CHAT_ROOM_CLASS = `${NS.PC}ChatRoom`;

/** Pod-Chat application predicates + classes. */
export const PC = {
  /** Links a room to a participant node. */
  participant: `${NS.PC}participant`,
} as const;

/** ActivityStreams 2.0 classes used by the chat model. */
export const AS_CLASS = {
  Collection: `${NS.AS}Collection`,
  Note: `${NS.AS}Note`,
  Person: `${NS.AS}Person`,
} as const;

/** ActivityStreams 2.0 predicates used by the chat model. */
export const AS = {
  name: `${NS.AS}name`,
  content: `${NS.AS}content`,
  mediaType: `${NS.AS}mediaType`,
  attributedTo: `${NS.AS}attributedTo`,
  published: `${NS.AS}published`,
  context: `${NS.AS}context`,
  inReplyTo: `${NS.AS}inReplyTo`,
  items: `${NS.AS}items`,
} as const;

/** Dublin Core Terms predicates used by the chat model. */
export const DCT = {
  title: `${NS.DCT}title`,
  created: `${NS.DCT}created`,
  creator: `${NS.DCT}creator`,
} as const;

/**
 * The shared cross-app task model (`https://w3id.org/jeswr/task#` — a re-use of
 * `wf:` / `dct:` / `as:`, NOT a new ontology). An actionable chat message is
 * typed `wf:Task` AND carries a lifecycle-state class + `wf:assignee`.
 */
export const WF_CLASS = {
  Task: `${NS.WF}Task`,
  Open: `${NS.WF}Open`,
  Closed: `${NS.WF}Closed`,
} as const;

/** Shared task-model predicates. */
export const WF = {
  assignee: `${NS.WF}assignee`,
} as const;

/** The default message body media type when an author supplies none. */
export const DEFAULT_MEDIA_TYPE = "text/plain";

/**
 * Turtle prefix map for readable Pod-Chat documents on the wire. Passed to the
 * n3.Writer so serialised rooms/messages prefix-compress cleanly.
 */
export const PREFIXES: Readonly<Record<string, string>> = {
  pc: NS.PC,
  as: NS.AS,
  wf: NS.WF,
  dct: NS.DCT,
  xsd: NS.XSD,
} as const;
