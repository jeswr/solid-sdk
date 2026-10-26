// AUTHORED-BY Codex GPT-6.1-Sol
import type { Observation } from "./aggregation";
import {
  type BucketOptions,
  calendarDate,
  createBucketer,
  dateKey,
  floorDate,
  nextDate,
} from "./buckets";
import { finite } from "./validation";

export interface CalendarRange {
  /** Inclusive Gregorian local date labels (not instants). */
  readonly start: string;
  readonly end: string;
}

/** Missing calendar buckets intersecting the inclusive range; never fabricates values.
 * A skipped civil date (e.g. a timezone's date-line move) is also a calendar gap.
 */
export function detectGaps(
  observations: readonly Observation[],
  options: BucketOptions,
  range: CalendarRange,
): string[] {
  const keyOf = createBucketer(options);
  const start = calendarDate(range.start);
  const end = calendarDate(range.end);
  if (start > end) throw new RangeError("Range start must not follow end");
  const occupied = new Set(
    observations.map((observation) => {
      finite(observation.value);
      return keyOf(observation.timestamp);
    }),
  );
  const gaps: string[] = [];
  for (
    const cursor = floorDate(start, options.period);
    cursor <= end;
    nextDate(cursor, options.period)
  ) {
    const key = dateKey(cursor);
    if (!occupied.has(key)) gaps.push(key);
  }
  return gaps;
}

/** Trailing sample average, aligned to input. Full windows only; null propagates gaps. */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
): (number | null)[] {
  if (!Number.isSafeInteger(window) || window <= 0)
    throw new RangeError("Expected a positive integer window");
  for (const value of values) {
    if (value !== null) finite(value);
  }
  return values.map((_, index) => {
    if (index + 1 < window) return null;
    let mean = 0;
    for (let i = index + 1 - window; i <= index; i++) {
      const value = values[i] as number | null;
      if (value === null) return null;
      mean += value / window;
    }
    return finite(mean);
  });
}
