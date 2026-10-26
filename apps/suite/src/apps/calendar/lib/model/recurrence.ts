// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
/** Resolve the first occurrence; explicit ICS gap times may use the pre-transition offset. */
export function fromWallClock(
  wall: Date,
  timeZone: string,
  gap: "reject" | "offset-before" = "reject",
): Date {
  let earliest = Infinity;
  let afterGap = Infinity;
  // Sample both sides of a transition, then test each observed offset explicitly.
  // An overlap has two matching instants; a gap has none.
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = new Date(+wall + delta);
    const offset = +wallClock(sample, timeZone) - +sample;
    const candidate = new Date(+wall - offset);
    const resolved = +wallClock(candidate, timeZone);
    if (resolved === +wall) earliest = Math.min(earliest, +candidate);
    // In a gap, applying the old offset shifts the wall time forward by the gap.
    if (resolved > +wall) afterGap = Math.min(afterGap, +candidate);
  }
  if (Number.isFinite(earliest)) return new Date(earliest);
  if (gap === "offset-before" && Number.isFinite(afterGap)) return new Date(afterGap);
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
  const floatingStart = wallClock(start, zone);
  const floatingFrom = wallClock(new Date(+from - duration), zone);
  const floatingTo = wallClock(to, zone);
  // Pad for offset changes at range boundaries; exact filtering follows conversion.
  const dates: { wall: Date; date: Date }[] = [];
  // COUNT applies to valid local times from DTSTART, before EXDATE/range filtering.
  // Let rrule bound the search by the range, and stop once that valid count is met.
  // An instant cutoff can map behind a valid candidate during rollback. Use
  // the padded range as the conservative generation bound for instant UNTIL;
  // the exact cutoff is enforced only after converting candidates to instants.
  toRRule(
    { ...rule, count: undefined, until: typeof rule.until === "string" ? rule.until : undefined },
    event.start,
    zone,
  ).between(
    rule.count === undefined ? new Date(+floatingFrom - 86400000) : floatingStart,
    new Date(+floatingTo + 86400000),
    true,
    (wall) => {
      let date: Date;
      try {
        // DTSTART identifies an explicit instant, including the later overlap.
        date = +wall === +floatingStart ? start : fromWallClock(wall, zone);
      } catch {
        return true;
      }
      dates.push({ wall, date });
      return rule.count === undefined || dates.length < rule.count;
    },
  );
  const until =
    rule.until === undefined
      ? Infinity
      : typeof rule.until === "string"
        ? +fromWallClock(new Date(+asDate(rule.until) + 86399999), zone)
        : +asDate(rule.until);
  return dates.flatMap(({ wall, date }) => {
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
