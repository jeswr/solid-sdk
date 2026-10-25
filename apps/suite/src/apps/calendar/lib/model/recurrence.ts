// AUTHORED-BY Codex GPT-6.1-Sol
import { RRule } from "rrule";
import type { CalendarDate, CalendarEvent, RecurrenceRule } from "./types";
import { asDate, durationMilliseconds, validateEvent, validateRule } from "./validation";

/** Encode the zone's wall-clock fields as UTC fields for rrule's floating-date API. */
export function wallClock(date: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
      date.getUTCMilliseconds(),
    ),
  );
}
/** Resolve a floating wall-clock value using Intl; reject nonexistent DST-gap times. */
export function fromWallClock(wall: Date, timeZone: string): Date {
  let instant = new Date(wall);
  for (let i = 0; i < 4; i++) {
    const delta = +wall - +wallClock(instant, timeZone);
    if (!delta) return instant;
    instant = new Date(+instant + delta);
  }
  throw new TypeError("Local time does not exist in this timezone");
}
export function toRRule(rule: RecurrenceRule, start: CalendarDate, timeZone = "UTC"): RRule {
  validateRule(rule);
  const dtstart = typeof start === "string" ? asDate(start) : wallClock(asDate(start), timeZone);
  return new RRule({
    freq: RRule[rule.frequency],
    dtstart,
    interval: rule.interval ?? 1,
    count: rule.count ?? null,
    until:
      rule.until === undefined
        ? null
        : typeof rule.until === "string"
          ? new Date(+asDate(rule.until) + 86399999)
          : wallClock(asDate(rule.until), timeZone),
    byweekday: rule.byDay?.length ? rule.byDay.map((day) => RRule[day]) : null,
    bymonthday: rule.byMonthDay?.length ? rule.byMonthDay : null,
    bymonth: rule.byMonth?.length ? rule.byMonth : null,
  });
}
/** Half-open range; exceptions do not extend COUNT, and UNTIL is inclusive. */
export function expandEvent(
  event: CalendarEvent,
  from: Date,
  to: Date,
  timeZone = "UTC",
): CalendarEvent[] {
  validateEvent(event);
  asDate(from);
  asDate(to);
  if (+to <= +from) return [];
  const start = asDate(event.start);
  const duration =
    event.end === undefined
      ? typeof event.start === "string"
        ? 86400000
        : 0
      : +asDate(event.end) - +start;
  const overlaps = (date: Date) =>
    +date < +to && (duration ? +date + duration > +from : +date >= +from);
  if (!event.recurrence) return overlaps(start) ? [event] : [];
  const zone = typeof event.start === "string" ? "UTC" : timeZone;
  const rule = event.recurrence;
  const floatingFrom = wallClock(new Date(+from - duration), zone);
  const floatingTo = wallClock(to, zone);
  // Pad for offset changes at range boundaries; exact filtering follows conversion.
  const dates = toRRule(rule, event.start, zone).between(
    new Date(+floatingFrom - 86400000),
    new Date(+floatingTo + 86400000),
    true,
  );
  const until =
    rule.until === undefined
      ? Infinity
      : typeof rule.until === "string"
        ? +fromWallClock(new Date(+asDate(rule.until) + 86399999), zone)
        : +asDate(rule.until);
  return dates.flatMap((wall) => {
    let date: Date;
    try {
      date = fromWallClock(wall, zone);
    } catch {
      return [];
    }
    if (
      +date > until ||
      !overlaps(date) ||
      rule.exceptDate?.some((ex) =>
        typeof ex === "string" ? wall.toISOString().slice(0, 10) === ex : +ex === +date,
      )
    )
      return [];
    const convert = (d: Date): CalendarDate =>
      typeof event.start === "string" ? d.toISOString().slice(0, 10) : d;
    return [
      {
        ...event,
        start: convert(date),
        end: event.end === undefined ? undefined : convert(new Date(+date + duration)),
      },
    ];
  });
}
export function computeFireTimes(event: CalendarEvent): Date[] {
  validateEvent(event);
  return (event.reminders ?? [])
    .map(
      (reminder) =>
        reminder.triggerTime ??
        new Date(+asDate(event.start) + durationMilliseconds(reminder.triggerOffset as string)),
    )
    .sort((a, b) => +a - +b);
}
