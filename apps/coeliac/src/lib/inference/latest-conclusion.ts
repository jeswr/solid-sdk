// AUTHORED-BY Claude Fable 5
/**
 * Collapse a list of records to the LATEST one per trigger — the health-safety fix
 * for stale medical guidance (roborev Medium on Phase-4B). A pod's diary can hold
 * several conclusions for the same trigger over time (one per protocol run, or a
 * re-sync duplicate). Deriving the DietPlan / re-challenge prompts from ALL of them
 * lets an OLDER `reacts` keep a food on the avoid-list (or surface a re-test prompt)
 * even after a NEWER `tolerated` conclusion for the same trigger — i.e. the app would
 * show guidance the user's own later test has already overturned. It also made the
 * old per-trigger overwrite input-ORDER-dependent (a later iteration clobbered an
 * earlier one regardless of recency), so shuffled input could pick a stale review
 * date/note.
 *
 * This helper is the single, deterministic source of "the current conclusion per
 * trigger": keep, for each trigger, the record with the greatest `created` time; on
 * an exact timestamp tie (indistinguishable recency), keep the one with the
 * lexicographically GREATER stable id — a fixed, documented rule so the result is
 * fully input-order-independent. A record with no/unparseable `created` time is
 * treated as the OLDEST possible (any dated record supersedes it).
 *
 * Pure; no I/O. Callers pre-filter (e.g. to `confirmed`) as needed BEFORE collapsing.
 */

import type { TriggerSlug } from "@jeswr/solid-health-diary";

/** Accessors so the collapse works over either the cache or the model record shape. */
export interface LatestAccessors<T> {
  /** The trigger this record concludes about (the grouping key). */
  triggerOf: (item: T) => TriggerSlug;
  /** Recency in epoch-ms; return `NaN` when there is no usable timestamp (→ oldest). */
  createdMsOf: (item: T) => number;
  /** A STABLE id used only as the deterministic tie-break on equal timestamps. */
  idOf: (item: T) => string;
}

/**
 * The latest record per trigger, as a `Map`. Deterministic: greatest `created`, then
 * (on a tie) the lexicographically greater `id`. Input-order-independent.
 */
export function latestByTrigger<T>(
  items: readonly T[],
  accessors: LatestAccessors<T>,
): Map<TriggerSlug, T> {
  const { triggerOf, createdMsOf, idOf } = accessors;
  const best = new Map<TriggerSlug, T>();
  for (const item of items) {
    const trigger = triggerOf(item);
    const current = best.get(trigger);
    if (current === undefined || isNewer(item, current, createdMsOf, idOf)) {
      best.set(trigger, item);
    }
  }
  return best;
}

/** The latest record per trigger, as an array (order unspecified — sort at the caller). */
export function latestByTriggerList<T>(
  items: readonly T[],
  accessors: LatestAccessors<T>,
): T[] {
  return [...latestByTrigger(items, accessors).values()];
}

/** Normalise a possibly-`NaN` recency to a comparable number (`NaN` → −∞ = oldest). */
function recency(ms: number): number {
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Is `candidate` strictly newer than `incumbent` under the documented ordering? */
function isNewer<T>(
  candidate: T,
  incumbent: T,
  createdMsOf: (item: T) => number,
  idOf: (item: T) => string,
): boolean {
  const a = recency(createdMsOf(candidate));
  const b = recency(createdMsOf(incumbent));
  if (a !== b) return a > b;
  // Exact timestamp tie → deterministic tie-break on the stable id (greater wins).
  return idOf(candidate) > idOf(incumbent);
}
