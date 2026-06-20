/**
 * Vocabulary IRIs for the chat-interop reconciler — namespace bases plus the
 * exact predicate/class IRIs of the three chat shapes this package reconciles.
 *
 * **Mint NOTHING.** Every term here is an EXISTING, dereferenceable term from a
 * vocabulary the suite (or the wider Solid/social ecosystem) already speaks. The
 * three shapes are:
 *
 *  - **ActivityStreams 2.0 (`as:`)** — the suite's CANONICAL chat write model,
 *    exactly what `@jeswr/pod-chat` produces (verified against its `src/vocab.ts`):
 *    a message is an `as:Note` (`as:content` / `as:mediaType` / `as:attributedTo`
 *    / `as:published` / `as:context` / `as:inReplyTo`), a room is an
 *    `as:Collection`, and the actionable overlay layers `wf:Task` on the same
 *    subject. `pc:ChatRoom` (`@jeswr/pod-chat`) is the suite's room class.
 *  - **SolidOS `meeting:LongChat` (`sioc:` / `meeting:` / `schema:`)** — the
 *    installed-base READ shape (`sioc:content` / `foaf:maker` / `dct:created`,
 *    edit via `dct:isReplacedBy`, delete via `schema:dateDeleted`). PM's
 *    longChat-reader (#95) already reads it.
 *  - The **shared `wf:Task` overlay** from `@jeswr/solid-task-model` — re-used so
 *    an actionable chat message is the SAME `wf:Task` shape solid-issues / the Pod
 *    Manager read. The `wf:`/`TASK_CLASS`/`WF_OPEN`/`WF_CLOSED` consts are
 *    re-exported from there (see {@link ./canonical.ts} / {@link ./reconcile.ts}),
 *    not redefined.
 *
 * **AI / external-source attribution = PROV-O (`prov:`).** Per the
 * solid-oss-integration-targets report (§3): an LLM-authored message carries
 * `prov:wasAttributedTo` (the agent WebID) + `prov:wasGeneratedBy` (the
 * model/endpoint) + `prov:wasDerivedFrom` (the source). This lets AI history land
 * as the SAME shape human chat uses, with honest provenance rather than a faked
 * human author.
 *
 * **House rule: nothing here builds RDF.** These are IRI string constants consumed
 * by the typed `@rdfjs/wrapper` accessors in `as2.ts` / `longchat.ts` — never
 * hand-concatenated into triples.
 */
