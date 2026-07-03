// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The lag-aware, interpretable exposure↔symptom correlation core (DESIGN §4.1).
 *
 * ## The scoring scheme (documented — DESIGN leaves latitude; this is the chosen
 * transparent, parameter-free scheme)
 *
 * For each trigger class `c` with its OWN resolved lag window `[lagMin, lagMax]`
 * (hours — gluten wide/right-skew ~0–72 h, lactose/sulphite tight ~0.5–6 h):
 *
 * 1. **Exposure events.** Every meal carrying a non-`absent` `diet:Exposure` to `c`
 *    is one exposure event, anchored at the meal's ingestion time.
 * 2. **Follow test.** Each QUALIFYING (non-emergency) symptom is assigned to AT MOST
 *    ONE exposure — the nearest preceding in-window one — and an exposure is
 *    *followed* iff a symptom was assigned to it. This one-symptom-one-cause matching
 *    stops a single symptom from crediting several overlapping exposures (which would
 *    inflate the rate under gluten's wide 72 h window). Emergency symptoms are
 *    excluded from correlation entirely (DESIGN §4.4).
 * 3. **Forward conditional rate** (the headline, parameter-free statistic):
 *    `followedRate = followedCount / exposureCount` — "symptoms followed 7 of your
 *    9 gluten exposures within 0–72 h".
 * 4. **Honest baseline (`expectedRate`).** The chance a single lag window of width
 *    `W = lagMax − lagMin` catches ≥1 symptom if the user's symptoms were scattered
 *    uniformly over the observation span `T`: `1 − (1 − min(W/T,1))^nSymptoms`. No
 *    free parameter (both `W` and `T` come from the data), so it is reproducible.
 * 5. **Lift** `= followedRate / expectedRate` — enrichment over coincidence. Shown
 *    WITH its counts, never as a probability, never alone.
 * 6. **Confounder-diluted attribution.** A symptom whose candidate window contains
 *    exposures to N different triggers contributes only `1/N` to each trigger's
 *    `attributedWeight` (equal split). `confoundedFraction = 1 − weight/rawCount`
 *    measures how much of the apparent signal is shared — overlapping exposures
 *    dilute attribution rather than yield false certainty (DESIGN §4.1). A trigger
 *    that always co-occurs with another is flagged `confounded` + names the
 *    confounders; such a signal can never reach `likely` (needs an elimination test
 *    to separate — exactly what a protocol does).
 *
 * The ordinal `confidence` is driven by the raw COUNTS (so sparse data stays
 * `emerging`), never by the lift magnitude alone — and can NEVER be `confirmed`
 * (that is reachable only from a completed protocol; see `./conclude`). Every score
 * carries its tap-through evidence and the "pattern, not a diagnosis" caveat.
 *
 * Pure functions over parsed model data; no I/O.
 */

import {
  EVIDENCE_PRIOR_LAG,
  type ExposureLevel,
  type MealData,
  type SymptomData,
  type TriggerClassData,
  type TriggerSlug,
} from "@jeswr/solid-health-diary";
import { lagHours, onsetWithinLag, resolveAllLags, type ResolvedLag } from "./lag";
import { partitionEmergencySymptoms } from "./safety";
import {
  DEFAULT_THRESHOLDS,
  type EngineThresholds,
  type EvidencePairing,
  type EvidenceSymptom,
  PATTERN_NOT_DIAGNOSIS,
  type SuspicionConfidence,
  type SuspicionScore,
} from "./types";

/** A single non-`absent` exposure to a trigger, anchored at its meal's ingestion time. */
interface ExposureEvent {
  mealId: string | undefined;
  ingestedAt: Date;
  trigger: TriggerSlug;
  level: Exclude<ExposureLevel, "absent">;
  derivedFrom: string[];
}

/** Options for {@link correlate}. */
export interface CorrelateOptions {
  triggerClasses?: readonly TriggerClassData[];
  thresholds?: EngineThresholds;
  /** Restrict scoring to these triggers (defaults to every evidence-prior trigger). */
  triggers?: readonly TriggerSlug[];
}

/**
 * For each qualifying symptom (keyed by IDENTITY, not IRI — two records could share
 * or omit an id), the triggers whose per-trigger lookback window contains it. The
 * shared basis for both attribution and confounder detection.
 */
type SymptomAnnotations = Map<SymptomData, Set<TriggerSlug>>;

/**
 * Correlate exposures against symptoms for every requested trigger, returning one
 * {@link SuspicionScore} per trigger that has ≥1 exposure event. Triggers with no
 * exposure at all are omitted (no data → no fabricated score). The result is NOT
 * sorted — see {@link import("./rank").rankSuspicions}.
 */
export function correlate(
  meals: readonly MealData[],
  symptoms: readonly SymptomData[],
  options: CorrelateOptions = {},
): SuspicionScore[] {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const triggers = options.triggers ?? (Object.keys(EVIDENCE_PRIOR_LAG) as TriggerSlug[]);
  const lags = resolveAllLags(options.triggerClasses, triggers);

  // Emergency symptoms are NEVER correlation fodder (DESIGN §4.4) — split them out
  // up front so no downstream step can pair one with an exposure.
  const { qualifying } = partitionEmergencySymptoms(symptoms);

  const eventsByTrigger = collectExposureEvents(meals, triggers);

  // Observation span across ALL meals + qualifying symptoms (for the null baseline).
  const span = observationSpanHours(meals, qualifying);

  // Annotate each qualifying symptom with which triggers' windows contain it — the
  // shared basis for both attribution and confounder detection (per-trigger lag).
  const annotated = annotateSymptoms(qualifying, eventsByTrigger, lags);

  const scores: SuspicionScore[] = [];
  for (const trigger of triggers) {
    const events = eventsByTrigger.get(trigger) ?? [];
    if (events.length === 0) continue; // no data → no score.
    const lag = lags.get(trigger);
    if (!lag) continue;
    scores.push(scoreTrigger(trigger, events, qualifying, annotated, lag, span, thresholds));
  }
  return scores;
}

// --- exposure-event extraction -----------------------------------------------

/** Level strength, strongest first — for collapsing multiple records to one event. */
const LEVEL_RANK: Record<Exclude<ExposureLevel, "absent">, number> = {
  present: 0,
  trace: 1,
  "possible-undeclared": 2,
};

function collectExposureEvents(
  meals: readonly MealData[],
  triggers: readonly TriggerSlug[],
): Map<TriggerSlug, ExposureEvent[]> {
  const wanted = new Set<TriggerSlug>(triggers);
  const byTrigger = new Map<TriggerSlug, ExposureEvent[]>();
  for (const meal of meals) {
    // ONE exposure event per (meal, trigger) — the documented scheme. A meal may
    // carry several Exposure records for the same trigger (e.g. an additive-derived
    // `present` AND a category-derived `possible-undeclared`); collapse them into a
    // single event, keeping the STRONGEST level and MERGING the `derivedFrom` sets,
    // so counts / evidence / ranking are never inflated by duplicate records.
    const perTrigger = new Map<TriggerSlug, { level: Exclude<ExposureLevel, "absent">; derivedFrom: Set<string> }>();
    for (const exp of meal.exposures ?? []) {
      if (exp.exposureLevel === "absent") continue; // never emitted, but be defensive.
      if (!wanted.has(exp.trigger)) continue;
      const level = exp.exposureLevel;
      const existing = perTrigger.get(exp.trigger);
      if (!existing) {
        perTrigger.set(exp.trigger, { level, derivedFrom: new Set(exp.derivedFrom ?? []) });
      } else {
        if (LEVEL_RANK[level] < LEVEL_RANK[existing.level]) existing.level = level;
        for (const d of exp.derivedFrom ?? []) existing.derivedFrom.add(d);
      }
    }
    for (const [trigger, agg] of perTrigger) {
      const list = byTrigger.get(trigger) ?? [];
      list.push({
        mealId: meal.id,
        ingestedAt: meal.startTime,
        trigger,
        level: agg.level,
        derivedFrom: [...agg.derivedFrom],
      });
      byTrigger.set(trigger, list);
    }
  }
  return byTrigger;
}

// --- symptom annotation (attribution + confounder basis) ---------------------

function annotateSymptoms(
  qualifying: readonly SymptomData[],
  eventsByTrigger: Map<TriggerSlug, ExposureEvent[]>,
  lags: Map<TriggerSlug, ResolvedLag>,
): SymptomAnnotations {
  const map: SymptomAnnotations = new Map();
  for (const symptom of qualifying) {
    const triggersInWindow = new Set<TriggerSlug>();
    for (const [trigger, events] of eventsByTrigger) {
      const lag = lags.get(trigger);
      if (!lag) continue;
      if (events.some((e) => onsetWithinLag(e.ingestedAt, symptom.onset, lag))) {
        triggersInWindow.add(trigger);
      }
    }
    map.set(symptom, triggersInWindow);
  }
  return map;
}

// --- per-trigger scoring ------------------------------------------------------

function scoreTrigger(
  trigger: TriggerSlug,
  events: readonly ExposureEvent[],
  qualifying: readonly SymptomData[],
  annotated: SymptomAnnotations,
  lag: ResolvedLag,
  spanHours: number,
  thresholds: EngineThresholds,
): SuspicionScore {
  // Forward direction. Assign each qualifying symptom to AT MOST ONE exposure — the
  // nearest PRECEDING in-window exposure (largest ingestion time ≤ onset, still inside
  // the lag window). Without this, a single symptom would mark every overlapping
  // exposure as "followed" (acute for gluten's 72 h window: three exposures an hour
  // apart + one symptom would read as 3/3 followed), inflating `followedRate`,
  // confidence and the ranking. The nearest preceding exposure is the most plausible
  // cause, so `followedCount ≤ #qualifying symptoms`.
  const assigned = new Map<ExposureEvent, SymptomData[]>();
  for (const s of qualifying) {
    let best: ExposureEvent | undefined;
    for (const e of events) {
      if (!onsetWithinLag(e.ingestedAt, s.onset, lag)) continue;
      if (!best || e.ingestedAt.getTime() > best.ingestedAt.getTime()) best = e;
    }
    if (!best) continue;
    const list = assigned.get(best);
    if (list) list.push(s);
    else assigned.set(best, [s]);
  }

  const evidence: EvidencePairing[] = [];
  let followedCount = 0;
  for (const e of events) {
    const pairedSymptoms = assigned.get(e);
    if (!pairedSymptoms || pairedSymptoms.length === 0) continue;
    followedCount += 1;
    const coPresent = new Set<TriggerSlug>();
    for (const s of pairedSymptoms) {
      for (const t of annotated.get(s) ?? []) if (t !== trigger) coPresent.add(t);
    }
    evidence.push({
      mealId: e.mealId,
      ingestedAt: e.ingestedAt,
      exposureLevel: e.level,
      derivedFrom: e.derivedFrom,
      symptoms: pairedSymptoms.map((s) => toEvidenceSymptom(s, e.ingestedAt)),
      coPresentTriggers: [...coPresent].sort(),
    });
  }
  const exposureCount = events.length;
  const followedRate = exposureCount > 0 ? followedCount / exposureCount : 0;

  // Reverse direction: attribution + confounding over the annotated symptoms.
  let attributedSymptomCount = 0;
  let attributedWeight = 0;
  const coOccurCounts = new Map<TriggerSlug, number>();
  for (const s of qualifying) {
    const triggersInWindow = annotated.get(s);
    if (!triggersInWindow || !triggersInWindow.has(trigger)) continue;
    attributedSymptomCount += 1;
    const n = triggersInWindow.size; // ≥1 (contains `trigger`).
    attributedWeight += 1 / n;
    for (const other of triggersInWindow) {
      if (other === trigger) continue;
      coOccurCounts.set(other, (coOccurCounts.get(other) ?? 0) + 1);
    }
  }
  const confoundedFraction =
    attributedSymptomCount > 0 ? 1 - attributedWeight / attributedSymptomCount : 0;
  const confounders = [...coOccurCounts.entries()]
    .filter(([, n]) => n / Math.max(attributedSymptomCount, 1) >= thresholds.confounderCoOccurrence)
    .map(([t]) => t)
    .sort();
  const confounded =
    confoundedFraction >= thresholds.confoundedFractionFlag || confounders.length > 0;

  // Honest baseline + lift (parameter-free null model).
  const { expectedRate, lift } = baselineAndLift(lag, spanHours, qualifying.length, followedRate);

  const confidence = classifyConfidence({
    exposureCount,
    followedCount,
    followedRate,
    lift,
    confounded,
    thresholds,
  });

  const enrich = lift ?? (followedRate > 0 ? followedRate : 0);
  const rankScore = attributedWeight * Math.max(enrich, 0);

  return {
    trigger,
    lagWindowMin: lag.lagWindowMin,
    lagWindowMax: lag.lagWindowMax,
    exposureCount,
    followedCount,
    followedRate,
    expectedRate,
    lift,
    attributedSymptomCount,
    attributedWeight,
    confoundedFraction,
    confounded,
    confounders,
    confidence,
    rankScore,
    evidence,
    disclaimer: PATTERN_NOT_DIAGNOSIS,
  };
}

function baselineAndLift(
  lag: ResolvedLag,
  spanHours: number,
  nSymptoms: number,
  followedRate: number,
): { expectedRate: number; lift: number | undefined } {
  const windowWidth = lag.lagWindowMax - lag.lagWindowMin;
  if (spanHours <= 0 || nSymptoms <= 0 || windowWidth <= 0) {
    return { expectedRate: 0, lift: undefined };
  }
  const perWindowMissProb = 1 - Math.min(windowWidth / spanHours, 1);
  const expectedRate = 1 - perWindowMissProb ** nSymptoms;
  const lift = expectedRate > 0 ? followedRate / expectedRate : undefined;
  return { expectedRate, lift };
}

function classifyConfidence(input: {
  exposureCount: number;
  followedCount: number;
  followedRate: number;
  lift: number | undefined;
  confounded: boolean;
  thresholds: EngineThresholds;
}): SuspicionConfidence {
  const { exposureCount, followedCount, followedRate, lift, confounded, thresholds } = input;
  const t = thresholds;
  const canLikely =
    exposureCount >= t.minEventsForLikely &&
    followedRate >= t.rateForLikely &&
    lift !== undefined &&
    lift >= t.liftForLikely &&
    !confounded;
  if (canLikely) return "likely";
  const canSuspected =
    exposureCount >= t.minEventsForSuspected && followedRate >= t.rateForSuspected && followedCount >= 2;
  if (canSuspected) return "suspected";
  return "emerging";
}

// --- helpers -----------------------------------------------------------------

function toEvidenceSymptom(s: SymptomData, ingestedAt: Date): EvidenceSymptom {
  return {
    symptomId: s.id,
    symptomType: s.symptomType,
    onset: s.onset,
    severity: s.severity,
    lagHours: lagHours(ingestedAt, s.onset),
  };
}

/** Span (hours) between the earliest and latest of all meals + qualifying symptoms. */
function observationSpanHours(
  meals: readonly MealData[],
  qualifying: readonly SymptomData[],
): number {
  let min = Infinity;
  let max = -Infinity;
  const consider = (t: number) => {
    if (t < min) min = t;
    if (t > max) max = t;
  };
  for (const m of meals) consider(m.startTime.getTime());
  for (const s of qualifying) consider(s.onset.getTime());
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return (max - min) / 3_600_000;
}
