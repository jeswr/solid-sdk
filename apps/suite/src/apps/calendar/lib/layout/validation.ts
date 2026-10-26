// AUTHORED-BY Codex GPT-6.1-Sol

export type CalendarLayoutErrorCode = "invalid-date" | "invalid-range" | "invalid-event";

/** Invalid/unsupported geometry inputs; messages never include input values. */
export class CalendarLayoutError extends Error {
  constructor(public readonly code: CalendarLayoutErrorCode) {
    super(`Calendar layout: ${code}`);
    this.name = "CalendarLayoutError";
  }
}

export function integer(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CalendarLayoutError("invalid-range");
  }
}

const DAY_MS = 86_400_000;

/** UTC is used only for Gregorian arithmetic, never for timezone conversion. */
export function dateDay(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") {
    throw new CalendarLayoutError("invalid-date");
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new CalendarLayoutError("invalid-date");
  }
  return time / DAY_MS;
}

export function dayDate(day: number): string {
  const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
  // Reject grids extending beyond the documented four-digit year range.
  dateDay(date);
  return date;
}

export function eventIds(events: readonly { readonly id: string }[]): void {
  if (!Array.isArray(events)) throw new CalendarLayoutError("invalid-event");
  const ids = new Set<string>();
  for (const event of events) {
    if (!event || typeof event.id !== "string" || event.id.trim() === "" || ids.has(event.id)) {
      throw new CalendarLayoutError("invalid-event");
    }
    ids.add(event.id);
  }
}

export function compareId(a: string, b: string): number {
  // Only used as the final tie-breaker after eventIds has ensured uniqueness.
  return a < b ? -1 : 1;
}
