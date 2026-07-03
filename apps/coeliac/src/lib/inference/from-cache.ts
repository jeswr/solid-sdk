// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Bridge the durable client cache ({@link StoredMeal} / {@link StoredSymptom}) to the
 * pure inference engine's {@link DiaryData} snapshot — a small, PURE, testable mapper
 * so the engine can run over the same records the diary paints from (no extra pod
 * round-trip; works fully offline).
 *
 * The cache stores dates as ISO strings; the engine reasons over `Date`s where
 * `startTime` (ingestion) and `onset` are load-bearing for every lag calculation. A
 * record whose timestamp does not parse is DROPPED here rather than fed to the engine
 * as a `NaN` date — a malformed lag anchor would silently corrupt correlation, so
 * fail-closed (skip the record) is the safe choice.
 *
 * Only meals + symptoms live in today's cache, so `triggerClasses` / `protocols` /
 * `conclusions` / `plan` are left unset — the engine treats them as optional and
 * falls back to the model's evidence-prior lag windows.
 */
import type { MealData, SymptomData } from "@jeswr/solid-health-diary";
import type { StoredMeal, StoredSymptom } from "../cache/diary-store.js";
import type { DiaryData } from "./types.js";

/** Parse an ISO timestamp to a valid `Date`, or `undefined` when it does not parse. */
function parseDate(iso: string): Date | undefined {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Convert one cached meal to a {@link MealData}, or `undefined` if its ingestion time is unparseable. */
export function storedMealToData(meal: StoredMeal): MealData | undefined {
  const startTime = parseDate(meal.startTime);
  if (!startTime) return undefined;
  return {
    id: meal.url,
    startTime,
    context: meal.context,
    portion: meal.portion,
    venue: meal.venue,
    note: meal.note,
    items: meal.items,
    exposures: meal.exposures,
  };
}

/** Convert one cached symptom to a {@link SymptomData}, or `undefined` if its onset is unparseable. */
export function storedSymptomToData(symptom: StoredSymptom): SymptomData | undefined {
  const onset = parseDate(symptom.onset);
  if (!onset) return undefined;
  return {
    id: symptom.url,
    symptomType: symptom.symptomType,
    onset,
    severity: symptom.severity,
    note: symptom.note,
  };
}

/**
 * Build the engine's {@link DiaryData} snapshot from the cached meal/symptom lists.
 * Records with an unparseable timestamp are skipped (fail-closed lag anchoring).
 */
export function diaryDataFromCache(
  meals: readonly StoredMeal[],
  symptoms: readonly StoredSymptom[],
): DiaryData {
  return {
    meals: meals
      .map(storedMealToData)
      .filter((m): m is MealData => m !== undefined),
    symptoms: symptoms
      .map(storedSymptomToData)
      .filter((s): s is SymptomData => s !== undefined),
  };
}
