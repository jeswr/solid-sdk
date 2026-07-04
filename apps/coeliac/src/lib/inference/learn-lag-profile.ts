// AUTHORED-BY Claude Sonnet 5
/**
 * Locally-learned per-trigger lag-window refinement (Insights richer-UI follow-up,
 * suite-tracker-ov8g deliverable 5) — closes a gap the model package's own docs
 * call out (`@jeswr/solid-health-diary` `trigger.ts`: the evidence-prior lag
 * windows "become learnable per-user later"). `resolveLag` (`./lag`) has always
 * preferred a supplied {@link TriggerClassData} over the evidence prior — nothing
 * in this app ever supplied one, so every run used the prior. This module derives
 * that per-user profile FROM THE ENGINE'S OWN OUTPUT (`SuspicionScore.evidence`),
 * so learning it introduces no new I/O, no network call, and no additional data
 * collection — it is a pure re-reading of pairings the engine already computed.
 *
 * DELIBERATELY CONSERVATIVE — this feeds every FUTURE correlation run (via the
 * cache round-trip in `from-cache.ts` + `useInsights`), so an under-supported
 * learn would silently degrade lag attribution for a health-data product:
 *
 *  - Only a trigger whose CURRENT-RUN suspicion reaches the correlation engine's
 *    strongest reachable tier (`confidence === "likely"`) is eligible — the same
 *    floor the engine itself requires before calling a signal `likely`
 *    ({@link import("./types").DEFAULT_THRESHOLDS}), which already implies
 *    `!confounded`; checked again here explicitly for defense-in-depth.
 *  - At least {@link MIN_SAMPLE_SIZE} distinct symptom-lag observations
 *    (`evidence[].symptoms[].lagHours`) are required — a "likely" suspicion can
 *    still rest on very few pairings, and a lag window learned from 1–2 points is
 *    noise, not a profile.
 *  - The observed `[min, max]` window and the MEDIAN lag (assigned to `lagMode` —
 *    the model calls this field the "modal"/most-likely lag; median is the
 *    honest, outlier-robust stand-in a small sample supports) must pass
 *    `isValidLagProfile` before being returned; a degenerate result (should not
 *    happen given a min/max/median are inherently ordered, but checked anyway —
 *    fail-closed) is dropped, never persisted.
 *
 * Pure; no I/O. The caller (`useInsights`) persists eligible results to the cache
 * (`DiaryStore.putTriggerClass`) and `from-cache.ts` feeds them back into the next
 * run's `DiaryData.triggerClasses`.
 */

import { isValidLagProfile, type TriggerClassData } from "@jeswr/solid-health-diary";
import type { SuspicionScore } from "./types";

/** Minimum distinct lag observations before a per-user profile is trusted. */
export const MIN_SAMPLE_SIZE = 5;

/** One learned trigger class + how many observations it rests on (never hidden). */
export interface LearnedTriggerClass {
  data: TriggerClassData;
  /** Distinct symptom-lag observations the profile rests on (transparency). */
  sampleSize: number;
}

/** The median of a non-empty numeric array. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Derive locally-learned lag profiles from a completed analysis's suspicions.
 * Returns one entry per ELIGIBLE trigger (see module docs for the eligibility
 * bar) — most diaries, especially early on, will return an empty array, which is
 * correct: the model's evidence priors keep being used until there is enough of
 * the user's OWN data to responsibly refine them.
 */
export function learnTriggerClasses(
  suspicions: readonly SuspicionScore[],
): LearnedTriggerClass[] {
  const out: LearnedTriggerClass[] = [];
  for (const s of suspicions) {
    if (s.confidence !== "likely") continue; // the engine's strongest correlation tier only.
    if (s.confounded) continue; // shared signal — not cleanly attributable to this trigger.
    const observedLagHours = s.evidence.flatMap((pairing) =>
      pairing.symptoms.map((sym) => sym.lagHours),
    );
    if (observedLagHours.length < MIN_SAMPLE_SIZE) continue;
    const profile = {
      lagWindowMin: Math.min(...observedLagHours),
      lagWindowMax: Math.max(...observedLagHours),
      lagMode: median(observedLagHours),
    };
    if (!isValidLagProfile(profile)) continue; // fail-closed: never persist a degenerate profile.
    out.push({
      data: { slug: s.trigger, ...profile },
      sampleSize: observedLagHours.length,
    });
  }
  return out;
}
