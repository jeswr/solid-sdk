// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Build the local (optimistic) records for a logged meal / symptom — pure
 * factories, no I/O. A record is minted with a ULID + its target pod URL + the
 * derived exposures, then handed to the {@link DiaryStore} (instant, `pending`)
 * and flushed to the pod by `sync.ts`.
 */
import {
  deriveExposures,
  type ExposureData,
  type FoodItemData,
  type MealContext,
  type Portion,
  type SymptomType,
} from "@jeswr/solid-health-diary";
import { ulid } from "ulid";
import type { StoredMeal, StoredSymptom } from "../cache/diary-store";
import { mealLabel, mealSignature } from "../cache/diary-store";
import { mealUrl, symptomUrl } from "../pod/layout";

/** Inputs for a new meal log. `at` defaults to now; exposures are derived if omitted. */
export interface NewMealInput {
  storageRoot: string;
  items: FoodItemData[];
  at?: Date;
  context?: MealContext;
  portion?: Portion;
  venue?: string;
  note?: string;
  exposures?: ExposureData[];
}

/** Mint a `pending` StoredMeal (optimistic). Derives exposures from the items. */
export function newMealRecord(input: NewMealInput): StoredMeal {
  const at = input.at ?? new Date();
  const id = ulid(at.getTime());
  const exposures = input.exposures ?? deriveExposures(input.items);
  return {
    kind: "meal",
    ulid: id,
    url: mealUrl(input.storageRoot, at, id),
    startTime: at.toISOString(),
    createdAt: new Date().toISOString(),
    context: input.context,
    portion: input.portion,
    venue: input.venue,
    note: input.note,
    items: input.items,
    exposures,
    signature: mealSignature(input.items),
    label: mealLabel(input.items),
    sync: "pending",
  };
}

/**
 * Clone a past meal as a fresh log at `at` (default now) — the one-tap "Log again"
 * re-log shortcut (DESIGN §5.1.2). New ULID + URL + startTime; same items/exposures.
 */
export function cloneForRelog(meal: StoredMeal, storageRoot: string, at: Date = new Date()): StoredMeal {
  return newMealRecord({
    storageRoot,
    items: structuredClone(meal.items),
    exposures: structuredClone(meal.exposures),
    at,
    context: meal.context,
    portion: meal.portion,
    venue: meal.venue,
    note: meal.note,
  });
}

/** Inputs for a new symptom log. `onset` defaults to now. */
export interface NewSymptomInput {
  storageRoot: string;
  symptomType: SymptomType;
  onset?: Date;
  severity?: number;
  note?: string;
}

/** Mint a `pending` StoredSymptom (optimistic). Onset defaults to now. */
export function newSymptomRecord(input: NewSymptomInput): StoredSymptom {
  const onset = input.onset ?? new Date();
  const id = ulid(onset.getTime());
  return {
    kind: "symptom",
    ulid: id,
    url: symptomUrl(input.storageRoot, onset, id),
    symptomType: input.symptomType,
    onset: onset.toISOString(),
    createdAt: new Date().toISOString(),
    severity: input.severity,
    note: input.note,
    sync: "pending",
  };
}
