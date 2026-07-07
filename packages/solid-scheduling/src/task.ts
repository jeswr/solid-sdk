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

import {
  buildTask,
  parseTask,
  type TaskData,
  type TaskPriority,
} from "@jeswr/solid-task-model/task";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import {
  DCT_SUBJECT,
  PREFIXES,
  RDF_TYPE,
  RECURRENCE_RULE_CLASS,
  REMINDER_CLASS,
  SCHED_COMPLETED,
  SCHED_COMPLETED_AT,
  SCHED_COUNT,
  SCHED_DESCRIPTION,
  SCHED_DUE_TIME,
  SCHED_FREQUENCY,
  SCHED_HAS_REMINDER,
  SCHED_IN_CALENDAR,
  SCHED_INTERVAL,
  SCHED_ORGANIZER,
  SCHED_RECURRENCE,
  SCHED_START_TIME,
  SCHED_SUMMARY,
  SCHED_TRIGGER_OFFSET,
  SCHED_TRIGGER_TIME,
  SCHED_UNTIL,
  TASK_CLASS,
  XSD_DURATION,
  XSD_POSITIVE_INTEGER,
} from "./vocab.js";

// Re-export the shared priority type so a consumer needn't import task-model too.
export type { TaskPriority } from "@jeswr/solid-task-model/task";
// Re-exported so the `.` entry point keeps exposing the untrusted-input filter.
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
  /** `sched:completedAt` (+ `prov:endedAtTime`) — completion time; defaults to now on close. */
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
export function schedulingTaskSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

/** The conventional subject IRIs of the nodes in a task document. */
export function schedulingNodeIris(resourceUrl: string): {
  task: string;
  recurrence: string;
} {
  return {
    task: `${resourceUrl}#it`,
    recurrence: `${resourceUrl}#recurrence`,
  };
}

/** The conventional subject IRI of the i-th reminder in a task document. */
export function reminderIri(resourceUrl: string, index: number): string {
  return `${resourceUrl}#reminder${index}`;
}

/** Assign `target[key] = value` ONLY when `value` is defined. */
function setIfDefined<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/**
 * Run an untrusted read, returning `undefined` on ANY throw (a malformed foreign
 * literal drops the field, never aborts the parse). A returned `Invalid Date` is
 * treated as absent too.
 */
