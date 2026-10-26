// AUTHORED-BY Codex GPT-6.1-Sol
import type { DataFactory as Factory, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
} from "@rdfjs/wrapper";
import { FEDERATION } from "../core/federation-vocab.js";
import { CalendarEvent, CLASSES, PodThing } from "../core/vocab.js";
import { createVocabMap } from "../core/vocab-map.js";
import type { CalendarRecurrence } from "./recurrence.js";

/** Scheduling ontology bridge, kept adapter-local until CON-13's constants switch. */
export const SCHED = FEDERATION.CalendarEvent.slice(0, -"CalendarEvent".length);
const SCHEMA = "https://schema.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const DAYS: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function temporal(value: string, factory: Factory): Term {
  return factory.literal(
    value,
    factory.namedNode(`${XSD}${value.includes("T") ? "dateTime" : "date"}`),
  );
}

/** Typed writes for VOC-01 dates and sector fields, retaining legacy schema readers. */
export class GoogleCalendarEvent extends CalendarEvent {
  override mark(): this {
    super.mark();
    this.types.add(FEDERATION.CalendarEvent);
    return this;
  }
  set summary(value: string) {
    this.name = value;
    OptionalAs.object(this, `${SCHED}summary`, value, LiteralFrom.string);
  }
  set details(value: string | undefined) {
    this.description = value;
    OptionalAs.object(this, `${SCHED}description`, value, LiteralFrom.string);
  }
  set start(value: string) {
    OptionalAs.object(this, `${SCHED}startTime`, value, temporal);
    OptionalAs.object(this, `${SCHEMA}startDate`, value, temporal);
  }
  set end(value: string) {
    OptionalAs.object(this, `${SCHED}endTime`, value, temporal);
    OptionalAs.object(this, `${SCHEMA}endDate`, value, temporal);
  }
  get recurrence(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHED}recurrence`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  set parent(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}superEvent`, value, NamedNodeFrom.string);
  }
  get schedules(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}eventSchedule`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  set originalStart(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}previousStartDate`, value, temporal);
  }
  set cancelled(value: boolean) {
    OptionalAs.object(
      this,
      `${SCHEMA}eventStatus`,
      value ? `${SCHEMA}EventCancelled` : undefined,
      NamedNodeFrom.string,
    );
  }
}

/** One deterministic rule node, with the exact VOC-01 properties and datatypes. */
export class RecurrenceRule extends PodThing {
  get exceptions(): Set<string> {
    return SetFrom.subjectPredicate(this, `${SCHEMA}exceptDate`, LiteralAs.string, temporal);
  }
  set timezone(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}scheduleTimezone`, value, LiteralFrom.string);
  }
  setRule(rule: CalendarRecurrence): void {
    this.types.add(`${SCHED}RecurrenceRule`);
    this.types.add(`${SCHEMA}Schedule`);
    OptionalAs.object(this, `${SCHED}frequency`, rule.frequency, LiteralFrom.string);
    OptionalAs.object(this, `${SCHED}interval`, rule.interval, LiteralFrom.integer);
    OptionalAs.object(this, `${SCHED}count`, rule.count, LiteralFrom.integer);
    OptionalAs.object(this, `${SCHED}until`, rule.until, temporal);
    for (const day of rule.byDay)
      SetFrom.subjectPredicate(
        this,
        `${SCHEMA}byDay`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ).add(`${SCHEMA}${DAYS[day]}`);
    for (const [predicate, values] of [
      ["byMonthDay", rule.byMonthDay],
      ["byMonth", rule.byMonth],
    ] as const) {
      for (const value of values)
        SetFrom.subjectPredicate(
          this,
          `${SCHEMA}${predicate}`,
          LiteralAs.number,
          LiteralFrom.integer,
        ).add(value);
    }
    for (const date of rule.exceptDate) this.exceptions.add(date);
  }
}

/** Preserve the runner's adapter-local sector mapping seam. */
export const vocabMap = createVocabMap({ [CLASSES.Event]: FEDERATION.CalendarEvent });
