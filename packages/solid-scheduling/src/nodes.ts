// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Claude Opus 5.5 (moved verbatim from task.ts in the Phase S generated flip)
/**
 * Typed `@rdfjs/wrapper` views of the nodes in a scheduling task document — the
 * public accessor classes `SchedulingTask`, `RecurrenceRule` and `Reminder`.
 *
 * `buildSchedulingTask` / `parseSchedulingTask` (./task.ts) now go through the model
 * GENERATED from the scheduling profile (./generated/) for the `sched:Task` core and
 * its recurrence rule. These views stay for the public API and for the parts the
 * generated composite cannot express: the `dct:subject` label set and the
 * any-number `sched:hasReminder` nodes. They mint nothing; every read/write goes
 * through the vetted mappers.
 */

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
import {
  DCT_SUBJECT,
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
