// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The scheduling **Task** model — typed read/write accessors over a single
 * owner-private task document (the data model a [Vikunja](https://vikunja.io)→Solid
 * fork writes one-per-task to a pod).
 *
 * **Cross-sector by construction (the federation demo).** A task written here is
 * BOTH a `sched:Task` (from the `@jeswr/solid-federation-vocab` scheduling sector)
 * AND a `wf:Task` (from the published `@jeswr/solid-task-model`), on the SAME `#it`
 * subject. The `wf:Task` copy is what makes a Vikunja task surface "assigned to me"
 * in the Pod Manager / solid-issues — the first external app on the shared task
 * model. This module MINTS NOTHING: it reuses `sched:` verbatim and delegates the
 * `wf:`/`dct:`/`schema:`/`prov:` triples to `@jeswr/solid-task-model`'s `buildTask`
 * / `parseTask`.
 *
 * ```turtle
 * <#it>  a sched:Task, wf:Task, wf:Open ;      # dual-vocab, same subject
 *   sched:summary "Ship v1" ; dct:title "Ship v1" ;          # sched + wf
 *   sched:dueTime "2026-07-10T…"^^xsd:dateTime ; wf:dateDue "2026-07-10T…"^^xsd:dateTime ;
 *   wf:assignee <…/card#me> ;                                # the federation edge
 *   dct:subject "backlog", "urgent" ;                        # labels (reuse dct:subject)
 *   sched:recurrence <#recurrence> ; sched:hasReminder <#reminder0> .
 * <#recurrence> a sched:RecurrenceRule ; sched:frequency "WEEKLY" ; sched:interval 1 .
 * <#reminder0>  a sched:Reminder ; sched:triggerOffset "-PT15M"^^xsd:duration .
 * ```
 *
 * **Typed accessors, never hand-built triples (house rule).** Reads/writes go
 * through `@rdfjs/wrapper`'s `OptionalFrom`/`OptionalAs`/`SetFrom` mappers on an
 * n3 `Store`. Serialisation is `n3.Writer`; parsing of a fetched body is
 * `@jeswr/fetch-rdf`'s `parseRdf`.
 *
 * **Untrusted-input hardening.** Pod data is untrusted: every optional read is
 * `tryRead`-guarded so a malformed foreign literal DROPS the field rather than
 * aborting the parse; every IRI-valued field (organizer, calendar, and the
 * federation WebID/relation IRIs handled by task-model) is http(s)-filtered so a
 * hostile `javascript:`/`data:` value is never surfaced; malformed date/number
 * literals and out-of-range durations are dropped.
 */
import { buildTask, parseTask, } from "@jeswr/solid-task-model/task";
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import { DCT_SUBJECT, PREFIXES, RDF_TYPE, RECURRENCE_RULE_CLASS, REMINDER_CLASS, SCHED_COMPLETED, SCHED_COMPLETED_AT, SCHED_COUNT, SCHED_DESCRIPTION, SCHED_DUE_TIME, SCHED_FREQUENCY, SCHED_HAS_REMINDER, SCHED_IN_CALENDAR, SCHED_INTERVAL, SCHED_ORGANIZER, SCHED_RECURRENCE, SCHED_START_TIME, SCHED_SUMMARY, SCHED_TRIGGER_OFFSET, SCHED_TRIGGER_TIME, SCHED_UNTIL, TASK_CLASS, XSD_DURATION, XSD_POSITIVE_INTEGER, } from "./vocab.js";
// Re-exported so the `.` entry point keeps exposing the untrusted-input filter.
export { isHttpIri } from "./iri.js";
/** The conventional subject IRI for the task (`sched:Task` + `wf:Task`) at `resourceUrl`. */
export function schedulingTaskSubject(resourceUrl) {
    return `${resourceUrl}#it`;
}
/** The conventional subject IRIs of the nodes in a task document. */
export function schedulingNodeIris(resourceUrl) {
    return {
        task: `${resourceUrl}#it`,
        recurrence: `${resourceUrl}#recurrence`,
    };
}
/** The conventional subject IRI of the i-th reminder in a task document. */
export function reminderIri(resourceUrl, index) {
    return `${resourceUrl}#reminder${index}`;
}
/** Assign `target[key] = value` ONLY when `value` is defined. */
function setIfDefined(target, key, value) {
    if (value !== undefined)
        target[key] = value;
}
/**
 * Run an untrusted read, returning `undefined` on ANY throw (a malformed foreign
 * literal drops the field, never aborts the parse). A returned `Invalid Date` is
 * treated as absent too.
 */
function tryRead(fn) {
    try {
        const value = fn();
        if (value instanceof Date && Number.isNaN(value.getTime()))
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
/** A positive integer, else `undefined` — the `sched:interval`/`sched:count` filter. */
function positiveIntOrUndefined(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}
// A conservative XSD-1.1 `xsd:duration` matcher: an optional leading `-`, `P`,
// then at least one date and/or time component. Rejects the empty `P`, a lone
// `T`, and anything with stray characters — so an untrusted triggerOffset is
// validated before it is written as a typed literal. NB the WEEK form (`nW`) is
// deliberately NOT accepted: XSD 1.1 `xsd:duration` does not permit it, so a
// `P1W` value would be written as an invalid literal — dropped instead.
const ISO_DURATION = /^-?P(?=[\dYMDTH.S])(\d+Y)?(\d+M)?(\d+D)?(T(?=[\dHMS.])(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;
/** A well-formed `xsd:duration` string (no week form), else `undefined`. */
function durationOrUndefined(value) {
    return typeof value === "string" && ISO_DURATION.test(value) ? value : undefined;
}
/**
 * A VALID `Date`, else `undefined` — so an `Invalid Date` (e.g. `new Date("x")`)
 * never reaches `LiteralFrom.dateTime`, whose `toISOString()` would otherwise
 * throw and abort the whole build on hostile/sloppy input.
 */
function validDateOrUndefined(value) {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
}
/** The four known recurrence frequencies (uppercased). */
const FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
/** A known frequency (uppercased), else `undefined`. */
function normalizeFrequency(value) {
    const v = (value ?? "").trim().toUpperCase();
    return FREQUENCIES.has(v) ? v : undefined;
}
/**
 * Typed `@rdfjs/wrapper` view of the scheduling task (`sched:Task`) subject. Each
 * accessor reads/writes through the vetted mappers — no quad is ever hand-built.
 */
export class SchedulingTask extends TermWrapper {
    /** The task subject IRI. */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set as a live set of IRI strings. */
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `sched:Task`. Idempotent; returns `this`. */
    mark() {
        this.types.add(TASK_CLASS);
        return this;
    }
    /** Whether this subject is a `sched:Task`. */
    get isSchedulingTask() {
        return this.types.has(TASK_CLASS);
    }
    /** `sched:summary` — the title. */
    get summary() {
        return OptionalFrom.subjectPredicate(this, SCHED_SUMMARY, LiteralAs.string);
    }
    set summary(value) {
        OptionalAs.object(this, SCHED_SUMMARY, value, LiteralFrom.string);
    }
    /** `sched:description` — the body. */
    get description() {
        return OptionalFrom.subjectPredicate(this, SCHED_DESCRIPTION, LiteralAs.string);
    }
    set description(value) {
        OptionalAs.object(this, SCHED_DESCRIPTION, value, LiteralFrom.string);
    }
    /** `sched:startTime` — clock start (xsd:dateTime). */
    get startTime() {
        return OptionalFrom.subjectPredicate(this, SCHED_START_TIME, LiteralAs.date);
    }
    set startTime(value) {
        OptionalAs.object(this, SCHED_START_TIME, value, LiteralFrom.dateTime);
    }
    /** `sched:dueTime` — the due date (xsd:dateTime). */
    get dueTime() {
        return OptionalFrom.subjectPredicate(this, SCHED_DUE_TIME, LiteralAs.date);
    }
    set dueTime(value) {
        OptionalAs.object(this, SCHED_DUE_TIME, value, LiteralFrom.dateTime);
    }
    /** `sched:completed` — completion flag (xsd:boolean). */
    get completed() {
        return OptionalFrom.subjectPredicate(this, SCHED_COMPLETED, LiteralAs.boolean);
    }
    set completed(value) {
        OptionalAs.object(this, SCHED_COMPLETED, value, LiteralFrom.boolean);
    }
    /** `sched:completedAt` — completion time (xsd:dateTime). */
    get completedAt() {
        return OptionalFrom.subjectPredicate(this, SCHED_COMPLETED_AT, LiteralAs.date);
    }
    set completedAt(value) {
        OptionalAs.object(this, SCHED_COMPLETED_AT, value, LiteralFrom.dateTime);
    }
    /** `sched:organizer` — the owner/organiser WebID (an IRI). */
    get organizer() {
        return OptionalFrom.subjectPredicate(this, SCHED_ORGANIZER, NamedNodeAs.string);
    }
    set organizer(value) {
        OptionalAs.object(this, SCHED_ORGANIZER, value, NamedNodeFrom.string);
    }
    /** `sched:inCalendar` — the calendar/project IRI (→ a `sched:Calendar`). */
    get calendar() {
        return OptionalFrom.subjectPredicate(this, SCHED_IN_CALENDAR, NamedNodeAs.string);
    }
    set calendar(value) {
        OptionalAs.object(this, SCHED_IN_CALENDAR, value, NamedNodeFrom.string);
    }
    /** `dct:subject` — the label set (free-text strings). */
    get labels() {
        return SetFrom.subjectPredicate(this, DCT_SUBJECT, LiteralAs.string, LiteralFrom.string);
    }
    /** `sched:recurrence` — the recurrence-rule node IRI (→ a `sched:RecurrenceRule`). */
    get recurrence() {
        return OptionalFrom.subjectPredicate(this, SCHED_RECURRENCE, NamedNodeAs.string);
    }
    set recurrence(value) {
        OptionalAs.object(this, SCHED_RECURRENCE, value, NamedNodeFrom.string);
    }
    /** `sched:hasReminder` — the reminder node IRIs (→ `sched:Reminder`s). */
    get reminders() {
        return SetFrom.subjectPredicate(this, SCHED_HAS_REMINDER, NamedNodeAs.string, NamedNodeFrom.string);
    }
}
/** Typed view of a `sched:RecurrenceRule` node. */
export class RecurrenceRule extends TermWrapper {
    /** Stamp this subject as a `sched:RecurrenceRule`. Idempotent; returns `this`. */
    mark() {
        SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(RECURRENCE_RULE_CLASS);
        return this;
    }
    /** `sched:frequency` — DAILY / WEEKLY / MONTHLY / YEARLY. */
    get frequency() {
        return OptionalFrom.subjectPredicate(this, SCHED_FREQUENCY, LiteralAs.string);
    }
    set frequency(value) {
        OptionalAs.object(this, SCHED_FREQUENCY, value, LiteralFrom.string);
    }
    /** `sched:interval` — every N units (xsd:positiveInteger). */
    get interval() {
        return OptionalFrom.subjectPredicate(this, SCHED_INTERVAL, LiteralAs.number);
    }
    set interval(value) {
        // xsd:positiveInteger via a datatype tuple (LiteralFrom.integer would type it
        // xsd:integer, which the sector's xsd:positiveInteger range would reject).
        OptionalAs.object(this, SCHED_INTERVAL, value === undefined ? undefined : [XSD_POSITIVE_INTEGER, String(value)], LiteralFrom.datatypeTuple);
    }
    /** `sched:count` — total occurrences (xsd:positiveInteger). */
    get count() {
        return OptionalFrom.subjectPredicate(this, SCHED_COUNT, LiteralAs.number);
    }
    set count(value) {
        OptionalAs.object(this, SCHED_COUNT, value === undefined ? undefined : [XSD_POSITIVE_INTEGER, String(value)], LiteralFrom.datatypeTuple);
    }
    /** `sched:until` — the last occurrence date/time (xsd:dateTime). */
    get until() {
        return OptionalFrom.subjectPredicate(this, SCHED_UNTIL, LiteralAs.date);
    }
    set until(value) {
        OptionalAs.object(this, SCHED_UNTIL, value, LiteralFrom.dateTime);
    }
}
/** Typed view of a `sched:Reminder` node. */
export class Reminder extends TermWrapper {
    /** Stamp this subject as a `sched:Reminder`. Idempotent; returns `this`. */
    mark() {
        SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(REMINDER_CLASS);
        return this;
    }
    /** `sched:triggerTime` — absolute fire time (xsd:dateTime). */
    get triggerTime() {
        return OptionalFrom.subjectPredicate(this, SCHED_TRIGGER_TIME, LiteralAs.date);
    }
    set triggerTime(value) {
        OptionalAs.object(this, SCHED_TRIGGER_TIME, value, LiteralFrom.dateTime);
    }
    /** `sched:triggerOffset` — relative offset (xsd:duration string, e.g. `-PT15M`). */
    get triggerOffset() {
        return OptionalFrom.subjectPredicate(this, SCHED_TRIGGER_OFFSET, LiteralAs.string);
    }
    set triggerOffset(value) {
        OptionalAs.object(this, SCHED_TRIGGER_OFFSET, value === undefined ? undefined : [XSD_DURATION, value], LiteralFrom.datatypeTuple);
    }
}
/**
 * Project a {@link SchedulingTaskData} onto the shared `wf:Task` {@link TaskData}
 * shape — the SAME `#it` subject, so a Vikunja task also reads as a federated
 * `wf:Task` ("assigned to me" in the Pod Manager). `buildTask` owns the untrusted
 * http(s) filtering of the WebID/relation IRIs and the wf:Open/wf:Closed +
 * `prov:endedAtTime` state management.
 */
function toWfTaskData(data, completedAt) {
    const wf = {
        title: data.summary,
        state: data.completed ? "closed" : "open",
    };
    setIfDefined(wf, "description", data.description);
    // Single source of truth for the completion timestamp (computed once in
    // buildSchedulingTask): the SAME value is written to prov:endedAtTime (here,
    // via buildTask) and to sched:completedAt, so the two graphs never diverge.
    setIfDefined(wf, "endedAt", completedAt);
    setIfDefined(wf, "creator", data.organizer);
    setIfDefined(wf, "assignee", data.assignee);
    setIfDefined(wf, "project", data.calendar);
    // Validated so an Invalid Date can't reach buildTask's LiteralFrom.dateTime.
    setIfDefined(wf, "dueDate", validDateOrUndefined(data.dueTime));
    setIfDefined(wf, "priority", data.priority);
    setIfDefined(wf, "rank", data.position);
    setIfDefined(wf, "parent", data.parent);
    setIfDefined(wf, "blockedBy", data.blockedBy);
    setIfDefined(wf, "relatesTo", data.relatesTo);
    setIfDefined(wf, "duplicateOf", data.duplicateOf);
    return wf;
}
/**
 * Build the RDF `Store` for a task from a plain {@link SchedulingTaskData}, via
 * the typed accessors (no hand-built quads). The store carries BOTH the
 * `sched:Task` triples AND the shared `wf:Task` triples on `${resourceUrl}#it`.
 *
 * - `summary` is written only when non-empty (the shape requires a title).
 * - On close, `sched:completedAt` (and, via `buildTask`, `prov:endedAtTime`)
 *   default to now.
 * - `organizer` / `calendar` are dropped unless absolute http(s) IRIs.
 * - `interval` / `count` are dropped unless positive integers; a `triggerOffset`
 *   is dropped unless a well-formed `xsd:duration`; a frequency is dropped unless
 *   a known DAILY/WEEKLY/MONTHLY/YEARLY value.
 */
export function buildSchedulingTask(resourceUrl, data) {
    // Single source of truth for the completion timestamp: computed ONCE here and
    // written to BOTH graphs (prov:endedAtTime via buildTask + sched:completedAt),
    // so they can never diverge. Only meaningful for a closed task; a raw provided
    // completedAt is validated so an Invalid Date can't reach LiteralFrom.dateTime.
    const completedAt = data.completed === true ? (validDateOrUndefined(data.completedAt) ?? new Date()) : undefined;
    // Start from the shared wf:Task store (federation edge), then layer sched: on
    // the same #it subject. buildTask owns the untrusted IRI filtering + state.
    const store = new Store([...buildTask(resourceUrl, toWfTaskData(data, completedAt))]);
    const iris = schedulingNodeIris(resourceUrl);
    const task = new SchedulingTask(iris.task, store, DataFactory).mark();
    task.summary = data.summary || undefined;
    task.description = data.description || undefined;
    task.startTime = validDateOrUndefined(data.startTime);
    task.dueTime = validDateOrUndefined(data.dueTime);
    if (data.completed !== undefined)
        task.completed = data.completed;
    task.completedAt = completedAt;
    // organizer/calendar are untrusted IRIs: drop anything not absolute http(s).
    task.organizer = httpIriOrUndefined(data.organizer);
    task.calendar = httpIriOrUndefined(data.calendar);
    for (const label of data.labels ?? []) {
        const l = label.trim();
        if (l)
            task.labels.add(l);
    }
    // A recurrence with no KNOWN frequency is not a usable rule (the shape makes
    // sched:frequency a MUST). Drop the WHOLE recurrence — no orphan node, no
    // sched:recurrence link — rather than leave a SHACL-invalid frequency-less node.
    const frequency = data.recurrence ? normalizeFrequency(data.recurrence.frequency) : undefined;
    if (data.recurrence && frequency !== undefined) {
        const rule = new RecurrenceRule(iris.recurrence, store, DataFactory).mark();
        rule.frequency = frequency;
        rule.interval = positiveIntOrUndefined(data.recurrence.interval);
        rule.count = positiveIntOrUndefined(data.recurrence.count);
        rule.until = validDateOrUndefined(data.recurrence.until);
        task.recurrence = iris.recurrence;
    }
    // A reminder that carries neither a valid trigger time nor a well-formed offset
    // is empty: skip it entirely (no orphan node) rather than link a contentless one.
    (data.reminders ?? []).forEach((r, i) => {
        const triggerTime = validDateOrUndefined(r.triggerTime);
        const triggerOffset = durationOrUndefined(r.triggerOffset);
        if (triggerTime === undefined && triggerOffset === undefined)
            return;
        const iri = reminderIri(resourceUrl, i);
        const rem = new Reminder(iri, store, DataFactory).mark();
        rem.triggerTime = triggerTime;
        rem.triggerOffset = triggerOffset;
        task.reminders.add(iri);
    });
    return store;
}
/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export function storeToTurtle(store) {
    const writer = new Writer({ prefixes: { ...PREFIXES } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/** Build + serialise a task to a Turtle document in one call. */
export function serializeSchedulingTask(resourceUrl, data) {
    return storeToTurtle(buildSchedulingTask(resourceUrl, data));
}
/** Read a {@link RecurrenceData} from a recurrence-rule node, or `undefined`. */
function parseRecurrence(recIri, dataset) {
    const rule = new RecurrenceRule(recIri, dataset, DataFactory);
    const frequency = normalizeFrequency(tryRead(() => rule.frequency));
    if (frequency === undefined)
        return undefined;
    const rec = { frequency: frequency };
    setIfDefined(rec, "interval", positiveIntOrUndefined(tryRead(() => rule.interval)));
    setIfDefined(rec, "count", positiveIntOrUndefined(tryRead(() => rule.count)));
    setIfDefined(rec, "until", tryRead(() => rule.until));
    return rec;
}
/** Read a {@link ReminderData} from a reminder node, or `undefined` if it carries nothing. */
function parseReminder(iri, dataset) {
    const rem = new Reminder(iri, dataset, DataFactory);
    const reminder = {};
    setIfDefined(reminder, "triggerTime", tryRead(() => rem.triggerTime));
    setIfDefined(reminder, "triggerOffset", durationOrUndefined(tryRead(() => rem.triggerOffset)));
    return reminder.triggerTime === undefined && reminder.triggerOffset === undefined
        ? undefined
        : reminder;
}
/**
 * Read a {@link SchedulingTaskData} back from an RDF dataset (the inverse of
 * {@link buildSchedulingTask}). Returns `undefined` unless the subject is a
 * `sched:Task` carrying a `sched:summary`. Every optional field is `tryRead`-
 * guarded and IRI fields are http(s)-filtered; the federation fields (assignee,
 * priority, position, parent, relations) are read back through the shared
 * `wf:Task` model so they agree byte-for-byte with what the Pod Manager sees.
 */
export function parseSchedulingTask(resourceUrl, dataset) {
    const task = new SchedulingTask(schedulingTaskSubject(resourceUrl), dataset, DataFactory);
    if (!task.isSchedulingTask)
        return undefined;
    const summary = tryRead(() => task.summary);
    if (summary === undefined)
        return undefined;
    const data = { summary };
    setIfDefined(data, "description", tryRead(() => task.description));
    setIfDefined(data, "startTime", tryRead(() => task.startTime));
    setIfDefined(data, "dueTime", tryRead(() => task.dueTime));
    const completed = tryRead(() => task.completed);
    if (completed !== undefined)
        data.completed = completed;
    setIfDefined(data, "completedAt", tryRead(() => task.completedAt));
    setIfDefined(data, "organizer", httpIriOrUndefined(tryRead(() => task.organizer)));
    setIfDefined(data, "calendar", httpIriOrUndefined(tryRead(() => task.calendar)));
    const labels = (tryRead(() => [...task.labels]) ?? []).filter((l) => typeof l === "string" && l.trim().length > 0);
    if (labels.length > 0)
        data.labels = labels;
    const recIri = httpIriOrUndefined(tryRead(() => task.recurrence));
    if (recIri !== undefined) {
        const rec = parseRecurrence(recIri, dataset);
        if (rec !== undefined)
            data.recurrence = rec;
    }
    const reminderIris = (tryRead(() => [...task.reminders]) ?? []).filter((i) => httpIriOrUndefined(i) !== undefined);
    const reminders = reminderIris
        .map((iri) => parseReminder(iri, dataset))
        .filter((r) => r !== undefined);
    if (reminders.length > 0)
        data.reminders = reminders;
    // Federation fields (wf-only): read through the shared wf:Task model so a
    // Vikunja task's assignee/priority/order/relations agree with the Pod Manager.
    const wf = parseTask(resourceUrl, dataset);
    if (wf !== undefined) {
        setIfDefined(data, "assignee", wf.assignee);
        setIfDefined(data, "priority", wf.priority);
        setIfDefined(data, "position", wf.rank);
        setIfDefined(data, "parent", wf.parent);
        if (wf.blockedBy !== undefined && wf.blockedBy.length > 0)
            data.blockedBy = wf.blockedBy;
        if (wf.relatesTo !== undefined && wf.relatesTo.length > 0)
            data.relatesTo = wf.relatesTo;
        setIfDefined(data, "duplicateOf", wf.duplicateOf);
    }
    return data;
}
/**
 * Parse a fetched RDF document into {@link SchedulingTaskData}, via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite RDF parse seam — never a bespoke
 * parser). `contentType` is the response `Content-Type`; a missing/`null` header
 * is coalesced to `text/turtle`. The resource URL doubles as the base IRI.
 */
export async function parseSchedulingTaskTtl(resourceUrl, body, contentType = "text/turtle") {
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
    return parseSchedulingTask(resourceUrl, dataset);
}
//# sourceMappingURL=task.js.map