/**
 * The CANONICAL in-memory chat model — the hub type every shape (AS2.0, SolidOS
 * LongChat, and any external adapter such as LibreChat) maps to and from.
 *
 * It is aligned to `@jeswr/pod-chat`'s ActivityStreams 2.0 model (the suite's
 * canonical write shape) and the SolidOS LongChat read shape — mints nothing that
 * already exists. A {@link CanonicalMessage} corresponds to an `as:Note` /
 * `sioc:Note`; a {@link CanonicalRoom} to an `as:Collection` / `pc:ChatRoom` /
 * `meeting:LongChat`. The actionable {@link MessageTask} overlay is identical to
 * pod-chat's and is carried by the shared `@jeswr/solid-task-model` `wf:Task`
 * shape, so an actionable canonical message round-trips as the SAME task
 * solid-issues / the Pod Manager read.
 *
 * Plain, serialisable objects (no RDF terms, no platform) — the shape an app's UI
 * works with and the boundary every reconciler/adapter speaks.
 */
/** The lifecycle state of an actionable message's task — binary so it federates cleanly. */
export type TaskState = "open" | "closed";
/**
 * The shared-task overlay on an actionable message (the `wf:Task` facet),
 * identical to pod-chat's `MessageTask`. When present, the message's subject is
 * ALSO typed `wf:Task` (`@jeswr/solid-task-model`'s class) with a lifecycle-state
 * class, an optional title and an optional assignee WebID.
 */
export interface MessageTask {
    /** Lifecycle state — `rdf:type wf:Open` / `wf:Closed`. */
    state: TaskState;
    /** Short task summary — `dct:title` (distinct from the chat body). */
    title?: string;
    /** The WebID the task is assigned to — `wf:assignee` (drives federation). */
    assignee?: string;
}
/**
 * Provenance for an AI-authored / externally-imported message (W3C PROV-O). Lets
 * an LLM message land as the SAME shape human chat uses — with honest attribution
 * rather than a faked human author. Every member is an IRI; non-http(s) values are
 * dropped (never coerced) on read AND write.
 */
export interface MessageProvenance {
    /** `prov:wasAttributedTo` — the agent (e.g. an AI agent WebID) the message is attributed to. */
    attributedTo?: string;
    /** `prov:wasGeneratedBy` — the model/endpoint IRI that generated the message. */
    generatedBy?: string;
    /** `prov:wasDerivedFrom` — the source IRI the message was derived/imported from. */
    derivedFrom?: string;
}
/**
 * A chat message in the canonical model — the hub every shape maps to/from.
 *
 * IRI-valued fields (`author`, `room`, `inReplyTo`, `replacedBy`, and the
 * provenance members + the task assignee) carry untrusted values from foreign
 * documents / external schemas; the reconciler + adapters drop any that is not an
 * absolute http(s) IRI rather than coerce it.
 */
export interface CanonicalMessage {
    /** The message's subject/resource IRI, when known (a foreign doc's `#it`/resource). */
    id?: string;
    /** Body text — `as:content` / `sioc:content`. */
    content: string;
    /** Body content type — `as:mediaType` (defaults to `text/plain`). */
    mediaType: string;
    /** Human author WebID — `as:attributedTo` / `foaf:maker` (an IRI). */
    author?: string;
    /** Posted stamp — `as:published` / `dct:created`, ISO-8601 string. */
    published?: string;
    /** The room this message belongs to — `as:context` (an IRI). */
    room?: string;
    /** The message this one replies to — `as:inReplyTo` / `sioc:has_reply` (an IRI). */
    inReplyTo?: string;
    /** The resource that supersedes this one (an edit) — `dct:isReplacedBy` (an IRI). */
    replacedBy?: string;
    /** Soft-delete tombstone — `schema:dateDeleted`, ISO-8601 string. */
    deletedAt?: string;
    /** AI / external-source attribution (PROV-O); absent for a plain human message. */
    provenance?: MessageProvenance;
    /** The shared-task overlay when this message is actionable; absent otherwise. */
    task?: MessageTask;
}
/**
 * A chat room/thread in the canonical model — an `as:Collection` / `pc:ChatRoom`
 * / `meeting:LongChat`.
 */
export interface CanonicalRoom {
    /** The room's subject/resource IRI, when known. */
    id?: string;
    /** Display name — `as:name`. */
    name?: string;
    /** Created stamp — `dct:created`, ISO-8601 string. */
    created?: string;
    /** Room creator/owner WebID — `dct:creator` (an IRI). */
    creator?: string;
    /** The room's messages, when materialised alongside the room. */
    messages?: CanonicalMessage[];
}
//# sourceMappingURL=canonical.d.ts.map