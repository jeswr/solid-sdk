// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * task.ts — the shared federation TASK model on top of the AS2.0 notification.
 *
 * The headline cross-pod use case is a "task assigned" / "task state changed"
 * notification: app A POSTs an `as:Announce` to agent B's inbox whose `as:object`
 * IS a `wf:Task` (the SolidOS workflow-ontology task/issue, the same shape
 * solid-issues + Pod Manager read/write). This module builds + reads that shape
 * using the SHARED federation vocab terms pinned at https://w3id.org/jeswr/task
 * (re-used `wf:` + `dct:` + `as:` — NOT new terms), via TYPED `@rdfjs/wrapper`
 * accessors over an n3 `Store` (house rule: never hand-concat / hand-build RDF
 * triples).
 *
 * Layering: a {@link TaskDoc} is the typed view of one `wf:Task` subject;
 * {@link buildTaskNotification} embeds a task into the AS2.0 activity dataset from
 * {@link buildActivity}; {@link parseTaskFromNotification} reads it back. The
 * higher-level send helpers ({@link notifyTaskAssigned},
 * {@link notifyTaskStateChanged}) discover + deliver the result. SSRF posture is
 * unchanged — every fetch still goes through the same DNS-pinned `guardedFetch`.
 */
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { buildActivity, isHttpIri, } from "./activity.js";
import { AS, DCT, RDF_TYPE, WF } from "./config.js";
import { notifyAgent } from "./send.js";
/**
 * Typed `@rdfjs/wrapper` view of one shared `wf:Task` subject (read + write). The
 * predicates are the OWNING vocabularies the federation task model re-uses, so the
 * written data resolves against the real `wf:` / `dct:` ontologies.
 */
export class TaskDoc extends TermWrapper {
    /** `rdf:type` values of this subject (carries `wf:Task` + the `wf:Open|wf:Closed` state). */
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp `rdf:type wf:Task` (idempotent — a Set). */
    markTask() {
        this.types.add(`${WF}Task`);
        return this;
    }
    /**
     * Lifecycle state — `"Open"` / `"Closed"` from the `wf:Open` / `wf:Closed`
     * rdf:type, or `undefined` if NEITHER (or, fail-closed, BOTH) is present. A task
     * is Open XOR Closed: a hostile/malformed graph asserting both is AMBIGUOUS, and
     * RDF statement order must never be the tie-breaker — so both-present resolves to
     * `undefined` rather than an arbitrary first-match.
     */
    get state() {
        const types = this.types;
        const open = types.has(`${WF}Open`);
        const closed = types.has(`${WF}Closed`);
        if (open === closed)
            return undefined; // neither, or both (ambiguous)
        return open ? "Open" : "Closed";
    }
    /**
     * Set the lifecycle state — adds the `wf:Open|wf:Closed` rdf:type and removes the
     * opposite one (a task is Open XOR Closed; never both at once).
     */
    setState(state) {
        const types = this.types;
        types.delete(`${WF}${state === "Open" ? "Closed" : "Open"}`);
        types.add(`${WF}${state}`);
        return this;
    }
    get title() {
        return OptionalFrom.subjectPredicate(this, `${DCT}title`, LiteralAs.string);
    }
    set title(v) {
        OptionalAs.object(this, `${DCT}title`, v, LiteralFrom.string);
    }
    get description() {
        return OptionalFrom.subjectPredicate(this, `${DCT}description`, LiteralAs.string);
    }
    set description(v) {
        OptionalAs.object(this, `${DCT}description`, v, LiteralFrom.string);
    }
    /** `wf:assignee` — the assigned agent's WebID (object property). */
    get assignee() {
        return OptionalFrom.subjectPredicate(this, `${WF}assignee`, NamedNodeAs.string);
    }
    set assignee(v) {
        OptionalAs.object(this, `${WF}assignee`, v, NamedNodeFrom.string);
    }
    /** `dct:creator` — the creator's WebID (object property). */
    get creator() {
        return OptionalFrom.subjectPredicate(this, `${DCT}creator`, NamedNodeAs.string);
    }
    set creator(v) {
        OptionalAs.object(this, `${DCT}creator`, v, NamedNodeFrom.string);
    }
    get created() {
        return OptionalFrom.subjectPredicate(this, `${DCT}created`, LiteralAs.date);
    }
    set created(v) {
        OptionalAs.object(this, `${DCT}created`, v, LiteralFrom.dateTime);
    }
}
/**
 * Write a federation `wf:Task` into an existing dataset (typed accessors only).
 * Used by {@link buildTaskNotification} but also exposed for callers composing
 * their own graph. Only http(s) IRIs are written for assignee/creator (never
 * coerce arbitrary text into a NamedNode). Returns the same store for chaining.
 */