function tryRead<T>(fn: () => T | undefined): T | undefined {
  try {
    const value = fn();
    if (value instanceof Date && Number.isNaN(value.getTime())) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** A positive integer, else `undefined` — the `sched:interval`/`sched:count` filter. */
function positiveIntOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

// A conservative ISO-8601 duration (`xsd:duration`) matcher: an optional leading
// `-`, `P`, then at least one date and/or time component. Rejects the empty `P`,
// a lone `T`, and anything with stray characters — so an untrusted triggerOffset
// is validated before it is written as a typed literal.
const ISO_DURATION =
  /^-?P(?=[\dYMWDTH.S])(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=[\dHMS.])(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

/** A well-formed `xsd:duration` string, else `undefined`. */
function durationOrUndefined(value: string | undefined): string | undefined {
  return typeof value === "string" && ISO_DURATION.test(value) ? value : undefined;
}

/** The four known recurrence frequencies (uppercased). */
const FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** A known frequency (uppercased), else `undefined`. */
function normalizeFrequency(value: string | undefined): string | undefined {
  const v = (value ?? "").trim().toUpperCase();
  return FREQUENCIES.has(v) ? v : undefined;
}

/**
 * Typed `@rdfjs/wrapper` view of the scheduling task (`sched:Task`) subject. Each
 * accessor reads/writes through the vetted mappers — no quad is ever hand-built.
 */
export class SchedulingTask extends TermWrapper {
  /** The task subject IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `sched:Task`. Idempotent; returns `this`. */
  mark(): this {
    this.types.add(TASK_CLASS);
    return this;
  }

  /** Whether this subject is a `sched:Task`. */
  get isSchedulingTask(): boolean {
    return this.types.has(TASK_CLASS);
  }

  /** `sched:summary` — the title. */
  get summary(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_SUMMARY, LiteralAs.string);
  }
  set summary(value: string | undefined) {
    OptionalAs.object(this, SCHED_SUMMARY, value, LiteralFrom.string);
  }

  /** `sched:description` — the body. */
  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_DESCRIPTION, LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, SCHED_DESCRIPTION, value, LiteralFrom.string);
  }

  /** `sched:startTime` — clock start (xsd:dateTime). */
  get startTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_START_TIME, LiteralAs.date);
  }
  set startTime(value: Date | undefined) {
    OptionalAs.object(this, SCHED_START_TIME, value, LiteralFrom.dateTime);
  }

  /** `sched:dueTime` — the due date (xsd:dateTime). */
  get dueTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_DUE_TIME, LiteralAs.date);
  }
  set dueTime(value: Date | undefined) {
    OptionalAs.object(this, SCHED_DUE_TIME, value, LiteralFrom.dateTime);
  }

  /** `sched:completed` — completion flag (xsd:boolean). */
  get completed(): boolean | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_COMPLETED, LiteralAs.boolean);
  }
  set completed(value: boolean | undefined) {
    OptionalAs.object(this, SCHED_COMPLETED, value, LiteralFrom.boolean);
  }

  /** `sched:completedAt` — completion time (xsd:dateTime). */
  get completedAt(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_COMPLETED_AT, LiteralAs.date);
  }
  set completedAt(value: Date | undefined) {
    OptionalAs.object(this, SCHED_COMPLETED_AT, value, LiteralFrom.dateTime);
  }

  /** `sched:organizer` — the owner/organiser WebID (an IRI). */
  get organizer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_ORGANIZER, NamedNodeAs.string);
  }
  set organizer(value: string | undefined) {
    OptionalAs.object(this, SCHED_ORGANIZER, value, NamedNodeFrom.string);
  }

  /** `sched:inCalendar` — the calendar/project IRI (→ a `sched:Calendar`). */
  get calendar(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_IN_CALENDAR, NamedNodeAs.string);
  }
  set calendar(value: string | undefined) {
    OptionalAs.object(this, SCHED_IN_CALENDAR, value, NamedNodeFrom.string);
  }

  /** `dct:subject` — the label set (free-text strings). */
  get labels(): Set<string> {
    return SetFrom.subjectPredicate(this, DCT_SUBJECT, LiteralAs.string, LiteralFrom.string);
  }

  /** `sched:recurrence` — the recurrence-rule node IRI (→ a `sched:RecurrenceRule`). */
  get recurrence(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_RECURRENCE, NamedNodeAs.string);
  }
  set recurrence(value: string | undefined) {
    OptionalAs.object(this, SCHED_RECURRENCE, value, NamedNodeFrom.string);
  }

  /** `sched:hasReminder` — the reminder node IRIs (→ `sched:Reminder`s). */
  get reminders(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      SCHED_HAS_REMINDER,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** Typed view of a `sched:RecurrenceRule` node. */
export class RecurrenceRule extends TermWrapper {
  /** Stamp this subject as a `sched:RecurrenceRule`. Idempotent; returns `this`. */
  mark(): this {
    SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
      RECURRENCE_RULE_CLASS,
    );
    return this;
  }

  /** `sched:frequency` — DAILY / WEEKLY / MONTHLY / YEARLY. */
  get frequency(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_FREQUENCY, LiteralAs.string);
  }
  set frequency(value: string | undefined) {
    OptionalAs.object(this, SCHED_FREQUENCY, value, LiteralFrom.string);
  }

  /** `sched:interval` — every N units (xsd:positiveInteger). */
  get interval(): number | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_INTERVAL, LiteralAs.number);
  }
  set interval(value: number | undefined) {
    // xsd:positiveInteger via a datatype tuple (LiteralFrom.integer would type it
    // xsd:integer, which the sector's xsd:positiveInteger range would reject).
    OptionalAs.object(
      this,
      SCHED_INTERVAL,
      value === undefined ? undefined : [XSD_POSITIVE_INTEGER, String(value)],
      LiteralFrom.datatypeTuple,
    );
  }

  /** `sched:count` — total occurrences (xsd:positiveInteger). */
  get count(): number | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_COUNT, LiteralAs.number);
  }
  set count(value: number | undefined) {
    OptionalAs.object(
      this,
      SCHED_COUNT,
      value === undefined ? undefined : [XSD_POSITIVE_INTEGER, String(value)],
      LiteralFrom.datatypeTuple,
    );
  }

  /** `sched:until` — the last occurrence date/time (xsd:dateTime). */
  get until(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_UNTIL, LiteralAs.date);
  }
  set until(value: Date | undefined) {
    OptionalAs.object(this, SCHED_UNTIL, value, LiteralFrom.dateTime);
  }
}

