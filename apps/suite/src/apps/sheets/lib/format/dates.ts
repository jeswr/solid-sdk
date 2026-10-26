// AUTHORED-BY Codex GPT-6.1-Sol
import { SheetFormatError } from "./model";

export function dateValue(value: string): Date {
  const date = new Date(value);
  if (
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value
  ) {
    throw new SheetFormatError("invalid-value", "Dates must be valid canonical UTC minute strings");
  }
  return date;
}

export function dateFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function displayDate(value: string, locale: string, date: boolean, time: boolean): string {
  const fields = new Map(
    dateFormatter(locale)
      .formatToParts(dateValue(value))
      .map((p) => [p.type, p.value]),
  );
  const zero = new Intl.NumberFormat(locale, { useGrouping: false }).format(0);
  const rawYear = String(fields.get("year"));
  const year = `${zero.repeat(4 - Array.from(rawYear).length)}${rawYear}`;
  const day = `${year}-${fields.get("month")}-${fields.get("day")}`;
  const clock = `${fields.get("hour")}:${fields.get("minute")}`;
  return [date ? day : "", time ? clock : ""].filter(Boolean).join(" ");
}

/** Match only complete fixed patterns; Date's permissive parser never sees user text. */
export function parseDate(text: string, locale: string): string | null {
  let canonical: string;
  if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(text)) {
    canonical = `${text.slice(0, 10)}T${text.slice(11) || "00:00"}:00.000Z`;
  } else if (/^\d{2}:\d{2}$/.test(text)) {
    canonical = `1970-01-01T${text}:00.000Z`;
  } else {
    const formatter = new Intl.DateTimeFormat(locale, {
      calendar: "gregory",
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      numberingSystem: "latn",
    });
    const parts = formatter.formatToParts(new Date("2006-11-22T00:00:00.000Z"));
    let pattern = "^";
    const keys: string[] = [];
    for (const part of parts) {
      if (["year", "month", "day"].includes(part.type)) {
        keys.push(part.type);
        pattern += part.type === "year" ? "(\\d{4})" : "(\\d{2})";
      } else {
        pattern += part.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    const match = new RegExp(`${pattern}$`).exec(text);
    if (!match) return null;
    const values = new Map(keys.map((key, i) => [key, match[i + 1]]));
    canonical = `${values.get("year")}-${values.get("month")}-${values.get("day")}T00:00:00.000Z`;
  }
  try {
    dateValue(canonical);
  } catch {
    throw new SheetFormatError("invalid-input", "Invalid calendar date or time");
  }
  return canonical;
}
