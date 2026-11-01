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
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/** A calendar (Vikunja project/list) as a plain, serialisable object. */
export interface CalendarData {
    /** `sched:summary` — the calendar name; the one required field. */
    summary: string;
    /** `sched:description` — a longer description. */
    description?: string;
    /** `sched:organizer` — the owning agent's WebID. */
    organizer?: string;
}
/** The conventional subject IRI for the `sched:Calendar` at `resourceUrl`. */
export declare function calendarSubject(resourceUrl: string): string;
/** Typed `@rdfjs/wrapper` view of a `sched:Calendar` subject. */
export declare class Calendar extends TermWrapper {
    /** The calendar subject IRI. */
    get id(): string;
    /** The `rdf:type` set. */
    get types(): Set<string>;
    /** Stamp this subject as a `sched:Calendar`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `sched:Calendar`. */
    get isCalendar(): boolean;
    /** `sched:summary` — the calendar name. */
    get summary(): string | undefined;
    set summary(value: string | undefined);
    /** `sched:description` — the description. */
    get description(): string | undefined;
    set description(value: string | undefined);
    /** `sched:organizer` — the owner WebID (an IRI). */
    get organizer(): string | undefined;
    set organizer(value: string | undefined);
}
/** Build the RDF `Store` for a calendar from a plain {@link CalendarData}. */
export declare function buildCalendar(resourceUrl: string, data: CalendarData): Store;
/** Serialise a `Store` to Turtle with the model's prefixes. */
export declare function calendarStoreToTurtle(store: Store): Promise<string>;
/** Build + serialise a calendar to a Turtle document in one call. */
export declare function serializeCalendar(resourceUrl: string, data: CalendarData): Promise<string>;
/**
 * Read a {@link CalendarData} back from a dataset, or `undefined` unless the
 * subject is a `sched:Calendar` carrying a `sched:summary`. Untrusted-input
 * hardened (organizer is http(s)-filtered; reads are `tryRead`-guarded).
 */
export declare function parseCalendar(resourceUrl: string, dataset: DatasetCore): CalendarData | undefined;
/**
 * Parse a fetched RDF document into {@link CalendarData}, via `@jeswr/fetch-rdf`'s
 * `parseRdf` (the suite RDF parse seam). `contentType` defaults to `text/turtle`.
 */
export declare function parseCalendarTtl(resourceUrl: string, body: string, contentType?: string | null): Promise<CalendarData | undefined>;
//# sourceMappingURL=calendar.d.ts.map