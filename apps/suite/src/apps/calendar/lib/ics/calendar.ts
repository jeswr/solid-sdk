// AUTHORED-BY Codex GPT-6.1-Sol
import { alarmLines, readAlarm } from "./alarms";
import {
  all,
  type Component,
  componentLines,
  escapeText,
  foldLine,
  one,
  parseComponent,
  requireIcs,
  unescapeText,
} from "./content";
import { dateLine, readDate, readDateList, utc } from "./dates";
import { readRule, ruleLine, validateUntil } from "./recurrence";
import type { CalendarEvent, ICalendar } from "./types";

function eventLines(event: CalendarEvent): string[] {
  requireIcs(event.uid.length > 0, "UID cannot be empty");
  utc(event.dtstamp);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    dateLine("DTSTAMP", { value: event.dtstamp }),
    `SUMMARY:${escapeText(event.name)}`,
    dateLine("DTSTART", { value: event.start, ...optionalZone(event.tzid) }),
  ];
  requireIcs(event.end !== undefined || event.endTzid === undefined, "end timezone without DTEND");
  if (event.end !== undefined) {
    lines.push(dateLine("DTEND", { value: event.end, ...optionalZone(event.endTzid) }));
    requireIcs(
      (event.start.length === 10) === (event.end.length === 10),
      "DTEND value type must match DTSTART",
    );
    const floatingStart =
      event.start.length !== 10 && !event.start.endsWith("Z") && event.tzid === undefined;
    const floatingEnd =
      event.end.length !== 10 && !event.end.endsWith("Z") && event.endTzid === undefined;
    requireIcs(floatingStart === floatingEnd, "DTEND floating form must match DTSTART");
    // Compare only when both values use the same clock; cross-zone instants need a TZ engine.
    if (event.tzid === event.endTzid && event.start.endsWith("Z") === event.end.endsWith("Z"))
      requireIcs(event.end > event.start, "DTEND must be later than DTSTART");
  }
  for (const [name, value] of [
    ["LOCATION", event.location],
    ["DESCRIPTION", event.description],
  ]) {
    if (value !== undefined) lines.push(`${name}:${escapeText(value)}`);
  }
  if (event.recurrence !== undefined) {
    validateUntil(event.recurrence, event.start, event.tzid);
    lines.push(ruleLine(event.recurrence));
    requireIcs(event.exceptDate === undefined, "EXDATE belongs on recurrence when RRULE exists");
  }
  for (const [name, dates] of [
    ["EXDATE", event.recurrence?.exceptDate ?? event.exceptDate],
    ["RDATE", event.rdate],
  ] as const) {
    for (const date of dates ?? []) {
      requireIcs(
        (date.value.length === 10) === (event.start.length === 10),
        "recurrence date type must match DTSTART",
      );
      lines.push(dateLine(name, date));
    }
  }
  for (const alarm of event.reminders ?? []) {
    requireIcs(
      alarm.related !== "END" || event.end !== undefined,
      "end-relative alarm needs DTEND",
    );
    lines.push(...alarmLines(alarm));
  }
  return [...lines, "END:VEVENT"];
}

function optionalZone(tzid: string | undefined): { tzid?: string } {
  return tzid === undefined ? {} : { tzid };
}

function readEvent(component: Component): CalendarEvent {
  requireIcs(
    !one(component, "DURATION") && !one(component, "RECURRENCE-ID"),
    "DURATION/recurrence overrides outside supported subset",
  );
  const start = readDate(one(component, "DTSTART", true) as NonNullable<ReturnType<typeof one>>);
  const stamp = readDate(one(component, "DTSTAMP", true) as NonNullable<ReturnType<typeof one>>);
  const event: CalendarEvent = {
    uid: unescapeText(one(component, "UID", true)?.value as string),
    dtstamp: stamp.value,
    name: unescapeText(one(component, "SUMMARY")?.value ?? ""),
    start: start.value,
    ...optionalZone(start.tzid),
  };
  const end = one(component, "DTEND");
  if (end) {
    const date = readDate(end);
    event.end = date.value;
    if (date.tzid !== undefined) event.endTzid = date.tzid;
  }
  for (const [name, key] of [
    ["LOCATION", "location"],
    ["DESCRIPTION", "description"],
  ] as const) {
    const prop = one(component, name);
    if (prop) event[key] = unescapeText(prop.value);
  }
  const rule = one(component, "RRULE");
  if (rule) event.recurrence = readRule(rule.value);
  const exceptions = readDateList(all(component, "EXDATE"));
  if (exceptions.length) {
    if (event.recurrence) event.recurrence.exceptDate = exceptions;
    else event.exceptDate = exceptions;
  }
  const additions = readDateList(all(component, "RDATE"));
  if (additions.length) event.rdate = additions;
  const alarms = component.children.filter((child) => child.name === "VALARM");
  if (alarms.length) event.reminders = alarms.map(readAlarm);
  eventLines(event);
  return event;
}

/** Parse the documented VEVENT subset. Invalid supported fields throw; unrelated components/properties are ignored. */
export function importICal(text: string): ICalendar {
  const calendar = parseComponent(text);
  requireIcs(calendar.name === "VCALENDAR", "expected VCALENDAR");
  requireIcs(one(calendar, "VERSION", true)?.value === "2.0", "expected VERSION:2.0");
  one(calendar, "PRODID", true);
  const events = calendar.children.filter((child) => child.name === "VEVENT").map(readEvent);
  const timezones = calendar.children
    .filter((child) => child.name === "VTIMEZONE")
    .map((child) => componentLines(child).join("\r\n"));
  return timezones.length ? { events, timezones } : { events };
}

/** Deterministic serialization: UID/DTSTAMP come from callers; no clock, randomness or timezone lookup. */
export function exportICal(calendar: ICalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Solid Suite//Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const timezone of calendar.timezones ?? []) {
    const component = parseComponent(timezone);
    requireIcs(component.name === "VTIMEZONE", "expected VTIMEZONE definition");
    lines.push(...componentLines(component));
  }
  for (const event of calendar.events) lines.push(...eventLines(event));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
