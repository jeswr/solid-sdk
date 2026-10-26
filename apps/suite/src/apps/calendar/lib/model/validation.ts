// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import {
  type Calendar,
  type CalendarDate,
  type CalendarEvent,
  type RecurrenceRule,
  type Reminder,
  WEEKDAYS,
} from "./types";

export function httpIri(value: string): string {
  const iri = safeHttpIri(value);
  if (iri === undefined) throw new TypeError("Expected absolute HTTP(S) IRI");
  return iri;
}
export function asDate(value: CalendarDate): Date {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value;
  if (
    !Number.isFinite(date.getTime()) ||
    (typeof value === "string" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date.toISOString().slice(0, 10) !== value))
  )
    throw new TypeError("Invalid calendar date");
  return date;
}

/** Calendar offsets have a fixed length: years/months are deliberately unsupported. */
export function durationMilliseconds(value: string): number {
  const m = /^(-)?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(value);
  if (!m?.slice(2).some((v) => v !== undefined) || value.endsWith("T"))
    throw new TypeError("Invalid reminder duration");
  const [, sign, weeks, days, hours, minutes, seconds] = m;
  return (
    (sign ? -1 : 1) *
    ((Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 86400 +
      Number(hours ?? 0) * 3600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0)) *
    1000
  );
}
function positive(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    throw new TypeError("Expected positive integer");
}
export function validateRule(rule: RecurrenceRule): void {
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.frequency))
    throw new TypeError("Unsupported recurrence frequency");
  positive(rule.interval);
  positive(rule.count);
  if (rule.count !== undefined && rule.until !== undefined)
    throw new TypeError("Recurrence count and until are mutually exclusive");
  if (rule.until !== undefined) asDate(rule.until);
  if (rule.byDay?.some((day) => !Object.hasOwn(WEEKDAYS, day)))
    throw new TypeError("Invalid weekday");
  if (
    rule.byMonthDay?.some((day) => !Number.isInteger(day) || (day !== -1 && (day < 1 || day > 31)))
  )
    throw new TypeError("Invalid month day");
  if (rule.byMonth?.some((month) => !Number.isInteger(month) || month < 1 || month > 12))
    throw new TypeError("Invalid month");
  for (const date of rule.exceptDate ?? []) asDate(date);
}
export function validateReminder(reminder: Reminder): void {
  if ((reminder.triggerOffset === undefined) === (reminder.triggerTime === undefined))
    throw new TypeError("A reminder needs exactly one trigger");
  if (reminder.triggerOffset !== undefined) durationMilliseconds(reminder.triggerOffset);
  if (reminder.triggerTime !== undefined) asDate(reminder.triggerTime);
}
export function validateCalendar(calendar: Calendar): void {
  if (!calendar.title.trim()) throw new TypeError("Calendar title is required");
}
export function validateEvent(event: CalendarEvent): void {
  if (!event.name.trim()) throw new TypeError("Event title is required");
  asDate(event.start);
  if (
    event.end !== undefined &&
    (typeof event.start !== typeof event.end || +asDate(event.end) <= +asDate(event.start))
  )
    throw new TypeError("Event end must follow start and use the same date kind");
  if (event.inCalendar !== undefined) httpIri(event.inCalendar);
  if (event.recurrence) validateRule(event.recurrence);
  for (const reminder of event.reminders ?? []) validateReminder(reminder);
}
