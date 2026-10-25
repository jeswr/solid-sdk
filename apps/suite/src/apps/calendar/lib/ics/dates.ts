// AUTHORED-BY Codex GPT-6.1-Sol
import { type Property, requireIcs } from "./content";
import type { CalendarDate } from "./types";

export function validateDate(date: CalendarDate): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(Z)?)?$/.exec(date.value);
  requireIcs(match, "expected ISO DATE or DATE-TIME");
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireIcs(m >= 1 && m <= 12 && d >= 1 && d <= (days[m - 1] as number), "invalid calendar date");
  if (hour !== undefined) {
    requireIcs(
      Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 60,
      "invalid clock time",
    );
  }
  if (date.tzid !== undefined) {
    requireIcs(
      hour !== undefined &&
        !date.value.endsWith("Z") &&
        date.tzid.length > 0 &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: TZID parameters must reject control characters.
        !/["\r\n\x00-\x1f\x7f]/.test(date.tzid),
      "invalid TZID",
    );
  }
}

export function readDate(prop: Property): CalendarDate {
  const kind = (prop.params.get("VALUE") ?? "DATE-TIME").toUpperCase();
  const dateOnly = kind === "DATE";
  requireIcs(dateOnly || kind === "DATE-TIME", "unsupported date value type");
  const match = (
    dateOnly ? /^(\d{4})(\d{2})(\d{2})$/ : /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
  ).exec(prop.value);
  requireIcs(match, "invalid basic date");
  const value = `${match[1]}-${match[2]}-${match[3]}${dateOnly ? "" : `T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ""}`}`;
  const tzid = prop.params.get("TZID");
  const date = tzid === undefined ? { value } : { value, tzid };
  validateDate(date);
  return date;
}

export function dateLine(name: string, date: CalendarDate): string {
  validateDate(date);
  const parameter =
    date.value.length === 10
      ? ";VALUE=DATE"
      : date.tzid === undefined
        ? ""
        : `;TZID="${date.tzid}"`;
  return `${name}${parameter}:${basicDate(date.value)}`;
}

export function basicDate(value: string): string {
  return value.replace(/[-:]/g, "");
}

export function readDateList(props: Property[]): CalendarDate[] {
  return props.flatMap((prop) =>
    prop.value.split(",").map((value) => readDate({ ...prop, value })),
  );
}

export function utc(value: string): void {
  validateDate({ value });
  requireIcs(value.endsWith("Z"), "expected UTC DATE-TIME");
}