/** ActivityStreams 2.0 — the canonical chat room/message model (matches pod-chat). */
export declare const AS = "https://www.w3.org/ns/activitystreams#";
/** Pod-Chat application vocabulary — `pc:ChatRoom` (the suite room class). Re-used, not minted. */
export declare const PC = "https://w3id.org/jeswr/pod-chat#";
/** SIOC — `sioc:Note` + `sioc:content`, the SolidOS LongChat message body. */
export declare const SIOC = "http://rdfs.org/sioc/ns#";
/** FOAF — `foaf:maker`, the SolidOS LongChat author. */
export declare const FOAF = "http://xmlns.com/foaf/0.1/";
/** Dublin Core Terms — `dct:created` (LongChat stamp), `dct:isReplacedBy` (edit). */
export declare const DCT = "http://purl.org/dc/terms/";
/** schema.org (canonical http scheme) — `schema:Message`, `schema:dateDeleted` (LongChat delete). */
export declare const SCHEMA = "http://schema.org/";
/** W3C PROV-O — AI/external attribution: wasAttributedTo / wasGeneratedBy / wasDerivedFrom. */
export declare const PROV = "http://www.w3.org/ns/prov#";
/** SolidOS PIM meeting ontology — `meeting:LongChat`, the SolidOS chat channel class. */
export declare const MEETING = "http://www.w3.org/ns/pim/meeting#";
/** W3C SolidOS workflow ontology — `wf:Task`/`wf:Open`/`wf:Closed`/`wf:assignee` (the task overlay). */
export declare const WF = "http://www.w3.org/2005/01/wf/flow#";
/** RDF core — `rdf:type`. */
export declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD datatypes (referenced via the wrapper value mappers). */
export declare const XSD = "http://www.w3.org/2001/XMLSchema#";
/** The `rdf:type` predicate IRI. */
export declare const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/** `as:Note` — a single chat message (the canonical message class). */
export declare const AS_NOTE = "https://www.w3.org/ns/activitystreams#Note";
/** `as:Collection` — a chat room/thread (the canonical room class). */
export declare const AS_COLLECTION = "https://www.w3.org/ns/activitystreams#Collection";
/** `as:Person` — a participant reference. */
export declare const AS_PERSON = "https://www.w3.org/ns/activitystreams#Person";
/** `as:content` — the message body text. */
export declare const AS_CONTENT = "https://www.w3.org/ns/activitystreams#content";
/** `as:mediaType` — the body's content type (defaults to text/plain). */
export declare const AS_MEDIA_TYPE = "https://www.w3.org/ns/activitystreams#mediaType";
/** `as:attributedTo` — the human author WebID. */
export declare const AS_ATTRIBUTED_TO = "https://www.w3.org/ns/activitystreams#attributedTo";
/** `as:published` — the post timestamp (xsd:dateTime). */
export declare const AS_PUBLISHED = "https://www.w3.org/ns/activitystreams#published";
/** `as:context` — the room a message belongs to. */
export declare const AS_CONTEXT = "https://www.w3.org/ns/activitystreams#context";
/** `as:inReplyTo` — the message this one replies to. */
export declare const AS_IN_REPLY_TO = "https://www.w3.org/ns/activitystreams#inReplyTo";
/** `as:items` — a room's message references. */
export declare const AS_ITEMS = "https://www.w3.org/ns/activitystreams#items";
/** `as:name` — a room's display name. */
export declare const AS_NAME = "https://www.w3.org/ns/activitystreams#name";
/** `pc:ChatRoom` — the Pod-Chat room class (layered on `as:Collection`). Re-used. */
export declare const PC_CHAT_ROOM = "https://w3id.org/jeswr/pod-chat#ChatRoom";
/** `sioc:Note` — the SolidOS LongChat message class (also stamped `as:Note` on write). */
export declare const SIOC_NOTE = "http://rdfs.org/sioc/ns#Note";
/** `sioc:content` — the LongChat message body. */
export declare const SIOC_CONTENT = "http://rdfs.org/sioc/ns#content";
/** `sioc:has_reply` — a LongChat reply link (read as a reply edge). */
export declare const SIOC_HAS_REPLY = "http://rdfs.org/sioc/ns#has_reply";
/** `foaf:maker` — the LongChat author WebID. */
export declare const FOAF_MAKER = "http://xmlns.com/foaf/0.1/maker";
/** `meeting:LongChat` — the SolidOS chat channel class (stamped on a room). */
export declare const MEETING_LONG_CHAT = "http://www.w3.org/ns/pim/meeting#LongChat";
/** `schema:Message` — the schema.org message class (also stamped on a LongChat message). */
export declare const SCHEMA_MESSAGE = "http://schema.org/Message";
/** `schema:dateDeleted` — the soft-delete tombstone timestamp (LongChat delete). */
export declare const SCHEMA_DATE_DELETED = "http://schema.org/dateDeleted";
/** `dct:created` — the LongChat created timestamp. */
export declare const DCT_CREATED = "http://purl.org/dc/terms/created";
/** `dct:creator` — the room/message creator WebID (Dublin Core form). */
export declare const DCT_CREATOR = "http://purl.org/dc/terms/creator";
/** `dct:title` — the room/task title. */
export declare const DCT_TITLE = "http://purl.org/dc/terms/title";
/** `dct:isReplacedBy` — the edit pointer: a message superseded by another resource. */
export declare const DCT_IS_REPLACED_BY = "http://purl.org/dc/terms/isReplacedBy";
/** `prov:wasAttributedTo` — the agent (e.g. an AI agent WebID) a message is attributed to. */
export declare const PROV_WAS_ATTRIBUTED_TO = "http://www.w3.org/ns/prov#wasAttributedTo";
/** `prov:wasGeneratedBy` — the model/endpoint IRI that generated the message. */
export declare const PROV_WAS_GENERATED_BY = "http://www.w3.org/ns/prov#wasGeneratedBy";
/** `prov:wasDerivedFrom` — the source IRI the message was derived/imported from. */
export declare const PROV_WAS_DERIVED_FROM = "http://www.w3.org/ns/prov#wasDerivedFrom";
export { TASK_CLASS, WF_CLOSED, WF_OPEN, wf, } from "@jeswr/solid-task-model";
/** `wf:assignee` — the WebID an actionable message's task is assigned to. */
export declare const WF_ASSIGNEE = "http://www.w3.org/2005/01/wf/flow#assignee";
/** The default message body media type when none is supplied. */
export declare const DEFAULT_MEDIA_TYPE = "text/plain";
/**
 * Prefix map for an `n3.Writer` serialising any of the three shapes (pretty,
 * prefix-compressed Turtle output). Includes every namespace the reconciler can
 * write.
 */
export declare const PREFIXES: Readonly<Record<string, string>>;
//# sourceMappingURL=vocab.d.ts.map