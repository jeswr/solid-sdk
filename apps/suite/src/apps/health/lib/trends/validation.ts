// AUTHORED-BY Codex GPT-6.1-Sol
import { bucketKey } from "../stats";

export type HealthMetric = "steps" | "sleepMinutes" | "activeMinutes";
export type HealthTrendsErrorCode =
  | "invalid-input"
  | "duplicate-day"
  | "invalid-clock"
  | "future-observation"
  | "arithmetic-overflow";

export class HealthTrendsError extends Error {
  override readonly name = "HealthTrendsError";
  constructor(
    readonly code: HealthTrendsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** One normalized daily total. Timestamp identifies its local day, not an interval. */
export interface DailyTotal {
  readonly timestamp: number;
  readonly value: number;
}

export interface HealthSeries {
  readonly metric: HealthMetric;
  readonly timeZone: string;
  readonly totals: readonly DailyTotal[];
}

export interface DayTotal extends DailyTotal {
  readonly date: string;
}

export const DAY_MS = 86_400_000;

export function requireInput(condition: boolean, message: string): asserts condition {
  if (!condition) throw new HealthTrendsError("invalid-input", message);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function finiteResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw new HealthTrendsError("arithmetic-overflow", "Calculation exceeds numeric range");
  }
  return value;
}

export function validateValue(value: number, metric: HealthMetric): void {
  requireInput(
    Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    "Expected a nonnegative total within the safe numeric range",
  );
  requireInput(metric !== "steps" || Number.isSafeInteger(value), "Steps must be whole numbers");
}

/** Civil date arithmetic uses UTC only as a carrier, independent of DST day lengths. */
export function dateOrdinal(date: string): number {
  requireInput(
    typeof date === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date),
    "Expected a Gregorian YYYY-MM-DD date from 0001 to 9999",
  );
  const at = Date.parse(`${date}T00:00:00.000Z`);
  requireInput(
    Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === date,
    "Expected a valid Gregorian date",
  );
  return at / DAY_MS;
}

export function dayAt(at: number, timeZone: string): string {
  try {
    return bucketKey(at, { period: "day", timeZone });
  } catch {
    throw new HealthTrendsError("invalid-input", "Invalid timestamp or explicit time zone");
  }
}

export function validateSeries(series: HealthSeries): DayTotal[] {
  requireInput(isObject(series), "Expected a health series");
  requireInput(
    ["steps", "sleepMinutes", "activeMinutes"].includes(series.metric),
    "Unsupported health metric",
  );
  // Validate the timezone even for empty series, with no system timezone fallback.
  dayAt(0, series.timeZone);
  requireInput(Array.isArray(series.totals), "Expected an array of daily totals");
  const totals: readonly DailyTotal[] = series.totals;
  const seen = new Set<string>();
  const days: DayTotal[] = [];
  for (const total of totals) {
    requireInput(isObject(total), "Expected a daily total");
    validateValue(total.value, series.metric);
    const date = dayAt(total.timestamp, series.timeZone);
    if (seen.has(date)) {
      throw new HealthTrendsError("duplicate-day", "Resolve overlapping totals before analysis");
    }
    seen.add(date);
    days.push({ date, timestamp: total.timestamp, value: total.value });
  }
  return days.sort((a, b) => dateOrdinal(a.date) - dateOrdinal(b.date));
}
