// AUTHORED-BY Codex GPT-6.1-Sol

export const MAX_DELTA_MINUTES = 525_600;
export const MAX_DAY_DELTA = 366;
export const MIN_EPOCH_MS = -62_135_596_800_000; // 0001-01-01T00:00:00.000Z
export const MAX_EPOCH_MS = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z
export const SNAP_MINUTES = Object.freeze([5, 10, 15, 30, 60] as const);

export type DragKind = "move" | "resize-start" | "resize-end";
export type DragScope = "this" | "following" | "all";
export type OverlapChoice = "earlier" | "later";
export type DragErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SNAP"
  | "INVALID_DELTA"
  | "DELTA_TOO_LARGE"
  | "INVALID_RANGE"
  | "INVALID_GESTURE"
  | "INVALID_SCOPE"
  | "INVALID_OVERLAP"
  | "INVALID_ALL_DAY"
  | "UNKNOWN_TIME_ZONE"
  | "AMBIGUOUS_TIME";

/** Messages deliberately exclude caller data. */
export class CalendarDragError extends Error {
  readonly code: DragErrorCode;

  constructor(code: DragErrorCode) {
    super(`Calendar drag: ${code}`);
    this.name = "CalendarDragError";
    this.code = code;
  }
}

export interface DragInput {
  readonly start: number;
  readonly end: number;
  readonly timeZone: string;
  readonly kind: DragKind;
  readonly deltaMinutes: number;
  readonly dayDelta?: number;
  readonly snapMinutes: number;
  readonly allDay?: boolean;
  readonly scope?: DragScope;
  readonly overlap?: OverlapChoice;
}

export interface DragResult {
  readonly start: number;
  readonly end: number;
  readonly clamped: boolean;
  readonly dstAdjusted: boolean;
  readonly scope: DragScope;
  /** Actual changes after snapping, clamping and DST resolution; no RRULE mutation. */
  readonly seriesOffset: {
    readonly startMs: number;
    readonly endMs: number;
    readonly startWallMinutes: number;
    readonly endWallMinutes: number;
    /** Local calendar-date changes, for all-day series (independent of midnight gaps). */
    readonly startDayDelta: number;
    readonly endDayDelta: number;
  };
}

export function check(condition: unknown, code: DragErrorCode): asserts condition {
  if (!condition) throw new CalendarDragError(code);
}

export function checkEpoch(value: number): void {
  check(
    Number.isSafeInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS,
    "INVALID_RANGE",
  );
}
