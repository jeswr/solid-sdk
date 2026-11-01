// AUTHORED-BY Codex GPT-6.1-Sol

export type PhotoTimelineErrorCode =
  | "invalid-photo"
  | "duplicate-id"
  | "invalid-capture-time"
  | "invalid-offset"
  | "invalid-time-zone"
  | "invalid-options"
  | "invalid-date";

/** Fail-closed error; messages contain no caller-provided values. */
export class PhotoTimelineError extends Error {
  constructor(public readonly code: PhotoTimelineErrorCode) {
    super(`Photo timeline: ${code}`);
    this.name = "PhotoTimelineError";
  }
}

export function requireTimeline(
  condition: unknown,
  code: PhotoTimelineErrorCode,
): asserts condition {
  if (!condition) throw new PhotoTimelineError(code);
}

/** Gregorian dates only; reject Date.parse's rollover and years outside 0001–9999. */
export function calendarDate(value: string): void {
  requireTimeline(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01",
    "invalid-date",
  );
  const time = Date.parse(`${value}T00:00:00.000Z`);
  requireTimeline(
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value,
    "invalid-date",
  );
}

export const MIN_TIME = -62_135_596_800_000;
export const MAX_TIME = 253_402_300_799_999;

export function instant(value: number): void {
  requireTimeline(
    Number.isSafeInteger(value) && value >= MIN_TIME && value <= MAX_TIME,
    "invalid-capture-time",
  );
}

/** ISO/EXIF offsets through ±14:00; -00:00 denotes an unknown offset and is rejected. */
export function offsetMinutes(value: string): number {
  requireTimeline(typeof value === "string", "invalid-offset");
  if (value === "Z") return 0;
  requireTimeline(/^[+-]\d{2}:\d{2}$/.test(value) && value !== "-00:00", "invalid-offset");
  const hours = Number(value.slice(1, 3));
  const minutes = Number(value.slice(4));
  requireTimeline(
    hours <= 14 && minutes <= 59 && (hours !== 14 || minutes === 0),
    "invalid-offset",
  );
  return (value[0] === "+" ? 1 : -1) * (hours * 60 + minutes);
}
