// AUTHORED-BY Codex GPT-6.1-Sol
import { requireIcs } from "./content";
import { basicDate, readDate, validateDate } from "./dates";
import type { RecurrenceRule } from "./types";

const frequencies = ["SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const weekday = /^(?:[+-]?(?:[1-9]|[1-4]\d|5[0-3]))?(?:MO|TU|WE|TH|FR|SA|SU)$/;
const selectors = [
  ["BYSECOND", "bySecond", 0, 60],
  ["BYMINUTE", "byMinute", 0, 59],
  ["BYHOUR", "byHour", 0, 23],
  ["BYMONTHDAY", "byMonthDay", -31, 31],
  ["BYYEARDAY", "byYearDay", -366, 366],
  ["BYWEEKNO", "byWeekNo", -53, 53],
  ["BYMONTH", "byMonth", 1, 12],
  ["BYSETPOS", "bySetPos", -366, 366],
] as const;

export function positive(value: number): void {
  requireIcs(Number.isSafeInteger(value) && value > 0, "expected positive integer");
}

export function ruleLine(rule: RecurrenceRule): string {
  requireIcs(frequencies.includes(rule.frequency), "invalid recurrence frequency");
  requireIcs(rule.count === undefined || rule.until === undefined, "COUNT and UNTIL are exclusive");
  const parts = [`FREQ=${rule.frequency}`];
  if (rule.interval !== undefined) {
    positive(rule.interval);
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.count !== undefined) {
    positive(rule.count);
    parts.push(`COUNT=${rule.count}`);
  }
  if (rule.until !== undefined) {
    validateDate({ value: rule.until });
    parts.push(`UNTIL=${basicDate(rule.until)}`);
  }
  if (rule.byDay !== undefined) {
    requireIcs(
      rule.byDay.length > 0 && rule.byDay.every((value) => weekday.test(value)),
      "invalid BYDAY",
    );
    const ordinal = rule.byDay.some((value) => value.length > 2);
    requireIcs(
      !ordinal ||
        rule.frequency === "MONTHLY" ||
        (rule.frequency === "YEARLY" && rule.byWeekNo === undefined),
      "ordinal BYDAY needs monthly/yearly frequency",
    );
    parts.push(`BYDAY=${rule.byDay.join(",")}`);
  }
  for (const [name, key, min, max] of selectors) {
    const values = rule[key];
    if (values === undefined) continue;
    requireIcs(
      values.length > 0 &&
        values.every(
          (value) =>
            Number.isSafeInteger(value) &&
            value >= min &&
            value <= max &&
            (min >= 0 || value !== 0),
        ),
      `invalid ${name}`,
    );
    parts.push(`${name}=${values.join(",")}`);
  }
  requireIcs(rule.byMonthDay === undefined || rule.frequency !== "WEEKLY", "weekly BYMONTHDAY");
  requireIcs(
    rule.byWeekNo === undefined || rule.frequency === "YEARLY",
    "BYWEEKNO needs yearly frequency",
  );
  requireIcs(
    rule.byYearDay === undefined || !["DAILY", "WEEKLY", "MONTHLY"].includes(rule.frequency),
    "invalid BYYEARDAY frequency",
  );
  requireIcs(
    rule.bySetPos === undefined ||
      rule.byDay !== undefined ||
      selectors.some(([, key]) => key !== "bySetPos" && rule[key] !== undefined),
    "BYSETPOS needs another selector",
  );
  if (rule.weekStart !== undefined) {
    requireIcs(/^(MO|TU|WE|TH|FR|SA|SU)$/.test(rule.weekStart), "invalid WKST");
    parts.push(`WKST=${rule.weekStart}`);
  }
  return `RRULE:${parts.join(";")}`;
}

export function readRule(value: string): RecurrenceRule {
  const fields = new Map<string, string>();
  for (const part of value.toUpperCase().split(";")) {
    const [name, data, extra] = part.split("=");
    requireIcs(name && data && extra === undefined && !fields.has(name), "invalid recurrence part");
    fields.set(name, data);
  }
  const rule: RecurrenceRule = { frequency: fields.get("FREQ") ?? "" };
  for (const [name, data] of fields) {
    if (name === "FREQ") continue;
    if (name === "UNTIL") {
      rule.until = readDate({
        name,
        params: new Map([["VALUE", data.length === 8 ? "DATE" : "DATE-TIME"]]),
        value: data,
      }).value;
    } else if (name === "BYDAY") rule.byDay = data.split(",");
    else if (name === "WKST") rule.weekStart = data;
    else if (name === "INTERVAL" || name === "COUNT") {
      requireIcs(/^\d+$/.test(data), "invalid recurrence integer");
      rule[name === "INTERVAL" ? "interval" : "count"] = Number(data);
    } else {
      const selector = selectors.find(([key]) => key === name);
      requireIcs(selector && /^[+-]?\d+(?:,[+-]?\d+)*$/.test(data), "unsupported recurrence part");
      rule[selector[1]] = data.split(",").map(Number);
    }
  }
  ruleLine(rule);
  return rule;
}

export function validateUntil(rule: RecurrenceRule, start: string, tzid?: string): void {
  if (rule.until === undefined) return;
  requireIcs(
    (start.length === 10) === (rule.until.length === 10),
    "UNTIL must match DTSTART value type",
  );
  if (start.length !== 10) {
    requireIcs(
      rule.until.endsWith("Z") === (start.endsWith("Z") || tzid !== undefined),
      "UNTIL timezone mismatch",
    );
  }
}
