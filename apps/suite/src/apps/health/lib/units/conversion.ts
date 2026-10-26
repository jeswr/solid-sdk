// AUTHORED-BY Codex GPT-6.1-Sol
import { UnitError } from "./errors";

/** Exact integer ratios to the measure's canonical unit, before number rounding. */
const units = {
  kg: ["mass", 1, 1, 0],
  g: ["mass", 1, 1000, 0],
  mg: ["mass", 1, 1000000, 0],
  "[lb_av]": ["mass", 45359237, 100000000, 0],
  "[oz_av]": ["mass", 45359237, 1600000000, 0],
  m: ["length", 1, 1, 0],
  mm: ["length", 1, 1000, 0],
  cm: ["length", 1, 100, 0],
  km: ["length", 1000, 1, 0],
  "[in_i]": ["length", 127, 5000, 0],
  "[ft_i]": ["length", 381, 1250, 0],
  "[yd_i]": ["length", 1143, 1250, 0],
  "[mi_i]": ["length", 201168, 125, 0],
  // Absolute temperatures: canonical = (value - origin) * numerator / denominator.
  Cel: ["temperature", 1, 1, 0],
  "[degF]": ["temperature", 5, 9, 32],
  K: ["temperature", 1, 1, 273.15],
  "mmol/L": ["blood-glucose", 1, 1, 0],
  // Glucose only: 180.156 g/mol => 1 mmol/L = 18.0156 mg/dL.
  "mg/dL": ["blood-glucose", 2500, 45039, 0],
  "mm[Hg]": ["blood-pressure", 1, 1, 0],
  kJ: ["energy", 1, 1, 0],
  J: ["energy", 1, 1000, 0],
  kcal: ["energy", 523, 125, 0],
  ms: ["duration", 1, 1000, 0],
  s: ["duration", 1, 1, 0],
  min: ["duration", 60, 1, 0],
  h: ["duration", 3600, 1, 0],
  d: ["duration", 86400, 1, 0],
} as const;

export type UcumUnit = keyof typeof units;

const aliases = {
  lb: "[lb_av]",
  oz: "[oz_av]",
  in: "[in_i]",
  ft: "[ft_i]",
  yd: "[yd_i]",
  mi: "[mi_i]",
  mmHg: "mm[Hg]",
} as const satisfies Record<string, UcumUnit>;

export type HealthUnit = UcumUnit | keyof typeof aliases;

const canonicalUnits = {
  mass: "kg",
  length: "m",
  distance: "m",
  temperature: "Cel",
  "blood-glucose": "mmol/L",
  "blood-pressure": "mm[Hg]",
  energy: "kJ",
  duration: "s",
} as const satisfies Record<string, UcumUnit>;

export type Measure = keyof typeof canonicalUnits;
export type CanonicalUnit<M extends Measure> = (typeof canonicalUnits)[M];

/** No trimming, case folding, prefix parsing, or chemical-context inference. */
export function resolveUnit(unit: string): UcumUnit {
  if (typeof unit !== "string") {
    throw new UnitError("unknown-unit", "Expected a supported unit code");
  }
  if (Object.hasOwn(units, unit)) return unit as UcumUnit;
  if (Object.hasOwn(aliases, unit)) return aliases[unit as keyof typeof aliases];
  throw new UnitError("unknown-unit", "Unsupported unit code");
}

export function canonicalUnit<M extends Measure>(measure: M): CanonicalUnit<M> {
  if (typeof measure !== "string" || !Object.hasOwn(canonicalUnits, measure)) {
    throw new UnitError("unknown-measure", "Unsupported measure");
  }
  return canonicalUnits[measure];
}

/** Explicit measure is required, including for identity and glucose conversions. */
export function convertUnit(value: number, from: string, to: string, measure: Measure): number {
  const canonical = canonicalUnit(measure);
  const sourceCode = resolveUnit(from);
  const targetCode = resolveUnit(to);
  const source = units[sourceCode];
  const target = units[targetCode];
  if (source[0] !== units[canonical][0] || target[0] !== units[canonical][0]) {
    throw new UnitError("incompatible-unit", "Unit does not match the measure");
  }
  if (!Number.isFinite(value)) {
    throw new UnitError("invalid-value", "Expected a finite numeric value");
  }
  if (sourceCode === targetCode) return value;
  // Combine scale ratios before multiplying to avoid needless intermediate overflow.
  const scale = (source[1] * target[2]) / (source[2] * target[1]);
  const shifted = value - source[3];
  const result = shifted * scale + target[3];
  if (!Number.isFinite(result) || (result === target[3] && shifted !== 0)) {
    throw new UnitError("numeric-range", "Conversion exceeds numeric precision or range");
  }
  return result;
}
