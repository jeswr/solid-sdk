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
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpIriOrUndefined, readIsoDate, safeHttpIri, sanitizeText, tryRead } from "./iri.js";
import { AS_ATTRIBUTED_TO, AS_CONTENT, AS_CONTEXT, AS_IN_REPLY_TO, AS_MEDIA_TYPE, AS_NOTE, AS_PUBLISHED, DCT_IS_REPLACED_BY, DCT_TITLE, DEFAULT_MEDIA_TYPE, PROV_WAS_ATTRIBUTED_TO, PROV_WAS_DERIVED_FROM, PROV_WAS_GENERATED_BY, RDF_TYPE, SCHEMA_DATE_DELETED, TASK_CLASS, WF_ASSIGNEE, WF_CLOSED, WF_OPEN, } from "./vocab.js";
/** Typed `@rdfjs/wrapper` view of a single AS2.0 message subject (`as:Note`). */
export class As2MessageDoc extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp the subject as an `as:Note`. */
    markNote() {
        this.types.add(AS_NOTE);
        return this;
    }
    get content() {
        return OptionalFrom.subjectPredicate(this, AS_CONTENT, LiteralAs.string);
    }
    set content(v) {
        OptionalAs.object(this, AS_CONTENT, v, LiteralFrom.string);
    }
    get mediaType() {
        return OptionalFrom.subjectPredicate(this, AS_MEDIA_TYPE, LiteralAs.string);
    }
    set mediaType(v) {
        OptionalAs.object(this, AS_MEDIA_TYPE, v, LiteralFrom.string);
    }
    get author() {
        return OptionalFrom.subjectPredicate(this, AS_ATTRIBUTED_TO, NamedNodeAs.string);
    }
    set author(v) {
        OptionalAs.object(this, AS_ATTRIBUTED_TO, v, NamedNodeFrom.string);
    }
    get published() {
        return OptionalFrom.subjectPredicate(this, AS_PUBLISHED, LiteralAs.date);
    }
    set published(v) {
        OptionalAs.object(this, AS_PUBLISHED, v, LiteralFrom.dateTime);
    }
    get room() {
        return OptionalFrom.subjectPredicate(this, AS_CONTEXT, NamedNodeAs.string);
    }
    set room(v) {
        OptionalAs.object(this, AS_CONTEXT, v, NamedNodeFrom.string);
    }
    get inReplyTo() {
        return OptionalFrom.subjectPredicate(this, AS_IN_REPLY_TO, NamedNodeAs.string);
    }
    set inReplyTo(v) {
        OptionalAs.object(this, AS_IN_REPLY_TO, v, NamedNodeFrom.string);
    }
    get replacedBy() {
        return OptionalFrom.subjectPredicate(this, DCT_IS_REPLACED_BY, NamedNodeAs.string);
    }
    set replacedBy(v) {
        OptionalAs.object(this, DCT_IS_REPLACED_BY, v, NamedNodeFrom.string);
    }
    get deletedAt() {
        return OptionalFrom.subjectPredicate(this, SCHEMA_DATE_DELETED, LiteralAs.date);
    }
    set deletedAt(v) {
        OptionalAs.object(this, SCHEMA_DATE_DELETED, v, LiteralFrom.dateTime);
    }
    // --- PROV-O provenance (AI / external-source attribution) ---
    get provAttributedTo() {
        return OptionalFrom.subjectPredicate(this, PROV_WAS_ATTRIBUTED_TO, NamedNodeAs.string);
    }
    set provAttributedTo(v) {
        OptionalAs.object(this, PROV_WAS_ATTRIBUTED_TO, v, NamedNodeFrom.string);
    }
    get provGeneratedBy() {
        return OptionalFrom.subjectPredicate(this, PROV_WAS_GENERATED_BY, NamedNodeAs.string);
    }
    set provGeneratedBy(v) {
        OptionalAs.object(this, PROV_WAS_GENERATED_BY, v, NamedNodeFrom.string);
    }
    get provDerivedFrom() {
        return OptionalFrom.subjectPredicate(this, PROV_WAS_DERIVED_FROM, NamedNodeAs.string);
    }
    set provDerivedFrom(v) {
        OptionalAs.object(this, PROV_WAS_DERIVED_FROM, v, NamedNodeFrom.string);
    }
    // --- wf:Task overlay (the actionable facet, identical to pod-chat) ---
    get taskTitle() {
        return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
    }
    set taskTitle(v) {
        OptionalAs.object(this, DCT_TITLE, v, LiteralFrom.string);
    }
    get assignee() {
        return OptionalFrom.subjectPredicate(this, WF_ASSIGNEE, NamedNodeAs.string);
    }
    set assignee(v) {
        OptionalAs.object(this, WF_ASSIGNEE, v, NamedNodeFrom.string);
    }
}
/** The conventional AS2.0 message subject IRI for a resource (`<resource>#it`). */
export function as2MessageSubject(resourceUrl) {
    return `${resourceUrl}#it`;
}
/**
 * Read the shared-task overlay off a message subject, or `undefined` when the
 * subject is not typed `wf:Task`. A `wf:Closed` type wins over `wf:Open` (a
 * malformed note carrying both is treated as closed — the safe end-state read),
 * matching pod-chat's `readTask`.
 */