export function writeTask(store, task) {
    if (!isHttpIri(task.task)) {
        throw new TypeError(`task IRI must be an absolute http(s) URL: ${task.task}`);
    }
    const doc = new TaskDoc(task.task, store, DataFactory)
        .markTask()
        .setState(task.state ?? "Open");
    doc.title = task.title?.trim() || undefined;
    doc.description = task.description?.trim() || undefined;
    doc.assignee = isHttpIri(task.assignee) ? task.assignee : undefined;
    doc.creator = isHttpIri(task.creator) ? task.creator : undefined;
    doc.created = task.created ?? new Date();
    return store;
}
/**
 * Build a cross-pod task notification: an `as:Announce` (default) whose `as:object`
 * is the task IRI, with the full `wf:Task` shape embedded in the same dataset. This
 * is the shape solid-issues / Pod Manager emit + read for "task assigned" /
 * "task state changed" federation events.
 *
 * The activity verb defaults to `Announce` (the agreed federation verb). The
 * activity's `as:object` is set to the task IRI automatically; the activity
 * subject is the conventional relative `#it` (the inbox assigns the final IRI).
 *
 * @param task     the federation task to embed.
 * @param activity optional AS2.0 activity overrides (`actor`, `type`, `summary`,
 *                 `content`, `published`); `actor` is the SENDER WebID. `object`
 *                 is forced to the task IRI.
 */
export function buildTaskNotification(task, activity) {
    const store = buildActivity({
        type: activity.type ?? "Announce",
        actor: activity.actor,
        object: task.task,
        ...(activity.target !== undefined ? { target: activity.target } : {}),
        ...(activity.summary !== undefined ? { summary: activity.summary } : {}),
        ...(activity.content !== undefined ? { content: activity.content } : {}),
        ...(activity.published !== undefined
            ? { published: activity.published }
            : {}),
    });
    return writeTask(store, task);
}
/**
 * Read the `wf:Task` referenced by a notification's `as:object` back into a plain
 * {@link TaskNotification}, or `undefined` if the activity carries no task object
 * or the referenced subject is not a `wf:Task`.
 *
 * @param activitySubject the activity subject IRI (e.g. from
 *   `findActivitySubject`); we follow its `as:object` to the task.
 * @param dataset         the parsed notification dataset.
 */
export function parseTaskFromNotification(activitySubject, dataset) {
    // The `as:object` link is read with STRICT cardinality (like the task fields): a
    // hostile notification with multiple `as:object` values is ambiguous → no task,
    // never an arbitrary first-match. Must be a single http(s) NamedNode. parseTask
    // then re-validates the subject is itself a wf:Task.
    const taskIri = singleHttpIri(dataset, activitySubject, `${AS}object`);
    if (!taskIri)
        return undefined;
    return parseTask(taskIri, dataset);
}
/**
 * True iff the subject carries `rdf:type <typeIri>`. Reads via raw `dataset.match`
 * with the type IRI pinned in the object position (a NamedNode), so a
 * malformed/garbage rdf:type term (e.g. a literal) simply does not match — the read
 * path NEVER throws on hostile RDF (no typed wrapper in the read direction).
 */
function hasType(dataset, subject, typeIri) {
    for (const _q of dataset.match(DataFactory.namedNode(subject), DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(typeIri))) {
        return true;
    }
    return false;
}
/**
 * The LONE object term of `(subject, predicate, *)` in the dataset, or `undefined`
 * if the cardinality is not exactly one (ZERO or MULTIPLE → ambiguous → absent).
 *
 * Why not `OptionalFrom`: that accessor returns the FIRST matching value silently
 * on a multi-valued predicate, so a hostile task asserting two `wf:assignee` WebIDs
 * would surface an arbitrary one — RDF statement order is not a tie-breaker. A
 * single-valued field in the `TaskNotification` shape must FAIL CLOSED when the
 * graph is ambiguous. We dedupe by term value so `x dct:title "a"` stated twice
 * (genuinely one value) still reads cleanly.
 */
function singleObject(dataset, subject, predicate) {
    const seen = new Map();
    for (const q of dataset.match(DataFactory.namedNode(subject), DataFactory.namedNode(predicate), null)) {
        // Key on termType + value + (literal) datatype/language so two distinct terms
        // never collapse, but a repeated identical statement counts once.
        const o = q.object;
        const key = o.termType === "Literal"
            ? `L:${o.value}:${o.datatype.value}:${o.language}`
            : `${o.termType}:${o.value}`;
        seen.set(key, o);
        if (seen.size > 1)
            return undefined; // multiple distinct values → ambiguous
    }
    return seen.size === 1 ? [...seen.values()][0] : undefined;
}
/** The lone string literal value of a predicate, or `undefined` (zero/multiple/non-literal). */
function singleLiteral(dataset, subject, predicate) {
    const t = singleObject(dataset, subject, predicate);
    return t?.termType === "Literal" ? t.value : undefined;
}
/** The lone http(s) NamedNode IRI value of a predicate, or `undefined`. */
function singleHttpIri(dataset, subject, predicate) {
    const t = singleObject(dataset, subject, predicate);
    return t?.termType === "NamedNode" && isHttpIri(t.value)
        ? t.value
        : undefined;
}
const XSD = "http://www.w3.org/2001/XMLSchema#";
/**
 * The lone date value of a predicate as a `Date`, or `undefined`. STRICT: the term
 * must be a literal explicitly typed `xsd:dateTime` (or `xsd:date`) AND lexically
 * parseable — a bare/plain-string literal or any other datatype is rejected, so we
 * never surface an implementation-dependent `Date.parse` of arbitrary text.
 */
