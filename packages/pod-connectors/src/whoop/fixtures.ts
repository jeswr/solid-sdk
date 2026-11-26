// AUTHORED-BY Codex GPT-6.1-Sol
import type { FixtureRoute } from "../core/types.js";
import { API } from "./model.js";

/** Synthetic v2-shaped responses; no account data and no provider traffic. */
export const CYCLE = {
  id: 101,
  start: "2026-06-08T06:00:00Z",
  end: "2026-06-09T06:00:00Z",
  updated_at: "2026-06-09T06:10:00Z",
  score_state: "SCORED",
  score: { strain: 12, kilojoule: 4184, average_heart_rate: 70, max_heart_rate: 150 },
};
export const RECOVERY = {
  cycle_id: 101,
  sleep_id: "sleep-101",
  score_state: "SCORED",
  updated_at: "2026-06-08T06:10:00Z",
  score: {
    recovery_score: 80,
    resting_heart_rate: 52,
    hrv_rmssd_milli: 65,
    spo2_percentage: 98,
    skin_temp_celsius: 33.5,
  },
};
export const SLEEP = {
  id: "sleep-101",
  start: "2026-06-07T22:00:00Z",
  end: "2026-06-08T06:00:00Z",
  updated_at: "2026-06-08T06:05:00Z",
  nap: false,
  score_state: "SCORED",
  score: {
    respiratory_rate: 14,
    sleep_performance_percentage: 90,
    stage_summary: {
      total_light_sleep_time_milli: 14_400_000,
      total_slow_wave_sleep_time_milli: 7_200_000,
      total_rem_sleep_time_milli: 5_400_000,
      total_awake_time_milli: 1_800_000,
    },
  },
};
export const WORKOUT = {
  id: "workout-101",
  start: "2026-06-08T08:00:00Z",
  end: "2026-06-08T08:30:00Z",
  sport_name: "Running",
  score_state: "SCORED",
  score: { strain: 8, kilojoule: 1255.2, average_heart_rate: 130, max_heart_rate: 155 },
};
export const WHOOP_FIXTURES: readonly FixtureRoute[] = [
  { url: `${API}/cycle`, json: { records: [CYCLE], next_token: null } },
  { url: `${API}/recovery`, json: { records: [RECOVERY], next_token: null } },
  { url: `${API}/activity/sleep`, json: { records: [SLEEP], next_token: null } },
  { url: `${API}/activity/workout`, json: { records: [WORKOUT], next_token: null } },
];

// AUTHORED-BY Codex GPT-6
/** Real v2 precision: exports omit the millisecond component. */
export const MILLISECOND_WHOOP_FIXTURES: readonly FixtureRoute[] = WHOOP_FIXTURES.map((route) => ({
  ...route,
  json: {
    records: (route.json as { records: Record<string, unknown>[] }).records.map((row) => ({
      ...row,
      ...(typeof row.start === "string" ? { start: row.start.replace("Z", ".777Z") } : {}),
      ...(typeof row.end === "string" ? { end: row.end.replace("Z", ".777Z") } : {}),
    })),
    next_token: null,
  },
}));
