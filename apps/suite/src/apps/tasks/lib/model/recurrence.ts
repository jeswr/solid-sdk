// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  aliases,
  clearSchedulingNode,
  editableNode,
  type Node,
  NS,
  requireDate,
  SCHED,
  SCHEMA,
} from "./rdf";

export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type Weekday = (typeof weekdays)[number];
export interface RecurrenceRule {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number | undefined;
  byDay?: Weekday[] | undefined;
  /** Monthly ordinal weekday: 1..5 or -1 (last), stored as sched:bySetPos. */
  bySetPos?: number | undefined;
  byMonthDay?: number | undefined;
  count?: number | undefined;
  until?: Date | string | undefined;
}
export function validateRule(rule: RecurrenceRule): void {
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.frequency))
    throw new TypeError("Invalid recurrence frequency.");
  for (const n of [rule.interval ?? 1, rule.count ?? 1])
    if (!Number.isSafeInteger(n) || n < 1) throw new TypeError("Expected a positive integer.");
  if (rule.count !== undefined && rule.until !== undefined)
    throw new TypeError("Count and until are mutually exclusive.");
  if (
    rule.byDay &&
    (!["WEEKLY", "MONTHLY"].includes(rule.frequency) ||
      !rule.byDay.length ||
      rule.byDay.some((day) => !weekdays.includes(day)))
  )
    throw new TypeError("byDay requires weekly or monthly weekdays.");
  if (
    (rule.bySetPos !== undefined &&
      (rule.frequency !== "MONTHLY" ||
        rule.byDay?.length !== 1 ||
        rule.byMonthDay !== undefined ||
        ![-1, 1, 2, 3, 4, 5].includes(rule.bySetPos))) ||
    (rule.frequency === "MONTHLY" && rule.byDay && rule.bySetPos === undefined)
  )
    throw new TypeError(
      "Monthly ordinal rules require one weekday and an ordinal from 1 to 5 or -1.",
    );
  if (
    rule.byMonthDay !== undefined &&
    (rule.frequency !== "MONTHLY" ||
      !Number.isInteger(rule.byMonthDay) ||
      rule.byMonthDay < 1 ||
      rule.byMonthDay > 31)
  )
    throw new TypeError("byMonthDay requires a monthly day from 1 to 31.");
  if (rule.until instanceof Date) requireDate(rule.until);
  else if (rule.until !== undefined) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.until) ||
      new Date(`${rule.until}T00:00:00Z`).toISOString().slice(0, 10) !== rule.until
    )
      throw new TypeError("Invalid recurrence end date.");
  }
}
export function readRecurrence(task: Node): RecurrenceRule | undefined {
  const value = aliases(`${SCHED}recurrence`).flatMap((p) => [...task.nodes(p)])[0];
  if (!value) return undefined;
  const days = aliases(`${SCHEMA}byDay`)
    .flatMap((p) => [...value.iris(p)])
    .map((iri) => iri.slice(iri.lastIndexOf("/") + 1) as Weekday);
  const until = value.text(`${SCHED}until`);
  const rule: RecurrenceRule = {
    frequency: value.text(`${SCHED}frequency`) as RecurrenceRule["frequency"],
    interval: value.number(`${SCHED}interval`),
    count: value.number(`${SCHED}count`),
    byMonthDay: value.number(`${SCHEMA}byMonthDay`),
    bySetPos: value.number(`${SCHED}bySetPos`),
    byDay: days.length ? days : undefined,
    until:
      until === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : new Date(until),
  };
  validateRule(rule);
  return rule;
}
export function writeRecurrence(task: Node, rule: RecurrenceRule | undefined): void {
  if (rule) validateRule(rule);
  const old = aliases(`${SCHED}recurrence`).flatMap((p) => [...task.nodes(p)]);
  task.clear(`${SCHED}recurrence`);
  const value = rule ? (old[0] ? editableNode(old[0]) : task.child()) : undefined;
  const fields = [
    `${SCHED}frequency`,
    `${SCHED}interval`,
    `${SCHED}count`,
    `${SCHED}until`,
    `${SCHEMA}byMonthDay`,
    `${SCHEMA}byDay`,
    `${SCHED}bySetPos`,
  ];
  for (const previous of old) clearSchedulingNode(previous, fields, `${SCHED}RecurrenceRule`);
  if (!value || !rule) return;
  // A shared node's copy still contains the old recognized fields.
  clearSchedulingNode(value, fields, `${SCHED}RecurrenceRule`);
  value.types.add(`${SCHED}RecurrenceRule`);
  value.setText(`${SCHED}frequency`, rule.frequency);
  value.setNumber(`${SCHED}interval`, rule.interval, true);
  value.setNumber(`${SCHED}count`, rule.count, true);
  value.setNumber(`${SCHEMA}byMonthDay`, rule.byMonthDay, true);
  value.setNumber(`${SCHED}bySetPos`, rule.bySetPos, true);
  for (const day of rule.byDay ?? []) value.iris(`${SCHEMA}byDay`).add(`${SCHEMA}${day}`);
  if (typeof rule.until === "string") value.setTyped(`${SCHED}until`, rule.until, `${NS.XSD}date`);
  else value.setDate(`${SCHED}until`, rule.until);
  task.nodes(`${SCHED}recurrence`).add(value);
}
function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86400000);
}
function untilTime(until: Date | string | undefined): number {
  if (until === undefined) return Infinity;
  if (until instanceof Date) return until.getTime();
  const [year, month, day] = until.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}
