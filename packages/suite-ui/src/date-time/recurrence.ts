// AUTHORED-BY Codex GPT-6.1-Sol
import { isDate } from "./date-value.js";

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
export const frequencies = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof frequencies)[number];
/** Tasks §5.4 domain object. RDF adapters map weekday names to schema IRIs. */
export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  byDay?: Weekday[];
  byMonthDay?: number[];
  byMonth?: number[];
  /** Monthly ordinal: 1..5 or -1 (last). Persistence gap recorded in QUESTIONS.md. */
  bySetPos?: number;
  count?: number;
  until?: string;
}
const codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647;
function fail(): never {
  throw new RangeError("Unsupported or invalid recurrence rule");
}

export function validateRecurrence(rule: RecurrenceRule): void {
  if (!frequencies.includes(rule.freq) || !positive(rule.interval)) fail();
  if (rule.count !== undefined && (!positive(rule.count) || rule.until !== undefined)) fail();
  if (rule.until !== undefined && !isDate(rule.until) && !isUtcDateTime(rule.until)) fail();
  if (
    rule.byDay &&
    (!rule.byDay.length ||
      new Set(rule.byDay).size !== rule.byDay.length ||
      rule.byDay.some((d) => !weekdays.includes(d)) ||
      !["WEEKLY", "MONTHLY"].includes(rule.freq))
  )
    fail();
  if (
    rule.byMonthDay &&
    ((rule.freq !== "MONTHLY" && rule.freq !== "YEARLY") ||
      !rule.byMonthDay.length ||
      new Set(rule.byMonthDay).size !== rule.byMonthDay.length ||
      rule.byMonthDay.some((d) => !Number.isInteger(d) || (d !== -1 && (d < 1 || d > 31))))
  )
    fail();
  if (
    rule.byMonth &&
    (rule.freq !== "YEARLY" ||
      !rule.byMonth.length ||
      new Set(rule.byMonth).size !== rule.byMonth.length ||
      rule.byMonth.some((m) => !Number.isInteger(m) || m < 1 || m > 12))
  )
    fail();
  if (
    rule.bySetPos !== undefined &&
    (rule.freq !== "MONTHLY" ||
      rule.byDay?.length !== 1 ||
      rule.byMonthDay ||
      ![-1, 1, 2, 3, 4, 5].includes(rule.bySetPos))
  )
    fail();
  if (rule.freq === "MONTHLY" && rule.byDay && rule.bySetPos === undefined) fail();
}
function isUtcDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().replace(".000Z", "Z") === value
  );
}
/** RFC 5545 subset emitted by this editor; DTSTART belongs to the caller. */
export function toRRule(rule: RecurrenceRule): string {
  validateRecurrence(rule);
  const parts = [`FREQ=${rule.freq}`, `INTERVAL=${rule.interval}`];
  if (rule.byDay)
    parts.push(
      `BYDAY=${rule.byDay.map((d) => `${rule.bySetPos ?? ""}${codes[weekdays.indexOf(d)]}`).join(",")}`,
    );
  if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.byMonth) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until.replaceAll(/[-:]/g, "")}`);
  return `RRULE:${parts.join(";")}`;
}
/** Reject unsupported parts rather than dropping information during import. */
export function fromRRule(input: string): RecurrenceRule {
  if (input.length > 2048) fail();
  const fields = new Map<string, string>();
  for (const part of input.replace(/^RRULE:/, "").split(";")) {
    const [key, value, extra] = part.split("=");
    if (
      !key ||
      !value ||
      extra !== undefined ||
      fields.has(key) ||
      !["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL"].includes(key)
    )
      fail();
    fields.set(key, value);
  }
  const numeric = (value: string): number => (/^-?\d+$/.test(value) ? Number(value) : fail());
  const rule: RecurrenceRule = {
    freq: fields.get("FREQ") as Frequency,
    interval: numeric(fields.get("INTERVAL") ?? "1"),
  };
  const day = fields.get("BYDAY");
  if (day) {
    rule.byDay = day.split(",").map((item) => {
      const match = /^(-?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!match) return fail();
      if (match[1]) {
        if (day.includes(",")) fail();
        rule.bySetPos = Number(match[1]);
      }
      return weekdays[codes.indexOf(match[2] as string)] as Weekday;
    });
  }
  for (const [key, name] of [
    ["BYMONTHDAY", "byMonthDay"],
    ["BYMONTH", "byMonth"],
  ] as const) {
    const value = fields.get(key);
    if (value) rule[name] = value.split(",").map(numeric);
  }
  if (fields.has("COUNT")) rule.count = numeric(fields.get("COUNT") as string);
  const until = fields.get("UNTIL");
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})(T\d{2}\d{2}\d{2}Z)?$/.exec(until);
    if (!match) fail();
    rule.until = `${match[1]}-${match[2]}-${match[3]}${match[4]?.replace(/T(\d{2})(\d{2})(\d{2})Z/, "T$1:$2:$3Z") ?? ""}`;
  }
  validateRecurrence(rule);
  return rule;
}
