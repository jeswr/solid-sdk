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
 * Meals + symptoms + protocols + conclusions live in the cache and are always fed to
 * the engine. `triggerClasses` is now ALSO fed from the cache
 * ({@link StoredTriggerClass}, one per learned trigger — see
 * `./learn-lag-profile`) so a returning user's per-trigger lag window is used
 * instead of the model's evidence prior every single run (the load-bearing
 * data-flow fix this bridge exists for). A garbled/invalid stored profile is
 * DROPPED here too (`isValidLagProfile`), mirroring the package's own fail-closed
 * discipline (`parseTriggerClass`) — a corrupt cache entry can never poison lag
 * attribution; `resolveLag` simply falls back to the evidence prior for that
 * trigger. `plan` is left unset — it is a cheap pure DERIVATION over
 * conclusions+protocols (`./diet-plan`), not a cached artifact of its own.
 */
import {
  isValidLagProfile,
  type MealData,
  type SymptomData,
  type TriggerClassData,
} from "@jeswr/solid-health-diary";
import type {
  StoredConclusion,
  StoredMeal,
  StoredProtocol,
  StoredSafetyContext,
  StoredSymptom,
  StoredTriggerClass,
} from "../cache/diary-store";
import { storedConclusionToData, storedProtocolToData } from "../protocol/persist";
import type { DiaryData, SafetyContext } from "./types";

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
 * Convert one cached learned trigger class to a {@link TriggerClassData}, or
 * `undefined` if its lag profile does not validate (`isValidLagProfile`) — a
 * corrupt/garbled cache entry is dropped rather than fed to the engine, mirroring
 * the package's own `parseTriggerClass` fail-closed discipline.
 */
export function storedTriggerClassToData(tc: StoredTriggerClass): TriggerClassData | undefined {
  const profile = { lagWindowMin: tc.lagWindowMin, lagWindowMax: tc.lagWindowMax, lagMode: tc.lagMode };
  if (!isValidLagProfile(profile)) return undefined;
  return { slug: tc.slug, ...profile, label: tc.label };
}

/**
 * The inverse mapping — a freshly LEARNED {@link TriggerClassData} (see
 * `./learn-lag-profile`) to the cached record shape, ready for
 * `DiaryStore.putTriggerClass`. `sampleSize` is carried separately (the engine's
 * output type has no notion of "how many pairings"); callers supply it from the
 * learning pass so the cache record stays self-describing/transparent.
 */
export function triggerClassDataToStored(
  data: TriggerClassData,
  sampleSize: number,
  updatedAt: string = new Date().toISOString(),
): StoredTriggerClass {
  return {
    kind: "triggerClass",
    slug: data.slug,
    lagWindowMin: data.lagWindowMin,
    lagWindowMax: data.lagWindowMax,
    lagMode: data.lagMode,
    label: data.label,
    sampleSize,
    updatedAt,
  };
}

/** Convert the cached safety-context record to the engine's {@link SafetyContext}. */
export function storedSafetyContextToContext(ctx: StoredSafetyContext | undefined): SafetyContext {
  if (!ctx) return {};
  return {
    coeliacDiagnosed: ctx.coeliacDiagnosed,
    alarmFlags: ctx.alarmFlags,
    strictAdherence: ctx.strictAdherence,
  };
}

/**
 * Build the engine's {@link DiaryData} snapshot from the cached meal/symptom lists.
 * Records with an unparseable timestamp are skipped (fail-closed lag anchoring).
 * `triggerClasses` (locally-learned, per-user lag profiles) defaults to `[]` — a
 * caller with none cached yet gets the same behaviour as before (the engine falls
 * back to the model's evidence priors for every trigger).
 */
export function diaryDataFromCache(
  meals: readonly StoredMeal[],
  symptoms: readonly StoredSymptom[],
  protocols: readonly StoredProtocol[] = [],
  conclusions: readonly StoredConclusion[] = [],
  triggerClasses: readonly StoredTriggerClass[] = [],
): DiaryData {
  return {
    meals: meals
      .map(storedMealToData)
      .filter((m): m is MealData => m !== undefined),
    symptoms: symptoms
      .map(storedSymptomToData)
      .filter((s): s is SymptomData => s !== undefined),
    protocols: protocols.map(storedProtocolToData),
    conclusions: conclusions.map(storedConclusionToData),
    triggerClasses: triggerClasses
      .map(storedTriggerClassToData)
      .filter((t): t is TriggerClassData => t !== undefined),
  };
}