/** Step calendar fields independently of local DST, then resolve each occurrence locally.
 * Timed rules skip missing wall times; all-day rules use the first valid instant of the date. */
function* occurrences(rule: RecurrenceRule, due: Date, allDay = false): Generator<Date> {
  validateRule(rule);
  requireDate(due);
  const anchor = new Date(0);
  anchor.setUTCFullYear(due.getFullYear(), due.getMonth(), due.getDate());
  anchor.setUTCHours(due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds());
  const interval = rule.interval ?? 1;
  const limit = untilTime(rule.until);
  let emitted = 0;
  for (let period = 0; ; period++) {
    const candidate = new Date(anchor);
    let candidates: Date[];
    if (rule.frequency === "DAILY") {
      candidate.setUTCDate(anchor.getUTCDate() + period * interval);
      candidates = [candidate];
    } else if (rule.frequency === "WEEKLY") {
      const monday = dayNumber(anchor) - ((anchor.getUTCDay() + 6) % 7);
      const days = [
        ...new Set(rule.byDay ?? [weekdays[(anchor.getUTCDay() + 6) % 7] as Weekday]),
      ].sort((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b));
      candidates = days.map((day) => {
        const date = new Date(anchor);
        date.setUTCDate(
          anchor.getUTCDate() +
            monday -
            dayNumber(anchor) +
            period * interval * 7 +
            weekdays.indexOf(day),
        );
        return date;
      });
    } else if (rule.frequency === "MONTHLY") {
      const month = anchor.getUTCMonth() + period * interval;
      // Set the final date in one operation without carrying invalid month days
      // or normalized wall times into later periods.
      candidate.setUTCFullYear(
        anchor.getUTCFullYear(),
        month,
        rule.bySetPos === undefined ? (rule.byMonthDay ?? anchor.getUTCDate()) : 1,
      );
      if (rule.bySetPos !== undefined) {
        const weekday = (weekdays.indexOf((rule.byDay as Weekday[])[0] as Weekday) + 1) % 7;
        if (rule.bySetPos === -1) {
          candidate.setUTCMonth(candidate.getUTCMonth() + 1, 0);
          candidate.setUTCDate(
            candidate.getUTCDate() - ((candidate.getUTCDay() - weekday + 7) % 7),
          );
        } else {
          candidate.setUTCDate(
            1 + ((weekday - candidate.getUTCDay() + 7) % 7) + 7 * (rule.bySetPos - 1),
          );
        }
      }
      candidates = candidate.getUTCMonth() === month % 12 ? [candidate] : [];
    } else {
      candidate.setUTCFullYear(anchor.getUTCFullYear() + period * interval);
      candidates = candidate.getUTCMonth() === anchor.getUTCMonth() ? [candidate] : [];
    }
    if (
      !candidates.length &&
      (!Number.isFinite(candidate.getTime()) ||
        candidate.getUTCFullYear() > 9999 ||
        candidate.getTime() > limit)
    )
      return;
    for (const calendar of candidates) {
      const date = new Date(0);
      date.setFullYear(calendar.getUTCFullYear(), calendar.getUTCMonth(), calendar.getUTCDate());
      date.setHours(
        allDay ? 0 : calendar.getUTCHours(),
        allDay ? 0 : calendar.getUTCMinutes(),
        allDay ? 0 : calendar.getUTCSeconds(),
        allDay ? 0 : calendar.getUTCMilliseconds(),
      );
      if (!Number.isFinite(date.getTime()) || date.getFullYear() > 9999 || date.getTime() > limit)
        return;
      if (date < due) continue;
      // Date setters normalize DST gaps forward; do not let that change later anchors.
      if (
        !allDay &&
        date.getHours() * 60 + date.getMinutes() !== due.getHours() * 60 + due.getMinutes()
      )
        continue;
      if (emitted >= (rule.count ?? Infinity)) return;
      emitted++;
      yield date;
    }
  }
}
/** Strictly after `after`; `due` anchors count/interval. All-day dates resolve to
 * their first valid local instant, even when midnight falls in a DST gap. */
