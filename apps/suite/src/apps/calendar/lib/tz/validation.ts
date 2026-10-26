// AUTHORED-BY Codex GPT-6.1-Sol
export type CalendarTimeErrorCode =
  | "invalid-wall-time"
  | "invalid-instant"
  | "invalid-zone"
  | "invalid-option"
  | "nonexistent-time"
  | "ambiguous-time"
  | "invalid-series"
  | "unsupported-rule"
  | "invalid-occurrence";

/** Stable error codes; messages deliberately exclude caller data. */
export class CalendarTimeError extends Error {
  constructor(public readonly code: CalendarTimeErrorCode) {
    super(`Calendar time: ${code}`);
    this.name = "CalendarTimeError";
  }
}

export const MIN_TIME = Date.parse("2000-01-01T00:00:00Z");
export const MAX_TIME = Date.parse("2100-01-01T00:00:00Z");

export function assertInstant(value: number): void {
  if (!Number.isInteger(value) || value % 1000 !== 0 || value < MIN_TIME || value >= MAX_TIME) {
    throw new CalendarTimeError("invalid-instant");
  }
}

export function wallEpoch(value: string): number {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new CalendarTimeError("invalid-wall-time");
  }
  const epoch = Date.parse(`${value}Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 19) !== value) {
    throw new CalendarTimeError("invalid-wall-time");
  }
  return epoch;
}
