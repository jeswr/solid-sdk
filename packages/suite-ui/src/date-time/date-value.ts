// AUTHORED-BY Codex GPT-6.1-Sol
import { en } from "chrono-node";

/** A date is an all-day wall date (V4); dateTime is an instant. */
export type DateTimeValue = { kind: "date"; date: string } | { kind: "dateTime"; dateTime: string };
export type DateParseResult =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "valid"; value: DateTimeValue };

export function localDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}

export function valueDate(value: DateTimeValue): Date {
  return new Date(value.kind === "date" ? `${value.date}T12:00:00` : value.dateTime);
}

export function formatDateTime(value: DateTimeValue, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    ...(value.kind === "dateTime" ? { timeStyle: "short" as const } : {}),
  }).format(valueDate(value));
}

/** Require the entire field to parse; never silently accept a range or leftover text. */
export function parseDateTime(text: string, locale: string, reference: Date): DateParseResult {
  const input = text.trim();
  if (!input) return { status: "empty" };
  const invalid: DateParseResult = {
    status: "invalid",
    message: "Enter a date, such as tomorrow 5pm or next Mon.",
  };
  if (input.length > 256 || !Number.isFinite(reference.getTime())) return invalid;
  // GB numeric dates are day-first. Named-month phrases use casual to avoid
  // chrono 2.x treating "December 25" as December of the year 2025 in GB mode.
  const results = (
    locale.toLowerCase() === "en-gb" && /\b\d{1,2}[/.-]\d{1,2}/.test(input) ? en.GB : en.casual
  ).parse(input, reference, { forwardDate: !/\b(last|yesterday|ago)\b/i.test(input) });
  const result = results[0];
  if (
    results.length !== 1 ||
    !result ||
    result.index !== 0 ||
    result.text.length !== input.length ||
    result.end
  )
    return invalid;
  const date = result.start.date();
  if (!Number.isFinite(date.getTime())) return invalid;
  return {
    status: "valid",
    value: result.start.isCertain("hour")
      ? { kind: "dateTime", dateTime: date.toISOString() }
      : { kind: "date", date: localDate(date) },
  };
}
