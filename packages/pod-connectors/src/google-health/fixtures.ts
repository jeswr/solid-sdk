// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/**
 * Synthetic, non-personal examples in the documented Google Health v4 shapes (see api.ts):
 * DataPoint payloads with nested `sampleTime`/`interval` times, int64 values as strings,
 * and DailyRollupDataPoint buckets. The user is in UTC so wall clock and instant agree.
 */
import type { FixtureRoute } from "../core/types.js";
import { DAY_MS, endpoint, record, summary, TYPES } from "./api.js";

const civil = (date: string, hours = 0, minutes = 0) => {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day }, time: { hours, minutes } };
};
const WATCH = {
  platform: "FITBIT",
  recordingMethod: "PASSIVELY_MEASURED",
  device: { formFactor: "WATCH", manufacturer: "Google", displayName: "Synthetic Watch" },
};

/** A dailyRollUp bucket for 2026-06-08 (steps). */
export const STEPS = {
  civilStartTime: { date: civil("2026-06-08").date },
  civilEndTime: { date: civil("2026-06-09").date },
  steps: { countSum: "6120" },
};
export const HEART_RATE = {
  dataSource: WATCH,
  heartRate: {
    sampleTime: {
      physicalTime: "2026-06-08T07:12:00Z",
      utcOffset: "0s",
      civilTime: civil("2026-06-08", 7, 12),
    },
    beatsPerMinute: "72",
  },
};
export const WEIGHT = {
  dataSource: { platform: "HEALTH_CONNECT", recordingMethod: "MANUAL" },
  weight: {
    sampleTime: {
      physicalTime: "2026-06-08T07:00:00Z",
      utcOffset: "0s",
      civilTime: civil("2026-06-08", 7),
    },
    weightGrams: 70_000,
  },
};
export const EXERCISE = {
  name: "users/me/dataTypes/exercise/dataPoints/51817963271",
  dataSource: WATCH,
  exercise: {
    interval: {
      startTime: "2026-06-08T07:12:00Z",
      endTime: "2026-06-08T07:43:00Z",
      startUtcOffset: "0s",
      endUtcOffset: "0s",
      civilStartTime: civil("2026-06-08", 7, 12),
      civilEndTime: civil("2026-06-08", 7, 43),
    },
    exerciseType: "RUNNING",
    displayName: "Running",
    activeDuration: "1860s",
    metricsSummary: { distanceMillimeters: 5_200_000, steps: "6120", caloriesKcal: 432 },
    updateTime: "2026-06-08T08:00:00Z",
  },
};
const stage = (type: string, startTime: string, endTime: string) => ({
  type,
  startTime,
  endTime,
  startUtcOffset: "0s",
  endUtcOffset: "0s",
});
export const SLEEP = {
  dataSource: WATCH,
  sleep: {
    interval: {
      startTime: "2026-06-08T22:00:00Z",
      endTime: "2026-06-09T06:00:00Z",
      startUtcOffset: "0s",
      endUtcOffset: "0s",
      civilStartTime: civil("2026-06-08", 22),
      civilEndTime: civil("2026-06-09", 6),
    },
    type: "STAGES",
    stages: [
      stage("LIGHT", "2026-06-08T22:00:00Z", "2026-06-09T00:00:00Z"),
      stage("DEEP", "2026-06-09T00:00:00Z", "2026-06-09T02:00:00Z"),
      stage("REM", "2026-06-09T02:00:00Z", "2026-06-09T06:00:00Z"),
    ],
    metadata: { processed: true, mainSleep: true, nap: false },
    updateTime: "2026-06-09T06:30:00Z",
  },
};
const LISTED: Partial<Record<(typeof TYPES)[number], unknown[]>> = {
  "heart-rate": [HEART_RATE],
  weight: [WEIGHT],
  sleep: [SLEEP],
  exercise: [EXERCISE],
};
export const GOOGLE_HEALTH_FIXTURES: readonly FixtureRoute[] = TYPES.map((type) =>
  summary(type)
    ? {
        method: "POST",
        url: endpoint(type),
        json: type === "steps" ? { rollupDataPoints: [STEPS] } : {},
      }
    : { url: endpoint(type), json: { dataPoints: LISTED[type] ?? [] } },
);

/** The fixtures above are dated for an import run at this instant. */
export const FIXTURE_NOW = new Date("2026-06-10T00:00:00Z");

/**
 * The synthetic fixtures moved by whole days so they fall within a first import's lookback
 * at `now`, keeping each wall-clock time and offset (demo mode only). Both RFC 3339 strings
 * and civil `{year, month, day}` dates move.
 */
export function demoFixtures(now: Date): readonly FixtureRoute[] {
  const days = Math.floor((now.getTime() - FIXTURE_NOW.getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days === 0) return GOOGLE_HEALTH_FIXTURES;
  const shift = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  const move = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(move);
    if (typeof value === "string")
      return /^\d{4}-\d{2}-\d{2}T/.test(value)
        ? `${shift(value.slice(0, 10))}${value.slice(10)}`
        : value;
    if (!record(value)) return value;
    const { year, month, day } = value;
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      const [y, m, d] = shift(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      )
        .split("-")
        .map(Number);
      return { ...value, year: y, month: m, day: d };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, move(v)]));
  };
  return GOOGLE_HEALTH_FIXTURES.map((route) => ({ ...route, json: move(route.json) }));
}
