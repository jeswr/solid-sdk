// AUTHORED-BY Claude Fable 5
/**
 * Eating-out context clustering (DESIGN §2.2 `diet:context`, §4). A PURE, no-I/O
 * function that answers one honest question from the diary: **do your symptoms
 * cluster on restaurant meals?** It compares the rate at which a (non-emergency)
 * symptom follows a `restaurant`-context meal against the rate for `home`-context
 * meals, over a coarse post-meal reaction window.
 *
 * This is inference-adjacent, so it obeys the same house rules as the correlation
 * core:
 *
 * - **Emergency symptoms are never inference fodder** — they are excluded here and
 *   surface only via the emergency rail (`isEmergencySymptomType`, single-sourced
 *   from the model, DESIGN §4.4).
 * - **Never overclaims.** It is a coarse *context* signal (was A symptom followed?),
 *   deliberately NOT a per-trigger lag correlation, so it shows counts, never a
 *   causal claim, and carries the always-attached "pattern not a diagnosis" caveat.
 * - **Fail-quiet on thin data.** Nothing is surfaced until there are enough
 *   restaurant meals to say anything meaningful ({@link MIN_MEALS_PER_CONTEXT}) —
 *   a single bad restaurant trip never produces a "you react to eating out" claim.
 *
 * Meals without a recorded `diet:context` are simply not counted (they can't be
 * attributed to a setting) — they never distort the comparison.
 */

import type { MealContext, MealData, SymptomData } from "@jeswr/solid-health-diary";
import { PATTERN_NOT_DIAGNOSIS } from "./types";
import { isEmergencySymptomType } from "./safety";

/** The coarse post-meal window (hours) within which a following symptom counts. */
export const CONTEXT_WINDOW_HOURS = 24;
/** Minimum meals in a context before it can enter the comparison (thin-data guard). */
export const MIN_MEALS_PER_CONTEXT = 4;
/** Restaurant follow-rate floor before an eating-out cluster is claimed. */
export const CLUSTER_RATE_FLOOR = 0.5;
/** How much higher the restaurant rate must be than home before it is "clustered". */
export const CLUSTER_LIFT = 1.5;

const HOUR_MS = 3_600_000;

/** The follow-rate for one meal context — transparent counts, never a coefficient. */
export interface ContextReactionRate {
  context: MealContext;
  /** Meals logged with this context (with a valid ingestion time). */
  mealCount: number;
  /** Of those, how many were FOLLOWED by ≥1 non-emergency symptom in-window. */
  followedCount: number;
  /** `followedCount / mealCount` (0 when `mealCount` is 0). */
  followedRate: number;
}

/**
 * The eating-out clustering surfacing (DESIGN §4). Present only when there are
 * enough restaurant meals to say anything; `clustered` gates the strong headline.
 */
export interface ContextClusterSurfacing {
  /** The reaction window used (hours) — shown so it is never hidden. */
  windowHours: number;
  /** Restaurant-context reaction rate (the eating-out signal). */
  eatingOut: ContextReactionRate;
  /** Home-context reaction rate (the routine baseline). */
  home: ContextReactionRate;
  /** Every context with ≥1 meal, for full transparency (restaurant + home + …). */
  byContext: ContextReactionRate[];
  /**
   * `eatingOut.followedRate / home.followedRate` — enrichment over the home
   * baseline. `undefined` when the home baseline is 0 or too thin to compare.
   * NOT a probability; a transparent ratio shown WITH its counts.
   */
  liftOverHome?: number;
  /** True when restaurant reactions materially cluster (rate + lift + min samples). */
  clustered: boolean;
  /** The plain-language summary the UI shows (counts-first). */
  message: string;
  /** The always-attached honesty caveat (DESIGN §4.2). */
  disclaimer: string;
}

interface CountedMeal {
  context: MealContext;
  start: number;
  followed: boolean;
}

