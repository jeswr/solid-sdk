// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Existing health sector / Health app measurement terms; no Garmin-specific IRIs. */
import { HEALTH } from "@jeswr/solid-health";
import { NS } from "@jeswr/suite-vocab";

/** Codes and units agree with Health's Apple importer for steps, pulse and sleep.
 * Other measurements use source field codes without asserting a concept scheme;
 * UCUM strings suffice where no verified QUDT unit is available locally.
 */
export const METRICS = {
  steps: [HEALTH.Steps, "55423-8", "1", `${NS.UNIT}NUM`],
  "resting-heart-rate": [HEALTH.HeartRate, "restingHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "minimum-heart-rate": [HEALTH.HeartRate, "minHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "maximum-heart-rate": [HEALTH.HeartRate, "maxHeartRate", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  "heart-rate": [HEALTH.HeartRate, "8867-4", "/min", `${NS.UNIT}BEAT-PER-MIN`],
  distance: [HEALTH.Observation, "totalDistanceMeters", "m", `${NS.UNIT}M`],
  "active-energy": [HEALTH.Observation, "activeKilocalories", "kcal", undefined],
  floors: [HEALTH.Observation, "floorsAscended", "1", `${NS.UNIT}NUM`],
  sleep: [HEALTH.Sleep, "93832-4", "s", `${NS.UNIT}SEC`],
  hrv: [HEALTH.Observation, "lastNightAvg", "ms", undefined],
  "vo2max-running": [HEALTH.Observation, "running.vo2MaxValue", "mL/(kg.min)", undefined],
  "vo2max-cycling": [HEALTH.Observation, "cycling.vo2MaxValue", "mL/(kg.min)", undefined],
} as const;
export type Metric = keyof typeof METRICS;