/** Typed view of a `sched:Reminder` node. */
export class Reminder extends TermWrapper {
  /** Stamp this subject as a `sched:Reminder`. Idempotent; returns `this`. */
  mark(): this {
    SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string).add(
      REMINDER_CLASS,
    );
    return this;
  }

  /** `sched:triggerTime` — absolute fire time (xsd:dateTime). */
  get triggerTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_TRIGGER_TIME, LiteralAs.date);
  }
  set triggerTime(value: Date | undefined) {
    OptionalAs.object(this, SCHED_TRIGGER_TIME, value, LiteralFrom.dateTime);
  }

  /** `sched:triggerOffset` — relative offset (xsd:duration string, e.g. `-PT15M`). */
  get triggerOffset(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SCHED_TRIGGER_OFFSET, LiteralAs.string);
  }
  set triggerOffset(value: string | undefined) {
    OptionalAs.object(
      this,
      SCHED_TRIGGER_OFFSET,
      value === undefined ? undefined : [XSD_DURATION, value],
      LiteralFrom.datatypeTuple,
    );
  }
}

/**
 * Project a {@link SchedulingTaskData} onto the shared `wf:Task` {@link TaskData}
 * shape — the SAME `#it` subject, so a Vikunja task also reads as a federated
 * `wf:Task` ("assigned to me" in the Pod Manager). `buildTask` owns the untrusted
 * http(s) filtering of the WebID/relation IRIs and the wf:Open/wf:Closed +
 * `prov:endedAtTime` state management.
 */
