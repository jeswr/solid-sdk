// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError } from "../core/errors.js";

/** VOC-01's recurrence shape, shared with the Calendar and Takeout mappers. */
export interface CalendarRecurrence {
  frequency: string;
  interval?: number;
  count?: number;
  until?: string;
  byDay: string[];
  byMonthDay: number[];
  byMonth: number[];
  exceptDate: string[];
}

export function recurrenceError(): never {
  throw new IntegrationSyncError(
    "google-calendar",
    "Unsupported or malformed Calendar recurrence; checkpoint unchanged.",
  );
}

/** Preserve the lexical date or dateTime; never turn an all-day date into midnight. */
export function calendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))
    recurrenceError();
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
    recurrenceError();
  if (
    value.includes("T") &&
    !Number.isFinite(
      Date.parse(/[Z+-]\d{0,2}:?\d{0,2}$/.test(value.slice(10)) ? value : `${value}Z`),
    )
  )
    recurrenceError();
  return value;
}

function icalDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) recurrenceError();
  return calendarDate(
    `${match[1]}-${match[2]}-${match[3]}${match[4] === undefined ? "" : `T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ""}`}`,
  );
}

function integer(value: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^-?\d+$/.test(value)) recurrenceError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max || parsed === 0)
    recurrenceError();
  return parsed;
}

/** Reject RFC 5545 features outside VOC-01 instead of silently changing their meaning. */
export function parseRecurrence(lines: readonly string[], timeZone?: string): CalendarRecurrence[] {
  const rules: CalendarRecurrence[] = [];
  const exceptions: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string") recurrenceError();
    const separator = line.indexOf(":");
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 0 || !value) recurrenceError();
    if (name.startsWith("EXDATE")) {
      const [property, ...params] = name.split(";");
      if (property !== "EXDATE") recurrenceError();
      for (const param of params) {
        if (param === "VALUE=DATE" || param === "VALUE=DATE-TIME") continue;
        if (timeZone && param === `TZID=${timeZone}`) continue;
        recurrenceError();
      }
      for (const date of value.split(",")) exceptions.push(icalDate(date));
      continue;
    }
    if (name !== "RRULE") recurrenceError();
    const rule: CalendarRecurrence = {
      frequency: "",
      byDay: [],
      byMonthDay: [],
      byMonth: [],
      exceptDate: [],
    };
    const seen = new Set<string>();
    for (const part of value.split(";")) {
      const [key, field, extra] = part.split("=");
      if (!key || !field || extra !== undefined || seen.has(key)) recurrenceError();
      seen.add(key);
      switch (key) {
        case "FREQ":
          if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(field)) recurrenceError();
          rule.frequency = field;
          break;
        case "INTERVAL":
          rule.interval = integer(field, 1);
          break;
        case "COUNT":
          rule.count = integer(field, 1);
          break;
        case "UNTIL":
          rule.until = icalDate(field);
          break;
        case "BYDAY":
          rule.byDay = field.split(",");
          if (rule.byDay.some((day) => !["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(day)))
            recurrenceError();
          break;
        case "BYMONTHDAY":
          rule.byMonthDay = field.split(",").map((day) => integer(day, -31, 31));
          break;
        case "BYMONTH":
          rule.byMonth = field.split(",").map((month) => integer(month, 1, 12));
          break;
        default:
          recurrenceError();
      }
    }
    if (!rule.frequency || (rule.count !== undefined && rule.until !== undefined))
      recurrenceError();
    rules.push(rule);
  }
  if (exceptions.length && !rules.length) recurrenceError();
  for (const rule of rules) rule.exceptDate = [...exceptions];
  return rules;
}