export function nextOccurrence(
  rule: RecurrenceRule,
  after: Date,
  due: Date = after,
  allDay = false,
): Date | undefined {
  requireDate(after);
  for (const date of occurrences(rule, due, allDay)) if (date > after) return date;
  return undefined;
}
/** Expand at most `limit` occurrences (including the anchor when it matches). */
export function expandRecurrence(rule: RecurrenceRule, due: Date, limit: number): Date[] {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("Expected a positive expansion limit.");
  const result: Date[] = [];
  for (const date of occurrences(rule, due)) {
    result.push(date);
    if (result.length === limit) break;
  }
  return result;
}
export function toRRule(rule: RecurrenceRule): string {
  validateRule(rule);
  const fields = [`FREQ=${rule.frequency}`, `INTERVAL=${rule.interval ?? 1}`];
  if (rule.byDay)
    fields.push(
      `BYDAY=${rule.byDay.map((day) => `${rule.bySetPos ?? ""}${day.slice(0, 2).toUpperCase()}`).join(",")}`,
    );
  if (rule.byMonthDay !== undefined) fields.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.count !== undefined) fields.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined)
    fields.push(
      `UNTIL=${typeof rule.until === "string" ? rule.until.replaceAll("-", "") : rule.until.toISOString().replace(/[-:]|\.\d{3}/g, "")}`,
    );
  return fields.join(";");
}
/** The optional zone formats the anchor's calendar fields; omitted means browser-local. */
export function humanise(rule: RecurrenceRule, due: Date, timeZone?: string): string {
  validateRule(rule);
  const n = rule.interval ?? 1;
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[rule.frequency];
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.frequency === "WEEKLY" && rule.byDay) {
    if (
      n === 1 &&
      rule.byDay.length === 5 &&
      weekdays.slice(0, 5).every((day) => rule.byDay?.includes(day))
    )
      text = "Every weekday";
    else text += ` on ${rule.byDay.map((day) => day.slice(0, 3)).join(", ")}`;
  }
  if (rule.frequency === "MONTHLY" && rule.bySetPos !== undefined) {
    const ordinal =
      rule.bySetPos === -1
        ? "last"
        : `${rule.bySetPos}${["", "st", "nd", "rd", "th", "th"][rule.bySetPos]}`;
    text += ` on the ${ordinal} ${(rule.byDay as Weekday[])[0]}`;
  } else if (rule.frequency === "MONTHLY") {
    const day =
      rule.byMonthDay ?? Number(due.toLocaleString("en-GB", { day: "numeric", timeZone }));
    const suffix =
      day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
    text += ` on the ${day}${suffix}`;
  }
  if (rule.frequency === "YEARLY")
    text += ` on ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}`;
  if (rule.count !== undefined) text += ` (${rule.count} times)`;
  if (rule.until !== undefined) {
    // An xsd:date is a calendar date; avoid parsing it as UTC and shifting it locally.
    const end = typeof rule.until === "string" ? new Date(`${rule.until}T00:00:00`) : rule.until;
    text += ` until ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return text;
}