function toWfTaskData(data: SchedulingTaskData): TaskData {
  const wf: TaskData = {
    title: data.summary,
    state: data.completed ? "closed" : "open",
  };
  setIfDefined(wf, "description", data.description);
  setIfDefined(wf, "endedAt", data.completedAt);
  setIfDefined(wf, "creator", data.organizer);
  setIfDefined(wf, "assignee", data.assignee);
  setIfDefined(wf, "project", data.calendar);
  setIfDefined(wf, "dueDate", data.dueTime);
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
export function buildSchedulingTask(resourceUrl: string, data: SchedulingTaskData): Store {
  // Start from the shared wf:Task store (federation edge), then layer sched: on
  // the same #it subject. buildTask owns the untrusted IRI filtering + state.
  const store = new Store([...buildTask(resourceUrl, toWfTaskData(data))]);
  const iris = schedulingNodeIris(resourceUrl);

  const task = new SchedulingTask(iris.task, store, DataFactory).mark();
  task.summary = data.summary || undefined;
  task.description = data.description || undefined;
  task.startTime = data.startTime;
  task.dueTime = data.dueTime;
  if (data.completed !== undefined) task.completed = data.completed;
  task.completedAt = data.completed === true ? (data.completedAt ?? new Date()) : data.completedAt;

  // organizer/calendar are untrusted IRIs: drop anything not absolute http(s).
  task.organizer = httpIriOrUndefined(data.organizer);
  task.calendar = httpIriOrUndefined(data.calendar);

  for (const label of data.labels ?? []) {
    const l = label.trim();
    if (l) task.labels.add(l);
  }

  if (data.recurrence) {
    const rule = new RecurrenceRule(iris.recurrence, store, DataFactory).mark();
    rule.frequency = normalizeFrequency(data.recurrence.frequency);
    rule.interval = positiveIntOrUndefined(data.recurrence.interval);
    rule.count = positiveIntOrUndefined(data.recurrence.count);
    rule.until = data.recurrence.until;
    task.recurrence = iris.recurrence;
  }

  (data.reminders ?? []).forEach((r, i) => {
    const iri = reminderIri(resourceUrl, i);
    const rem = new Reminder(iri, store, DataFactory).mark();
    rem.triggerTime = r.triggerTime;
    rem.triggerOffset = durationOrUndefined(r.triggerOffset);
    task.reminders.add(iri);
  });

  return store;
}

/** Serialise a `Store` to Turtle with the model's prefixes (pretty output). */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/** Build + serialise a task to a Turtle document in one call. */
export function serializeSchedulingTask(
  resourceUrl: string,
  data: SchedulingTaskData,
): Promise<string> {
  return storeToTurtle(buildSchedulingTask(resourceUrl, data));
}

/** Read a {@link RecurrenceData} from a recurrence-rule node, or `undefined`. */
function parseRecurrence(recIri: string, dataset: DatasetCore): RecurrenceData | undefined {
  const rule = new RecurrenceRule(recIri, dataset, DataFactory);
  const frequency = normalizeFrequency(tryRead(() => rule.frequency));
  if (frequency === undefined) return undefined;
  const rec: RecurrenceData = { frequency: frequency as RecurrenceData["frequency"] };
  setIfDefined(rec, "interval", positiveIntOrUndefined(tryRead(() => rule.interval)));
  setIfDefined(rec, "count", positiveIntOrUndefined(tryRead(() => rule.count)));
  setIfDefined(
    rec,
    "until",
    tryRead(() => rule.until),
  );
  return rec;
}

/** Read a {@link ReminderData} from a reminder node, or `undefined` if it carries nothing. */
function parseReminder(iri: string, dataset: DatasetCore): ReminderData | undefined {
  const rem = new Reminder(iri, dataset, DataFactory);
  const reminder: ReminderData = {};
  setIfDefined(
    reminder,
    "triggerTime",
    tryRead(() => rem.triggerTime),
  );
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
export function parseSchedulingTask(
  resourceUrl: string,
  dataset: DatasetCore,
): SchedulingTaskData | undefined {
  const task = new SchedulingTask(schedulingTaskSubject(resourceUrl), dataset, DataFactory);
  if (!task.isSchedulingTask) return undefined;

  const summary = tryRead(() => task.summary);
  if (summary === undefined) return undefined;

  const data: SchedulingTaskData = { summary };
  setIfDefined(
    data,
    "description",
    tryRead(() => task.description),
  );
  setIfDefined(
    data,
    "startTime",
    tryRead(() => task.startTime),
  );
  setIfDefined(
    data,
    "dueTime",
    tryRead(() => task.dueTime),
  );
  const completed = tryRead(() => task.completed);
  if (completed !== undefined) data.completed = completed;
  setIfDefined(
    data,
    "completedAt",
    tryRead(() => task.completedAt),
  );
  setIfDefined(data, "organizer", httpIriOrUndefined(tryRead(() => task.organizer)));
  setIfDefined(data, "calendar", httpIriOrUndefined(tryRead(() => task.calendar)));

  const labels = (tryRead(() => [...task.labels]) ?? []).filter(
    (l): l is string => typeof l === "string" && l.trim().length > 0,
  );
  if (labels.length > 0) data.labels = labels;

  const recIri = httpIriOrUndefined(tryRead(() => task.recurrence));
  if (recIri !== undefined) {
    const rec = parseRecurrence(recIri, dataset);
    if (rec !== undefined) data.recurrence = rec;
  }

  const reminderIris = (tryRead(() => [...task.reminders]) ?? []).filter(
    (i): i is string => httpIriOrUndefined(i) !== undefined,
  );
  const reminders = reminderIris
    .map((iri) => parseReminder(iri, dataset))
    .filter((r): r is ReminderData => r !== undefined);
  if (reminders.length > 0) data.reminders = reminders;

  // Federation fields (wf-only): read through the shared wf:Task model so a
  // Vikunja task's assignee/priority/order/relations agree with the Pod Manager.
  const wf = parseTask(resourceUrl, dataset);
  if (wf !== undefined) {
    setIfDefined(data, "assignee", wf.assignee);
    setIfDefined(data, "priority", wf.priority);
    setIfDefined(data, "position", wf.rank);
    setIfDefined(data, "parent", wf.parent);
    if (wf.blockedBy !== undefined && wf.blockedBy.length > 0) data.blockedBy = wf.blockedBy;
    if (wf.relatesTo !== undefined && wf.relatesTo.length > 0) data.relatesTo = wf.relatesTo;
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
export async function parseSchedulingTaskTtl(
  resourceUrl: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<SchedulingTaskData | undefined> {
  const resolvedContentType = contentType ?? "text/turtle";
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(body, resolvedContentType, { baseIRI: resourceUrl });
  return parseSchedulingTask(resourceUrl, dataset);
}
