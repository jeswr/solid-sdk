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
import { type TaskPriority } from "@jeswr/solid-task-model/task";
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
export type { TaskPriority } from "@jeswr/solid-task-model/task";
export { isHttpIri } from "./iri.js";
/** A recurrence rule (a repeating task — Vikunja's real repeating tasks). */
export interface RecurrenceData {
    /** `sched:frequency` — DAILY / WEEKLY / MONTHLY / YEARLY (uppercased on write). */
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    /** `sched:interval` — every N frequency units (a positive integer). */
    interval?: number;
    /** `sched:count` — total number of occurrences (a positive integer). */
    count?: number;
    /** `sched:until` — the last date/time the rule may produce an occurrence. */
    until?: Date;
}
/** A reminder/alarm attached to a task. */
export interface ReminderData {
    /** `sched:triggerTime` — the absolute time the reminder fires. */
    triggerTime?: Date;
    /**
     * `sched:triggerOffset` — a relative ISO-8601 duration offset from the entry's
     * start (e.g. `-PT15M` for 15 minutes before). Dropped if not a well-formed
     * `xsd:duration`.
     */
    triggerOffset?: string;
}
/**
 * A scheduling task as a plain, serialisable object — the shape a Vikunja→Solid
 * fork's importer works with. `summary` is the one load-bearing field; everything
 * else is optional. The federation fields (`assignee`, `priority`, `position`,
 * `parent`, `blockedBy`, `relatesTo`, `duplicateOf`) round-trip through the shared
 * `wf:Task` shape so they read identically in the Pod Manager / solid-issues.
 */
export interface SchedulingTaskData {
    /** `sched:summary` (+ `dct:title` on the `wf:Task`) — the title; the one required field. */
    summary: string;
    /** `sched:description` (+ `wf:description`) — the body. */
    description?: string;
    /** `sched:startTime` — clock start. */
    startTime?: Date;
    /** `sched:dueTime` (+ `wf:dateDue`) — when the task is due. */
    dueTime?: Date;
    /** `sched:completed` (+ `wf:Open`/`wf:Closed`) — whether the task is done. */
    completed?: boolean;
    /**
     * `sched:completedAt` (+ `prov:endedAtTime`) — completion time. A valid value
     * is preserved and IMPLIES completion (the task is treated as closed) unless
     * `completed` is an explicit `false`, which drops it. When a task is closed but
     * no timestamp is supplied, it defaults to now. The same instant is written to
     * both the `sched:` graph and the `wf:Task` overlay, so they never diverge.
     */
    completedAt?: Date;
    /** `sched:organizer` (+ `dct:creator`) — the owner/organiser WebID. */
    organizer?: string;
    /**
     * `wf:assignee` — the assigned agent's WebID. **The federation edge**: this is
     * the predicate the Pod Manager reads for its "assigned to me" gate. The
     * scheduling sector has no task-assignee term (see `DECISIONS.md` / the
     * proposals), so this is carried via the shared `wf:Task` only.
     */
    assignee?: string;
    /** `sched:inCalendar` (+ `wf:tracker`) — the calendar / project the task belongs to. */
    calendar?: string;
    /** `schema:priority` (via `wf:Task`) — high / medium / low. */
    priority?: TaskPriority;
    /**
     * `schema:position` (via `wf:Task`) — the kanban bucket/board ORDER; lower sorts
     * first. Carried through the shared model because the scheduling sector has no
     * ordering term (a `fedcon:Proposal` gap — see `DECISIONS.md`).
     */
    position?: number;
    /**
     * `dct:subject` — free-text task labels. Reuse-before-mint: the sector has no
     * label term, so labels reuse `dct:subject` (see the proposals / `DECISIONS.md`).
     */
    labels?: string[];
    /** `dct:isPartOf` (via `wf:Task`) — the parent task (this is a subtask of it). */
    parent?: string;
    /** `dct:requires` (via `wf:Task`) — tasks that must be done first (blocked by). */
    blockedBy?: string[];
    /** `dct:relation` (via `wf:Task`) — non-blocking relates-to links. */
    relatesTo?: string[];
    /** `dct:isReplacedBy` (via `wf:Task`) — the canonical successor (duplicate-of). */
    duplicateOf?: string;
    /** `sched:recurrence` — a recurrence rule (repeating task). */
    recurrence?: RecurrenceData;
    /** `sched:hasReminder` — reminders/alarms. */
    reminders?: ReminderData[];
}
/** The conventional subject IRI for the task (`sched:Task` + `wf:Task`) at `resourceUrl`. */
export declare function schedulingTaskSubject(resourceUrl: string): string;
/** The conventional subject IRIs of the nodes in a task document. */
export declare function schedulingNodeIris(resourceUrl: string): {
    task: string;
    recurrence: string;
};
/** The conventional subject IRI of the i-th reminder in a task document. */
export declare function reminderIri(resourceUrl: string, index: number): string;
/**
 * Typed `@rdfjs/wrapper` view of the scheduling task (`sched:Task`) subject. Each
 * accessor reads/writes through the vetted mappers — no quad is ever hand-built.
 */