/**
 * Read the subject's `rdf:type` IRIs PER OBJECT, skipping any malformed (non-IRI)
 * type term. Built directly off the dataset rather than the wrapper's `types`
 * getter because `SetFrom` + `NamedNodeAs.string` is ALL-OR-NOTHING: a single
 * literal-valued `rdf:type` would throw and drop EVERY type, so a valid `as:Note`
 * carrying one garbage type triple would fail to parse (untrusted input).
 * Filtering per object keeps the valid type IRIs and ignores the bad term.
 */
function readTypeSet(subject, dataset) {
    const types = new Set();
    for (const q of dataset.match(DataFactory.namedNode(subject), DataFactory.namedNode(RDF_TYPE), null)) {
        if (q.object.termType === "NamedNode")
            types.add(q.object.value);
    }
    return types;
}
function readTask(doc, types) {
    if (!types.has(TASK_CLASS))
        return undefined;
    const state = types.has(WF_CLOSED) ? "closed" : "open";
    const task = { state };
    const title = tryRead(() => doc.taskTitle);
    if (title !== undefined)
        task.title = title;
    const assignee = httpIriOrUndefined(tryRead(() => doc.assignee));
    if (assignee !== undefined)
        task.assignee = assignee;
    return task;
}
/** Read the PROV-O provenance off a subject, or `undefined` if it carries none. */
function readProvenance(doc) {
    const attributedTo = httpIriOrUndefined(tryRead(() => doc.provAttributedTo));
    const generatedBy = httpIriOrUndefined(tryRead(() => doc.provGeneratedBy));
    const derivedFrom = httpIriOrUndefined(tryRead(() => doc.provDerivedFrom));
    if (attributedTo === undefined && generatedBy === undefined && derivedFrom === undefined) {
        return undefined;
    }
    const prov = {};
    if (attributedTo !== undefined)
        prov.attributedTo = attributedTo;
    if (generatedBy !== undefined)
        prov.generatedBy = generatedBy;
    if (derivedFrom !== undefined)
        prov.derivedFrom = derivedFrom;
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
export function parseAs2Message(subject, dataset) {
    const doc = new As2MessageDoc(subject, dataset, DataFactory);
    const types = readTypeSet(subject, dataset);
    if (!types.has(AS_NOTE))
        return undefined;
    // Every typed read below is guarded against a malformed-literal THROW (an
    // untrusted foreign document must never abort the parse — see iri.ts `tryRead`).
    const msg = {
        id: subject,
        content: tryRead(() => doc.content) ?? "",
        mediaType: tryRead(() => doc.mediaType) ?? DEFAULT_MEDIA_TYPE,
    };
    const author = httpIriOrUndefined(tryRead(() => doc.author));
    if (author !== undefined)
        msg.author = author;
    const published = readIsoDate(() => doc.published);
    if (published !== undefined)
        msg.published = published;
    const room = httpIriOrUndefined(tryRead(() => doc.room));
    if (room !== undefined)
        msg.room = room;
    const inReplyTo = httpIriOrUndefined(tryRead(() => doc.inReplyTo));
    if (inReplyTo !== undefined)
        msg.inReplyTo = inReplyTo;
    const replacedBy = httpIriOrUndefined(tryRead(() => doc.replacedBy));
    if (replacedBy !== undefined)
        msg.replacedBy = replacedBy;
    const deletedAt = readIsoDate(() => doc.deletedAt);
    if (deletedAt !== undefined)
        msg.deletedAt = deletedAt;
    const provenance = readProvenance(doc);
    if (provenance !== undefined)
        msg.provenance = provenance;
    const task = readTask(doc, types);
    if (task !== undefined)
        msg.task = task;
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
export function buildAs2Message(subject, msg) {
    // The subject is the ONE mandatory IRI (it becomes the message's `<subject>`
    // NamedNode via `n3.Writer`, which does NOT escape IRIs). A non-http(s) or
    // injection-bearing subject cannot be silently dropped like an optional object
    // property — it would corrupt the serialised resource — so fail closed. The guard
    // returns the injection-safe (percent-escaped, LEXICAL) form so an injection
    // character (e.g. `>`) can never break out of the `<…>`.
    const safeSubject = safeHttpIri(subject);
    if (safeSubject === undefined) {
        throw new TypeError(`buildAs2Message: subject must be an absolute http(s) IRI, got ${JSON.stringify(subject)}`);
    }
    const store = new Store();
    const doc = new As2MessageDoc(safeSubject, store, DataFactory).markNote();
    // Bodies/titles/media types are stored as PLAIN TEXT literals; strip smuggling-
    // prone control characters (see iri.ts `sanitizeText`) from every untrusted text
    // value before it is persisted.
    doc.content = sanitizeText(msg.content);
    doc.mediaType = sanitizeText(msg.mediaType)?.trim() || DEFAULT_MEDIA_TYPE;
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
        doc.taskTitle = sanitizeText(msg.task.title);
        doc.assignee = httpIriOrUndefined(msg.task.assignee);
    }
    return store;
}
// Re-export the IRI guard so callers of the AS2.0 surface have it to hand.
export { isHttpIri } from "./iri.js";
//# sourceMappingURL=as2.js.map