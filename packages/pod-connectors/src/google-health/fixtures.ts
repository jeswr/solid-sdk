// AUTHORED-BY Codex GPT-6.1-Sol
/** Synthetic, non-personal examples of the narrow provider profile documented in api.ts. */
import type { FixtureRoute } from "../core/types.js";
import { endpoint, TYPES } from "./api.js";

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