export declare class SchedulingTask extends TermWrapper {
    /** The task subject IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp this subject as a `sched:Task`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `sched:Task`. */
    get isSchedulingTask(): boolean;
    /** `sched:summary` — the title. */
    get summary(): string | undefined;
    set summary(value: string | undefined);
    /** `sched:description` — the body. */
    get description(): string | undefined;
    set description(value: string | undefined);
    /** `sched:startTime` — clock start (xsd:dateTime). */
    get startTime(): Date | undefined;
    set startTime(value: Date | undefined);
    /** `sched:dueTime` — the due date (xsd:dateTime). */
    get dueTime(): Date | undefined;
    set dueTime(value: Date | undefined);
    /** `sched:completed` — completion flag (xsd:boolean). */
    get completed(): boolean | undefined;
    set completed(value: boolean | undefined);
    /** `sched:completedAt` — completion time (xsd:dateTime). */
    get completedAt(): Date | undefined;
    set completedAt(value: Date | undefined);
    /** `sched:organizer` — the owner/organiser WebID (an IRI). */
    get organizer(): string | undefined;
    set organizer(value: string | undefined);
    /** `sched:inCalendar` — the calendar/project IRI (→ a `sched:Calendar`). */
    get calendar(): string | undefined;
    set calendar(value: string | undefined);
    /** `dct:subject` — the label set (free-text strings). */
    get labels(): Set<string>;
    /** `sched:recurrence` — the recurrence-rule node IRI (→ a `sched:RecurrenceRule`). */
    get recurrence(): string | undefined;
    set recurrence(value: string | undefined);
    /** `sched:hasReminder` — the reminder node IRIs (→ `sched:Reminder`s). */
    get reminders(): Set<string>;
}
/** Typed view of a `sched:RecurrenceRule` node. */
export declare class RecurrenceRule extends TermWrapper {
    /** Stamp this subject as a `sched:RecurrenceRule`. Idempotent; returns `this`. */
    mark(): this;
    /** `sched:frequency` — DAILY / WEEKLY / MONTHLY / YEARLY. */
    get frequency(): string | undefined;
    set frequency(value: string | undefined);
    /** `sched:interval` — every N units (xsd:positiveInteger). */
    get interval(): number | undefined;
    set interval(value: number | undefined);
    /** `sched:count` — total occurrences (xsd:positiveInteger). */
    get count(): number | undefined;
    set count(value: number | undefined);
    /** `sched:until` — the last occurrence date/time (xsd:dateTime). */
    get until(): Date | undefined;
    set until(value: Date | undefined);
}
/** Typed view of a `sched:Reminder` node. */
export declare class Reminder extends TermWrapper {
    /** Stamp this subject as a `sched:Reminder`. Idempotent; returns `this`. */
    mark(): this;
    /** `sched:triggerTime` — absolute fire time (xsd:dateTime). */
    get triggerTime(): Date | undefined;
    set triggerTime(value: Date | undefined);
    /** `sched:triggerOffset` — relative offset (xsd:duration string, e.g. `-PT15M`). */
    get triggerOffset(): string | undefined;
    set triggerOffset(value: string | undefined);
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
export declare function buildSchedulingTask(resourceUrl: string, data: SchedulingTaskData): Store;
/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export declare function storeToTurtle(store: Store): Promise<string>;
/** Build + serialise a task to a Turtle document in one call. */
export declare function serializeSchedulingTask(resourceUrl: string, data: SchedulingTaskData): Promise<string>;
/**
 * Read a {@link SchedulingTaskData} back from an RDF dataset (the inverse of
 * {@link buildSchedulingTask}). Returns `undefined` unless the subject is a
 * `sched:Task` carrying a `sched:summary`. Every optional field is `tryRead`-
 * guarded and IRI fields are http(s)-filtered; the federation fields (assignee,
 * priority, position, parent, relations) are read back through the shared
 * `wf:Task` model so they agree byte-for-byte with what the Pod Manager sees.
 */
export declare function parseSchedulingTask(resourceUrl: string, dataset: DatasetCore): SchedulingTaskData | undefined;
/**
 * Parse a fetched RDF document into {@link SchedulingTaskData}, via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite RDF parse seam — never a bespoke
 * parser). `contentType` is the response `Content-Type`; a missing/`null` header
 * is coalesced to `text/turtle`. The resource URL doubles as the base IRI.
 */
export declare function parseSchedulingTaskTtl(resourceUrl: string, body: string, contentType?: string | null): Promise<SchedulingTaskData | undefined>;
//# sourceMappingURL=task.d.ts.map