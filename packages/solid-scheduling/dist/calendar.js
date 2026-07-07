// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The scheduling **Calendar** model — typed read/write accessors over a
 * `sched:Calendar` descriptor (the Vikunja "project" / "list" a task belongs to
 * via `sched:inCalendar`).
 *
 * A calendar is a small named container descriptor: a summary, an optional
 * description, and an optional organiser WebID. Tasks reference it by IRI
 * (`SchedulingTaskData.calendar` → `sched:inCalendar`). Mints nothing — reuses the
 * scheduling sector's `sched:Calendar` / `sched:summary` / `sched:description` /
 * `sched:organizer` verbatim. Typed accessors only; never a hand-built triple.
 */
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import { CALENDAR_CLASS, PREFIXES, RDF_TYPE, SCHED_DESCRIPTION, SCHED_ORGANIZER, SCHED_SUMMARY, } from "./vocab.js";
/** The conventional subject IRI for the `sched:Calendar` at `resourceUrl`. */
export function calendarSubject(resourceUrl) {
    return `${resourceUrl}#it`;
}
/** Assign `target[key] = value` ONLY when `value` is defined. */
function setIfDefined(target, key, value) {
    if (value !== undefined)
        target[key] = value;
}
/** Run an untrusted read, returning `undefined` on any throw. */
function tryRead(fn) {
    try {
        return fn();
    }
    catch {
        return undefined;
    }
}
/** Typed `@rdfjs/wrapper` view of a `sched:Calendar` subject. */
export class Calendar extends TermWrapper {
    /** The calendar subject IRI. */
    get id() {
        return this.value;
    }
    /** The `rdf:type` set. */
    get types() {
        return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    }
    /** Stamp this subject as a `sched:Calendar`. Idempotent; returns `this`. */
    mark() {
        this.types.add(CALENDAR_CLASS);
        return this;
    }
    /** Whether this subject is a `sched:Calendar`. */
    get isCalendar() {
        return this.types.has(CALENDAR_CLASS);
    }
    /** `sched:summary` — the calendar name. */
    get summary() {
        return OptionalFrom.subjectPredicate(this, SCHED_SUMMARY, LiteralAs.string);
    }
    set summary(value) {
        OptionalAs.object(this, SCHED_SUMMARY, value, LiteralFrom.string);
    }
    /** `sched:description` — the description. */
    get description() {
        return OptionalFrom.subjectPredicate(this, SCHED_DESCRIPTION, LiteralAs.string);
    }
    set description(value) {
        OptionalAs.object(this, SCHED_DESCRIPTION, value, LiteralFrom.string);
    }
    /** `sched:organizer` — the owner WebID (an IRI). */
    get organizer() {
        return OptionalFrom.subjectPredicate(this, SCHED_ORGANIZER, NamedNodeAs.string);
    }
    set organizer(value) {
        OptionalAs.object(this, SCHED_ORGANIZER, value, NamedNodeFrom.string);
    }
}
/** Build the RDF `Store` for a calendar from a plain {@link CalendarData}. */
export function buildCalendar(resourceUrl, data) {
    const store = new Store();
    const cal = new Calendar(calendarSubject(resourceUrl), store, DataFactory).mark();
    cal.summary = data.summary || undefined;
    cal.description = data.description || undefined;
    cal.organizer = httpIriOrUndefined(data.organizer);
    return store;
}
/** Serialise a `Store` to Turtle with the model's prefixes. */
export function calendarStoreToTurtle(store) {
    const writer = new Writer({ prefixes: { ...PREFIXES } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/** Build + serialise a calendar to a Turtle document in one call. */
export function serializeCalendar(resourceUrl, data) {
    return calendarStoreToTurtle(buildCalendar(resourceUrl, data));
}
/**
 * Read a {@link CalendarData} back from a dataset, or `undefined` unless the
 * subject is a `sched:Calendar` carrying a `sched:summary`. Untrusted-input
 * hardened (organizer is http(s)-filtered; reads are `tryRead`-guarded).
 */
export function parseCalendar(resourceUrl, dataset) {
    const cal = new Calendar(calendarSubject(resourceUrl), dataset, DataFactory);
    if (!cal.isCalendar)
        return undefined;
    const summary = tryRead(() => cal.summary);
    if (summary === undefined)
        return undefined;
    const data = { summary };
    setIfDefined(data, "description", tryRead(() => cal.description));
    setIfDefined(data, "organizer", httpIriOrUndefined(tryRead(() => cal.organizer)));
    return data;
}
/**
 * Parse a fetched RDF document into {@link CalendarData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam). `contentType` defaults to `text/turtle`.
 */
export async function parseCalendarTtl(resourceUrl, body, contentType = "text/turtle") {
    const resolvedContentType = contentType ?? "text/turtle";
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
    return parseCalendar(resourceUrl, dataset);
}
//# sourceMappingURL=calendar.js.map