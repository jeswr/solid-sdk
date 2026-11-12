// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Synthetic-fixture factories for the inference-engine characterization tests. Pure
 * builders of `@jeswr/solid-health-diary` plain-data shapes — no RDF, no I/O. Times
 * are expressed as hour offsets from a fixed UTC base so lag-window boundary cases
 * are exact and reproducible.
 *
 * (Test-only helpers; imported by the `*.test.ts` files in this directory.)
 */

import type {
  ExposureData,
  ExposureLevel,
  FoodItemData,
  MealData,
  SymptomData,
  SymptomType,
  TriggerClassData,
  TriggerSlug,
} from "@jeswr/solid-health-diary";

/** Fixed UTC base for all fixtures. */
export const BASE_ISO = "2026-01-01T08:00:00.000Z";
export const BASE_MS = Date.parse(BASE_ISO);
const HOUR_MS = 3_600_000;

/** A Date `hours` after the fixed base (may be fractional / negative). */
export function at(hours: number): Date {
  return new Date(BASE_MS + hours * HOUR_MS);
}

let itemSeq = 0;
function anItem(name = "test food"): FoodItemData {
  itemSeq += 1;
  return { id: `https://pod.example/meals/m#item-${itemSeq}`, name };
}

/** Build a MealData at ingestion `hours`, exposed to the given trigger levels. */
export function meal(input: {
  id?: string;
  hours: number;
  exposures?: { trigger: TriggerSlug; level?: ExposureLevel; derivedFrom?: string[] }[];
  items?: FoodItemData[];
}): MealData {
  const exposures: ExposureData[] = (input.exposures ?? []).map((e, i) => ({
    id: `${input.id ?? "https://pod.example/meals/m"}#exposure-${i}`,
    trigger: e.trigger,
    exposureLevel: e.level ?? "present",
    derivedFrom: e.derivedFrom,
  }));
  return {
    id: input.id ?? `https://pod.example/meals/m-${input.hours}#it`,
    startTime: at(input.hours),
    items: input.items ?? [anItem()],
    exposures: exposures.length ? exposures : undefined,
  };
}

/** Build a SymptomData with onset `hours` after base. */
export function symptom(input: {
  id?: string;
  type?: SymptomType;
  hours: number;
  severity?: number;
}): SymptomData {
  return {
    id: input.id ?? `https://pod.example/symptoms/s-${input.hours}#it`,
    symptomType: input.type ?? "bloating",
    onset: at(input.hours),
    severity: input.severity,
  };
}

/** Build a per-user TriggerClassData with an explicit lag profile (hours). */
export function triggerClass(
  slug: TriggerSlug,
  lag: { min: number; max: number; mode: number },
): TriggerClassData {
  return { slug, label: slug, lagWindowMin: lag.min, lagWindowMax: lag.max, lagMode: lag.mode };
}

/** A Date `days` after the fixed base (UTC), for review/reintroduction fixtures. */
export function atDays(days: number): Date {
  return new Date(BASE_MS + days * 24 * HOUR_MS);
}
