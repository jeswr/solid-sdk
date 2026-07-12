// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Lag-window resolution — the single most load-bearing fact in the product
 * (DESIGN §4.1, RESEARCH §2.1): symptom onset lags ingestion by a
 * TRIGGER-SPECIFIC interval, so a naive same-meal correlation systematically
 * mis-attributes. This module resolves each trigger's `[lagWindowMin, lagWindowMax]`
 * (hours) from the supplied per-user trigger classes, falling back to the model's
 * **evidence priors** — it NEVER hard-codes a lag window (the priors live in
 * `@jeswr/solid-health-diary`, gluten wide right-skewed 0–72 h, lactose/sulphite
 * tight 0.5–6 h, …).
 */

import {
  EVIDENCE_PRIOR_LAG,
  isValidLagProfile,
  type LagProfile,
  type TriggerClassData,
  type TriggerSlug,
} from "@jeswr/solid-health-diary";

/** Milliseconds in one hour. */
export const HOUR_MS = 3_600_000;

/** A resolved lag window for a trigger (hours), always finite/ordered/non-negative. */
export interface ResolvedLag {
  trigger: TriggerSlug;
  lagWindowMin: number;
  lagWindowMax: number;
  lagMode: number;
}

/**
 * Resolve a trigger's lag profile: prefer a supplied per-user {@link TriggerClassData}
 * (only if it is a VALID profile — finite, non-negative, ordered), else the model's
 * evidence prior. This mirrors the package's own fail-closed discipline
 * (`parseTriggerClass` falls back to the prior on a broken profile), so a hostile or
 * garbled per-user profile can never corrupt lag attribution.
 */
export function resolveLag(
  trigger: TriggerSlug,
  triggerClasses?: readonly TriggerClassData[],
): ResolvedLag {
  const supplied = triggerClasses?.find((t) => t.slug === trigger);
  const prior = EVIDENCE_PRIOR_LAG[trigger];
  const profile: LagProfile =
    supplied && isValidLagProfile(supplied)
      ? { lagWindowMin: supplied.lagWindowMin, lagWindowMax: supplied.lagWindowMax, lagMode: supplied.lagMode }
      : prior;
  return { trigger, ...profile };
}

/**
 * Build a lookup of resolved lags for every trigger the caller cares about (defaults
 * to every known evidence-prior trigger). One resolution per trigger, memoised in a
 * Map for the correlation pass.
 */
export function resolveAllLags(
  triggerClasses?: readonly TriggerClassData[],
  triggers: readonly TriggerSlug[] = Object.keys(EVIDENCE_PRIOR_LAG) as TriggerSlug[],
): Map<TriggerSlug, ResolvedLag> {
  const map = new Map<TriggerSlug, ResolvedLag>();
  for (const t of triggers) map.set(t, resolveLag(t, triggerClasses));
  return map;
}

/**
 * Whether a symptom at `onset` falls within the lag window that would follow an
 * ingestion at `ingestedAt`, i.e. `onset ∈ [ingestedAt + lagMin, ingestedAt + lagMax]`.
 * Boundary-inclusive on both ends (a symptom exactly at the window edge counts).
 */
export function onsetWithinLag(ingestedAt: Date, onset: Date, lag: ResolvedLag): boolean {
  const delta = onset.getTime() - ingestedAt.getTime();
  const min = lag.lagWindowMin * HOUR_MS;
  const max = lag.lagWindowMax * HOUR_MS;
  return delta >= min && delta <= max;
}

/** The lag between an ingestion and a later onset, in hours (may be negative). */
export function lagHours(ingestedAt: Date, onset: Date): number {
  return (onset.getTime() - ingestedAt.getTime()) / HOUR_MS;
}