/** Was any non-emergency symptom's onset within `(start, start + windowH]`? */
function followedInWindow(
  start: number,
  windowMs: number,
  symptomOnsets: readonly number[],
): boolean {
  const end = start + windowMs;
  for (const onset of symptomOnsets) {
    if (onset > start && onset <= end) return true;
  }
  return false;
}

function rateFor(context: MealContext, meals: readonly CountedMeal[]): ContextReactionRate {
  const inCtx = meals.filter((m) => m.context === context);
  const mealCount = inCtx.length;
  const followedCount = inCtx.filter((m) => m.followed).length;
  return {
    context,
    mealCount,
    followedCount,
    followedRate: mealCount === 0 ? 0 : followedCount / mealCount,
  };
}

/**
 * Compute the eating-out clustering surfacing, or `undefined` when there is not
 * enough restaurant-context data to say anything honest.
 */
export function analyzeContextCluster(
  meals: readonly MealData[],
  symptoms: readonly SymptomData[],
  options: { windowHours?: number; minMealsPerContext?: number } = {},
): ContextClusterSurfacing | undefined {
  const windowHours = options.windowHours ?? CONTEXT_WINDOW_HOURS;
  const minMeals = options.minMealsPerContext ?? MIN_MEALS_PER_CONTEXT;
  const windowMs = windowHours * HOUR_MS;

  // Non-emergency symptom onsets only — emergencies are rail territory, not signal.
  const onsets = symptoms
    .filter((s) => !isEmergencySymptomType(s.symptomType))
    .map((s) => s.onset.getTime())
    .filter((t) => Number.isFinite(t));

  const counted: CountedMeal[] = [];
  for (const meal of meals) {
    if (!meal.context) continue; // unattributable to a setting — excluded
    const start = meal.startTime.getTime();
    if (!Number.isFinite(start)) continue;
    counted.push({ context: meal.context, start, followed: followedInWindow(start, windowMs, onsets) });
  }

  const eatingOut = rateFor("restaurant", counted);
  // Thin-data guard: no eating-out claim until enough restaurant meals exist.
  if (eatingOut.mealCount < minMeals) return undefined;

  const home = rateFor("home", counted);
  const contexts = [...new Set(counted.map((m) => m.context))];
  const byContext = contexts
    .map((c) => rateFor(c, counted))
    .sort((a, b) => b.followedRate - a.followedRate || b.mealCount - a.mealCount);

  const homeComparable = home.mealCount >= minMeals;
  const liftOverHome = homeComparable && home.followedRate > 0
    ? eatingOut.followedRate / home.followedRate
    : undefined;

  const clustered =
    eatingOut.followedRate >= CLUSTER_RATE_FLOOR &&
    homeComparable &&
    // Higher than home either by the lift ratio, or (when home never reacts) by a
    // clear absolute gap so a 0-baseline still counts as clustering.
    (home.followedRate === 0
      ? eatingOut.followedRate >= CLUSTER_RATE_FLOOR
      : eatingOut.followedRate >= home.followedRate * CLUSTER_LIFT);

  const eoFrac = `${eatingOut.followedCount} of your ${eatingOut.mealCount} restaurant meals`;
  const homeFrac = homeComparable
    ? `${home.followedCount} of ${home.mealCount} at home`
    : "not enough home meals to compare yet";

  const message = clustered
    ? `${eoFrac} were followed by a symptom within ${windowHours} hours — noticeably more often ` +
      `than ${homeFrac}. Your reactions cluster on eating out, where cross-contamination and ` +
      "hidden ingredients are common. This is a pattern in your data, not proof."
    : `${eoFrac} were followed by a symptom within ${windowHours} hours` +
      (homeComparable ? ` (${homeFrac})` : "") +
      ". No strong eating-out pattern stands out yet — keep logging where you eat.";

  return {
    windowHours,
    eatingOut,
    home,
    byContext,
    liftOverHome,
    clustered,
    message,
    disclaimer: PATTERN_NOT_DIAGNOSIS,
  };
}
