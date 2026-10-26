// AUTHORED-BY Codex GPT-6.1-Sol
import {
  dateOrdinal,
  dayAt,
  finiteResult,
  type HealthSeries,
  HealthTrendsError,
  isObject,
  requireInput,
  validateSeries,
  validateValue,
} from "./validation";

export interface GoalContext {
  /** Integer Unix milliseconds. Called exactly once per analysis. No ambient clock. */
  readonly clock: () => number;
}

export interface GoalProgress {
  readonly date: string;
  readonly value: number | null;
  readonly target: number;
  /** Uncapped fraction: 1 means achieved; null means there is no reading today. */
  readonly ratio: number | null;
  readonly achieved: boolean;
  readonly currentStreak: number;
  readonly longestStreak: number;
}

/** Target is in the series metric's unit and applies to all supplied history. */
export function dailyGoalProgress(
  series: HealthSeries,
  target: number,
  context: GoalContext,
): GoalProgress {
  const days = validateSeries(series);
  validateValue(target, series.metric);
  requireInput(target > 0, "Goal target must be positive");
  requireInput(
    isObject(context) && typeof context.clock === "function",
    "An injected clock is required",
  );
  let now: number;
  let date: string;
  try {
    now = context.clock();
    date = dayAt(now, series.timeZone);
  } catch {
    throw new HealthTrendsError("invalid-clock", "Clock must return a supported instant");
  }
  const today = dateOrdinal(date);
  let value: number | null = null;
  let run = 0;
  let longestStreak = 0;
  let previous = -Infinity;
  for (const day of days) {
    if (day.timestamp > now) {
      throw new HealthTrendsError(
        "future-observation",
        "Goal history contains a future observation",
      );
    }
    const ordinal = dateOrdinal(day.date);
    if (ordinal === today) value = day.value;
    if (day.value >= target) {
      run = ordinal === previous + 1 ? run + 1 : 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
    previous = ordinal;
  }
  // An unfinished today does not erase the streak through yesterday.
  // If today's total missed its target, reconstruct the run ending yesterday.
  let currentStreak = 0;
  let cursor = value !== null && value >= target ? today : today - 1;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i] as (typeof days)[number];
    const ordinal = dateOrdinal(day.date);
    if (ordinal > cursor) continue;
    if (ordinal !== cursor || day.value < target) break;
    currentStreak++;
    cursor--;
  }
  return {
    date,
    value,
    target,
    ratio: value === null ? null : finiteResult(value / target),
    achieved: value !== null && value >= target,
    currentStreak,
    longestStreak,
  };
}
