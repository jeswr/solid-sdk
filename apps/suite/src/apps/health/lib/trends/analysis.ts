// AUTHORED-BY Codex GPT-6.1-Sol
import {
  DAY_MS,
  type DayTotal,
  dateOrdinal,
  finiteResult,
  type HealthSeries,
  isObject,
  requireInput,
  validateSeries,
} from "./validation";

export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export interface RollingAverage {
  readonly date: string;
  readonly value: number | null;
  readonly average7: number | null;
  readonly average30: number | null;
}

/** Full trailing calendar windows, including history before range.start. No imputation. */
export function rollingAverages(series: HealthSeries, range: DateRange): RollingAverage[] {
  const days = validateSeries(series);
  requireInput(isObject(range), "Expected an inclusive date range");
  const start = dateOrdinal(range.start);
  const end = dateOrdinal(range.end);
  requireInput(start <= end, "Range start must not follow end");
  const values = new Map(days.map((day) => [dateOrdinal(day.date), day.value]));
  const average = (day: number, window: number): number | null => {
    let mean = 0;
    for (let i = day - window + 1; i <= day; i++) {
      const value = values.get(i);
      if (value === undefined) return null;
      mean += value / window;
    }
    return finiteResult(mean);
  };
  const result: RollingAverage[] = [];
  for (let day = start; day <= end; day++) {
    result.push({
      date: new Date(day * DAY_MS).toISOString().slice(0, 10),
      value: values.get(day) ?? null,
      average7: average(day, 7),
      average30: average(day, 30),
    });
  }
  return result;
}

export interface Trend {
  readonly classification: "up" | "down" | "flat" | null;
  /** Metric units per civil day, null when fewer than two days are available. */
  readonly slope: number | null;
  readonly count: number;
}

/** Ordinary least squares over observed days; missing dates preserve their x-distance. */
export function classifyTrend(series: HealthSeries, threshold: number): Trend {
  const days = validateSeries(series);
  requireInput(
    Number.isFinite(threshold) && threshold >= 0,
    "Expected a nonnegative finite threshold",
  );
  const count = days.length;
  if (count < 2) return { classification: null, slope: null, count };
  const first = days[0] as DayTotal;
  const origin = dateOrdinal(first.date);
  let meanX = 0;
  let meanY = 0;
  for (const day of days) {
    meanX += (dateOrdinal(day.date) - origin) / count;
    meanY += (day.value - first.value) / count;
  }
  let covariance = 0;
  let variance = 0;
  for (const day of days) {
    const x = dateOrdinal(day.date) - origin - meanX;
    covariance += x * (day.value - first.value - meanY);
    variance += x * x;
  }
  const slope = finiteResult(covariance / variance);
  return {
    classification: slope > threshold ? "up" : slope < -threshold ? "down" : "flat",
    slope,
    count,
  };
}

/** All strict daily record highs, chronological; first reading establishes the baseline. */
export function personalBests(series: HealthSeries): DayTotal[] {
  const days = validateSeries(series);
  const records: DayTotal[] = [];
  let best = -Infinity;
  for (const day of days) {
    if (day.value > best) {
      records.push(day);
      best = day.value;
    }
  }
  return records;
}
