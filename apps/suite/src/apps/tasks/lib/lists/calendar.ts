// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type DueDate, type ListContext, TaskListError } from "./types";

export const DAY = 86_400_000;
const MIN = Date.parse("1970-01-01T00:00:00.000Z");
const MAX = Date.parse("9999-12-31T23:59:59.999Z");

export function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TaskListError("invalid-input", message);
}

export function record(value: unknown): asserts value is Record<string, unknown> {
  requireInput(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Expected an object",
  );
}

export function range(time: number): number {
  if (!Number.isFinite(time) || time < MIN || time > MAX) {
    throw new TaskListError("date-out-of-range", "Dates must be within 1970–9999");
  }
  return time;
}

/** Strict UTC ISO instants, with optional millisecond precision; no Date.parse rollover. */
export function instant(value: string): number {
  requireInput(
    typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value),
    "Expected a UTC ISO instant",
  );
  const time = range(Date.parse(value));
  requireInput(
    new Date(time).toISOString() === value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z"),
    "Invalid calendar instant",
  );
  return time;
}

export function dateTime(value: string): number {
  requireInput(typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value), "Expected YYYY-MM-DD");
  return instant(`${value}T00:00:00Z`);
}

export function validateDue(due: DueDate): void {
  record(due);
  if (due.kind === "all-day") {
    requireInput(
      Object.keys(due).every((key) => key === "kind" || key === "date"),
      "Unknown all-day date field",
    );
    dateTime(due.date);
  } else {
    requireInput(due.kind === "timed", "Unknown due date kind");
    requireInput(
      Object.keys(due).every((key) => key === "kind" || key === "at"),
      "Unknown timed date field",
    );
    instant(due.at);
  }
}

export function formatter(timeZone: string): Intl.DateTimeFormat {
  requireInput(
    typeof timeZone === "string" && timeZone.length > 0 && !/^[+-]/.test(timeZone),
    "Expected an IANA time zone",
  );
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new TaskListError("invalid-time-zone", "Unknown IANA time zone");
  }
}

/** Encode local calendar fields as UTC for arithmetic, retaining milliseconds. */
export function localTime(time: number, format: Intl.DateTimeFormat): number {
  const fields = Object.fromEntries(
    format.formatToParts(range(time)).map(({ type, value }) => [type, value]),
  );
  const { year, month, day, hour, minute, second } = fields;
  // Offset probes can cross the supported civil-date boundary. Public calendar
  // arithmetic checks the resulting range, while probes retain intermediate fields.
  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) +
    (time % 1000)
  );
}

export function readContext(context: ListContext): { now: number; format: Intl.DateTimeFormat } {
  record(context);
  requireInput(typeof context.clock === "function", "Expected an injected clock");
  const value = context.clock();
  requireInput(value instanceof Date, "Clock must return a Date");
  return { now: range(value.getTime()), format: formatter(context.timeZone) };
}

export function dueLocal(due: DueDate, format: Intl.DateTimeFormat): number {
  validateDue(due);
  return due.kind === "all-day" ? dateTime(due.date) : range(localTime(instant(due.at), format));
}

export function dayOf(time: number): number {
  return Math.floor(time / DAY) * DAY;
}

/** Resolve unique wall times, or exhaust until. Never guess an offset or shift a gap. */
export function resolveLocal(
  local: number,
  format: Intl.DateTimeFormat,
  until?: number,
): number | undefined {
  range(local);
  const offsets = new Set<number>();
  // All supported post-1970 IANA transitions are isolated by more than six hours.
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = local + hours * 3_600_000;
    if (sample >= MIN && sample <= MAX) offsets.add(localTime(sample, format) - sample);
  }
  const matches = [...offsets]
    .map((offset) => local - offset)
    .filter(
      (candidate) => candidate >= MIN && candidate <= MAX && localTime(candidate, format) === local,
    );
  // A fold is exhausted only if both possible instants exceed the inclusive cutoff.
  // A gap has no instants; retain the civil-time bound before rejecting it.
  if (
    until !== undefined &&
    (matches.length > 0
      ? matches.every((candidate) => candidate > until)
      : local > localTime(until, format))
  )
    return undefined;
  if (matches.length !== 1) {
    throw new TaskListError(
      "unresolvable-local-time",
      "Local time is missing, ambiguous or outside the supported range",
    );
  }
  return matches[0] as number;
}
