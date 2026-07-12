// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
export const AS = "https://www.w3.org/ns/activitystreams#";
/** Pod-Chat application vocabulary — `pc:ChatRoom` (the suite room class). Re-used, not minted. */
export const PC = "https://w3id.org/jeswr/pod-chat#";
/** SIOC — `sioc:Note` + `sioc:content`, the SolidOS LongChat message body. */
export const SIOC = "http://rdfs.org/sioc/ns#";
/** FOAF — `foaf:maker`, the SolidOS LongChat author. */
export const FOAF = "http://xmlns.com/foaf/0.1/";
/** Dublin Core Terms — `dct:created` (LongChat stamp), `dct:isReplacedBy` (edit). */
export const DCT = "http://purl.org/dc/terms/";
/** schema.org (canonical http scheme) — `schema:Message`, `schema:dateDeleted` (LongChat delete). */
export const SCHEMA = "http://schema.org/";
/** W3C PROV-O — AI/external attribution: wasAttributedTo / wasGeneratedBy / wasDerivedFrom. */
export const PROV = "http://www.w3.org/ns/prov#";
/** SolidOS PIM meeting ontology — `meeting:LongChat`, the SolidOS chat channel class. */
export const MEETING = "http://www.w3.org/ns/pim/meeting#";
/** W3C SolidOS workflow ontology — `wf:Task`/`wf:Open`/`wf:Closed`/`wf:assignee` (the task overlay). */
export const WF = "http://www.w3.org/2005/01/wf/flow#";
/** RDF core — `rdf:type`. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** XSD datatypes (referenced via the wrapper value mappers). */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
/** The `rdf:type` predicate IRI. */
export const RDF_TYPE = `${RDF}type`;
// --- ActivityStreams 2.0 classes + predicates (the canonical shape) ----------
/** `as:Note` — a single chat message (the canonical message class). */
export const AS_NOTE = `${AS}Note`;
/** `as:Collection` — a chat room/thread (the canonical room class). */
export const AS_COLLECTION = `${AS}Collection`;
/** `as:Person` — a participant reference. */
export const AS_PERSON = `${AS}Person`;
/** `as:content` — the message body text. */
export const AS_CONTENT = `${AS}content`;
/** `as:mediaType` — the body's content type (defaults to text/plain). */
export const AS_MEDIA_TYPE = `${AS}mediaType`;
/** `as:attributedTo` — the human author WebID. */
export const AS_ATTRIBUTED_TO = `${AS}attributedTo`;
/** `as:published` — the post timestamp (xsd:dateTime). */
export const AS_PUBLISHED = `${AS}published`;
/** `as:context` — the room a message belongs to. */
export const AS_CONTEXT = `${AS}context`;
/** `as:inReplyTo` — the message this one replies to. */
export const AS_IN_REPLY_TO = `${AS}inReplyTo`;
/** `as:items` — a room's message references. */
export const AS_ITEMS = `${AS}items`;
/** `as:name` — a room's display name. */
export const AS_NAME = `${AS}name`;
/** `pc:ChatRoom` — the Pod-Chat room class (layered on `as:Collection`). Re-used. */
export const PC_CHAT_ROOM = `${PC}ChatRoom`;
// --- SolidOS LongChat classes + predicates (the installed-base read shape) ---
/** `sioc:Note` — the SolidOS LongChat message class (also stamped `as:Note` on write). */
export const SIOC_NOTE = `${SIOC}Note`;
/** `sioc:content` — the LongChat message body. */
export const SIOC_CONTENT = `${SIOC}content`;
/** `sioc:has_reply` — a LongChat reply link (read as a reply edge). */
export const SIOC_HAS_REPLY = `${SIOC}has_reply`;
/** `foaf:maker` — the LongChat author WebID. */
export const FOAF_MAKER = `${FOAF}maker`;
/** `meeting:LongChat` — the SolidOS chat channel class (stamped on a room). */
export const MEETING_LONG_CHAT = `${MEETING}LongChat`;
/** `schema:Message` — the schema.org message class (also stamped on a LongChat message). */
export const SCHEMA_MESSAGE = `${SCHEMA}Message`;
/** `schema:dateDeleted` — the soft-delete tombstone timestamp (LongChat delete). */
export const SCHEMA_DATE_DELETED = `${SCHEMA}dateDeleted`;
/** `dct:created` — the LongChat created timestamp. */
export const DCT_CREATED = `${DCT}created`;
/** `dct:creator` — the room/message creator WebID (Dublin Core form). */
export const DCT_CREATOR = `${DCT}creator`;
/** `dct:title` — the room/task title. */
export const DCT_TITLE = `${DCT}title`;
/** `dct:isReplacedBy` — the edit pointer: a message superseded by another resource. */
export const DCT_IS_REPLACED_BY = `${DCT}isReplacedBy`;
// --- PROV-O predicates (AI / external-source attribution) --------------------
/** `prov:wasAttributedTo` — the agent (e.g. an AI agent WebID) a message is attributed to. */
export const PROV_WAS_ATTRIBUTED_TO = `${PROV}wasAttributedTo`;
/** `prov:wasGeneratedBy` — the model/endpoint IRI that generated the message. */
export const PROV_WAS_GENERATED_BY = `${PROV}wasGeneratedBy`;
/** `prov:wasDerivedFrom` — the source IRI the message was derived/imported from. */
export const PROV_WAS_DERIVED_FROM = `${PROV}wasDerivedFrom`;
// --- wf:Task overlay terms (re-exported from @jeswr/solid-task-model) ---------
// The shared task model is the single source of truth for these IRIs; we re-export
// the consts so a consumer can use them off this package's surface, and so the
// overlay we read/write is verifiably the SAME shape solid-issues / PM read.
export { TASK_CLASS, WF_CLOSED, WF_OPEN, wf, } from "@jeswr/solid-task-model";
/** `wf:assignee` — the WebID an actionable message's task is assigned to. */
export const WF_ASSIGNEE = `${WF}assignee`;
/** The default message body media type when none is supplied. */
export const DEFAULT_MEDIA_TYPE = "text/plain";
/**
 * Prefix map for an `n3.Writer` serialising any of the three shapes (pretty,
 * prefix-compressed Turtle output). Includes every namespace the reconciler can
 * write.
 */
export const PREFIXES = {
    as: AS,
    pc: PC,
    sioc: SIOC,
    foaf: FOAF,
    dct: DCT,
    schema: SCHEMA,
    prov: PROV,
    meeting: MEETING,
    wf: WF,
    rdf: RDF,
    xsd: XSD,
};
//# sourceMappingURL=vocab.js.map