// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** Synthetic, non-personal examples of the narrow provider profile documented in api.ts. */
import type { FixtureRoute } from "../core/types.js";
import { DAY_MS, endpoint, TYPES } from "./api.js";

export const STEPS = {
  startTime: "2026-06-08T00:00:00Z",
  endTime: "2026-06-09T00:00:00Z",
  steps: { count: 6120 },
};
export const HEART_RATE = { time: "2026-06-08T07:12:00Z", heartRate: { beatsPerMinute: 72 } };
export const WEIGHT = { time: "2026-06-08T07:00:00Z", weight: { kilograms: 70 } };
export const EXERCISE = {
  name: "users/me/dataTypes/exercise-session/dataPoints/51817963271",
  startTime: "2026-06-08T07:12:00Z",
  endTime: "2026-06-08T07:43:00Z",
  exerciseSession: { activityName: "Run", distanceMeters: 5200 },
};
export const SLEEP = {
  startTime: "2026-06-08T22:00:00Z",
  endTime: "2026-06-09T06:00:00Z",
  sleep: {
    stages: [
      { startTime: "2026-06-08T22:00:00Z", endTime: "2026-06-09T00:00:00Z", stage: "light" },
      { startTime: "2026-06-09T00:00:00Z", endTime: "2026-06-09T02:00:00Z", stage: "deep" },
      { startTime: "2026-06-09T02:00:00Z", endTime: "2026-06-09T06:00:00Z", stage: "rem" },
    ],
  },
};
export const GOOGLE_HEALTH_FIXTURES: readonly FixtureRoute[] = TYPES.map((type) => ({
  url: endpoint(type),
  json: {
    dataPoints:
      type === "steps"
        ? [STEPS]
        : type === "heart-rate"
          ? [HEART_RATE]
          : type === "weight"
            ? [WEIGHT]
            : type === "sleep"
              ? [SLEEP]
              : type === "exercise-session"
                ? [EXERCISE]
                : [],
    nextPageToken: "",
  },
}));

/** The fixtures above are dated for an import run at this instant. */
export const FIXTURE_NOW = new Date("2026-06-10T00:00:00Z");

/**
 * The synthetic fixtures moved by whole days so they fall within a first import's lookback
 * at `now`, keeping each wall-clock time and offset (demo mode only).
 */
export function demoFixtures(now: Date): readonly FixtureRoute[] {
  const days = Math.floor((now.getTime() - FIXTURE_NOW.getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days === 0) return GOOGLE_HEALTH_FIXTURES;
  const shift = (date: string) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  return GOOGLE_HEALTH_FIXTURES.map((route) => ({
    ...route,
    json: JSON.parse(
      JSON.stringify(route.json).replace(
        /"(\d{4}-\d{2}-\d{2})T/g,
        (_, date: string) => `"${shift(date)}T`,
      ),
    ),
  }));
}
