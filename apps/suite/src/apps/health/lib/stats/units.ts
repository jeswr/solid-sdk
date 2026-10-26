// AUTHORED-BY Codex GPT-6.1-Sol
import { finite } from "./validation";

const units = {
  kg: { dimension: "mass", scale: 1 },
  lb: { dimension: "mass", scale: 0.45359237 },
  km: { dimension: "distance", scale: 1 },
  mi: { dimension: "distance", scale: 1.609344 },
  kcal: { dimension: "energy", scale: 4.184 },
  kJ: { dimension: "energy", scale: 1 },
  "mmol/L": { dimension: "glucose", scale: 18 },
  "mg/dL": { dimension: "glucose", scale: 1 },
} as const;

export type HealthUnit = keyof typeof units;

/** Convert without display rounding. mmol/L ↔ mg/dL is glucose-specific (factor 18). */
export function convertUnit(value: number, from: HealthUnit, to: HealthUnit): number {
  finite(value);
  if (!Object.hasOwn(units, from) || !Object.hasOwn(units, to)) {
    throw new RangeError("Unsupported health unit");
  }
  if (units[from].dimension !== units[to].dimension) {
    throw new RangeError("Cannot convert between different dimensions");
  }
  return finite(value * (units[from].scale / units[to].scale));
}
