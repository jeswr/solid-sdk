// AUTHORED-BY Codex GPT-6.1-Sol
import { check } from "./errors";
import { DAY, utc, utcDate } from "./time";

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const KEYS = ["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"];
type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
interface ByDay {
  day: number;
  ordinal: number;
}
export interface Rule {
  freq: Frequency;
  interval: number;
  count: number;
  until: number;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  weekStart: number;
}

function positive(value: string): number {
  check(/^\d+$/.test(value), "invalid-rule");
  const n = Number(value);
  check(Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647, "invalid-rule");
  return n;
}

function list(value: string | undefined, max: number, signed: boolean): number[] {
  if (value === undefined) return [];
  return value.split(",").map((item) => {
    check((signed ? /^[+-]?\d{1,2}$/ : /^\d{1,2}$/).test(item), "invalid-rule");
    const n = Number(item);
    check(n !== 0 && Math.abs(n) <= max, "invalid-rule");
    return n;
  });
}

export function parseRule(input: string): Rule {
  check(typeof input === "string" && input.length <= 4096, "invalid-rule");
  const entries = new Map<string, string>();
  const value = input.replace(/^RRULE:/i, "").toUpperCase();
  for (const part of value.split(";")) {
    const pair = part.split("=");
    const key = pair[0] as string;
    const val = pair[1];
    check(pair.length === 2 && val !== undefined && val.length > 0, "invalid-rule");
    check(KEYS.includes(key), "unsupported-rule");
    check(!entries.has(key), "invalid-rule");
    entries.set(key, val);
  }
  const freq = entries.get("FREQ");
  check(freq !== undefined, "invalid-rule");
  check(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq), "unsupported-rule");
  check(!(entries.has("COUNT") && entries.has("UNTIL")), "invalid-rule");
  const byDay = (entries.get("BYDAY")?.split(",") ?? []).map((item) => {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item);
    check(match, "invalid-rule");
    const ordinal = match[1] === undefined ? 0 : Number(match[1]);
    if (match[1] !== undefined) {
      check(ordinal !== 0 && Math.abs(ordinal) <= 53, "invalid-rule");
      check(freq === "MONTHLY" || freq === "YEARLY", "invalid-rule");
    }
    return { day: DAYS.indexOf(match[2] as string), ordinal };
  });
  const weekStart = entries.get("WKST") ?? "MO";
  check(DAYS.includes(weekStart), "invalid-rule");
  const byMonthDay = list(entries.get("BYMONTHDAY"), 31, true);
  check(freq !== "WEEKLY" || byMonthDay.length === 0, "invalid-rule");
  return {
    freq: freq as Frequency,
    interval: positive(entries.get("INTERVAL") ?? "1"),
    count: entries.has("COUNT") ? positive(entries.get("COUNT") as string) : Infinity,
    until: entries.has("UNTIL") ? utcDate(entries.get("UNTIL") as string) : Infinity,
    byDay,
    byMonthDay,
    byMonth: list(entries.get("BYMONTH"), 12, false),
    weekStart: DAYS.indexOf(weekStart),
  };
}

/** BY lists union internally and intersect across parts; defaults derive from DTSTART. */
export function matches(day: number, seed: number, rule: Rule): boolean {
  const date = new Date(day * DAY);
  const start = new Date(seed * DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const dom = date.getUTCDate();
  const dow = date.getUTCDay();
  const monthLength = new Date(utc(year, month + 1, 0)).getUTCDate();
  let period: number;
  switch (rule.freq) {
    case "DAILY":
      period = day - seed;
      break;
    case "WEEKLY": {
      const week = day - ((dow - rule.weekStart + 7) % 7);
      const seedWeek = seed - ((start.getUTCDay() - rule.weekStart + 7) % 7);
      period = (week - seedWeek) / 7;
      if (rule.byDay.length === 0 && dow !== start.getUTCDay()) return false;
      break;
    }
    case "MONTHLY":
      period = (year - start.getUTCFullYear()) * 12 + month - start.getUTCMonth() - 1;
      break;
    case "YEARLY":
      period = year - start.getUTCFullYear();
      if (
        rule.byMonth.length === 0 &&
        rule.byDay.length === 0 &&
        rule.byMonthDay.length === 0 &&
        month !== start.getUTCMonth() + 1
      )
        return false;
      break;
  }
  if (period % rule.interval !== 0) return false;
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(month)) return false;
  if (
    rule.byMonthDay.length > 0 &&
    !rule.byMonthDay.some((n) => dom === (n > 0 ? n : monthLength + n + 1))
  )
    return false;
  if (
    (rule.freq === "MONTHLY" || rule.freq === "YEARLY") &&
    rule.byDay.length === 0 &&
    rule.byMonthDay.length === 0 &&
    dom !== start.getUTCDate()
  )
    return false;
  return (
    rule.byDay.length === 0 ||
    rule.byDay.some(({ day: weekday, ordinal }) => {
      if (dow !== weekday) return false;
      if (ordinal === 0) return true;
      const yearly = rule.freq === "YEARLY" && rule.byMonth.length === 0;
      const first = utc(year, yearly ? 1 : month, 1) / DAY;
      const last = yearly ? utc(year + 1, 1, 1) / DAY - 1 : first + monthLength - 1;
      return ordinal > 0
        ? Math.floor((day - first) / 7) + 1 === ordinal
        : -(Math.floor((last - day) / 7) + 1) === ordinal;
    })
  );
}