function singleDateTime(dataset, subject, predicate) {
    const t = singleObject(dataset, subject, predicate);
    if (t?.termType !== "Literal")
        return undefined;
    const dt = t.datatype.value;
    if (dt !== `${XSD}dateTime` && dt !== `${XSD}date`)
        return undefined;
    const ms = Date.parse(t.value);
    return Number.isNaN(ms) ? undefined : new Date(ms);
}
/**
 * Read a `wf:Task` subject from a dataset into a plain {@link TaskNotification}, or
 * `undefined` if the subject does not carry `rdf:type wf:Task`.
 *
 * SECURITY/ROBUSTNESS. The dataset is attacker-influenced (it came off a peer's
 * inbox), so the read fails CLOSED on every axis: the task IRI must itself be an
 * absolute http(s) URL; the lifecycle state is Open XOR Closed (both → ambiguous →
 * absent, see {@link TaskDoc.state}); every single-valued field is read with strict
 * cardinality ({@link singleObject} — MULTIPLE distinct values → ambiguous → absent,
 * never an arbitrary first); `assignee`/`creator` surface only as http(s) IRIs
 * (matching the write side — never a `mailto:`/literal/blank-node WebID); and a
 * malformed `dct:created` that is not a valid `xsd:dateTime` is dropped, not thrown.
 */
export function parseTask(taskIri, dataset) {
    if (!isHttpIri(taskIri))
        return undefined;
    if (!hasType(dataset, taskIri, `${WF}Task`))
        return undefined;
    // Lifecycle state is Open XOR Closed: BOTH present (or neither) is ambiguous →
    // absent, so RDF statement order can never be the tie-breaker.
    const open = hasType(dataset, taskIri, `${WF}Open`);
    const closed = hasType(dataset, taskIri, `${WF}Closed`);
    const state = open === closed ? undefined : open ? "Open" : "Closed";
    const title = singleLiteral(dataset, taskIri, `${DCT}title`);
    const description = singleLiteral(dataset, taskIri, `${DCT}description`);
    const assignee = singleHttpIri(dataset, taskIri, `${WF}assignee`);
    const creator = singleHttpIri(dataset, taskIri, `${DCT}creator`);
    // dct:created: strict cardinality AND an explicitly xsd:dateTime/date-typed literal.
    const created = singleDateTime(dataset, taskIri, `${DCT}created`);
    return {
        task: taskIri,
        ...(state !== undefined ? { state } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(assignee !== undefined ? { assignee } : {}),
        ...(creator !== undefined ? { creator } : {}),
        ...(created !== undefined ? { created } : {}),
    };
}
/**
 * Notify an agent that a task has been assigned to them: discover the recipient's
 * inbox from their WebID, then deliver an `as:Announce` carrying the `wf:Task`.
 *
 * Convenience over {@link buildTaskNotification} + the discover/send path. The
 * recipient is `recipientWebId`; the task's `wf:assignee` is set to that WebID
 * unless the task already carries one (so "assigned to you" is self-describing).
 *
 * @throws NoInboxError          the recipient advertises no inbox.
 * @throws NotificationSendError the inbox refused the POST.
 */
export function notifyTaskAssigned(args, opts = {}) {
    const task = {
        ...args.task,
        assignee: args.task.assignee ?? args.recipientWebId,
    };
    return notifyTask(task, args, opts);
}
/**
 * Notify an agent of a task's state change (Open ↔ Closed): discover + deliver an
 * `as:Announce` carrying the `wf:Task` at its new {@link TaskState}.
 */
export function notifyTaskStateChanged(args, opts = {}) {
    const task = { ...args.task, state: args.state };
    return notifyTask(task, args, opts);
}
/** Shared delivery: embed the task, then discover + send to the recipient. */
function notifyTask(task, args, opts) {
    return notifyAgent({
        recipientWebId: args.recipientWebId,
        actorWebId: args.actorWebId,
        type: args.type ?? "Announce",
        object: task.task,
        ...(args.target !== undefined ? { target: args.target } : {}),
        ...(args.summary !== undefined ? { summary: args.summary } : {}),
        ...(args.content !== undefined ? { content: args.content } : {}),
        ...(args.published !== undefined ? { published: args.published } : {}),
    }, 
    // The wf:Task body rides ALONGSIDE the activity in the SAME dataset. The send
    // path builds the activity-only store; the `extend` hook embeds the task into
    // it just before serialise — one delivery path, one SSRF-guarded POST. Any
    // caller-supplied `opts.extend` is COMPOSED (run after the task is embedded),
    // never silently dropped.
    {
        ...opts,
        extend: async (store) => {
            writeTask(store, task);
            await opts.extend?.(store);
        },
    });
}
//# sourceMappingURL=task.js.map