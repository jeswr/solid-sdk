// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Top-level orchestrator (DESIGN §4) — one pure call over a diary snapshot that
 * returns everything a surface needs, in the right precedence:
 *
 * - **Safety rails first** (DESIGN §4.4): emergency / alarm / persistence /
 *   restriction-anxiety / pre-diagnosis-gluten. These are rules, non-correlated,
 *   and a surface renders them ABOVE any inference.
 * - **Ranked suspicions** — lag-aware, interpretable, evidence-carrying, and never
 *   `confirmed` (that needs a protocol).
 * - **One proposal** — the highest-value next step (expansion-biased, one-at-a-time,
 *   pre-diagnosis-gluten-blocked).
 * - **Due reviews** — time-boxed exclusions ready to re-challenge.
 * - **Reintroduction schedule** for the single active challenge, if any.
 */

import { countActiveChallenges, isActiveChallengePhase } from "@jeswr/solid-health-diary";
import { correlate } from "./correlate";
import { rankSuspicions } from "./rank";
import { scheduleReintroduction } from "./reintroduction";
import { surfaceReviews } from "./review";
import { evaluateSafetyRails, preDiagnosisGlutenBlock } from "./safety";
import { proposeNext, type ProposeOptions } from "./propose";
import type {
  DiaryData,
  EliminationProposal,
  ReintroductionSchedule,
  ReviewSurfacing,
  SafetyContext,
  SafetyRail,
  SafetyRailSeverity,
  SuspicionScore,
} from "./types";

/** Severity ordering for the strongest-first safety-rail contract. */
const SEVERITY_RANK: Record<SafetyRailSeverity, number> = { emergency: 0, urgent: 1, advisory: 2 };

/** Everything the engine derives from a diary snapshot. */
export interface AnalysisResult {
  /** Hard safety rails, strongest-first (DESIGN §4.4) — rendered above inference. */
  safetyRails: SafetyRail[];
  /** Ranked, evidence-carrying suspicions (never `confirmed`). */
  suspicions: SuspicionScore[];
  /** The single best next step (proposal, never autopilot). */
  proposal: EliminationProposal;
  /** Time-boxed exclusions due for re-challenge (expansion bias). */
  reviews: ReviewSurfacing[];
  /** Reintroduction schedule for the one active challenge, if a protocol is in one. */
  reintroductionSchedule?: ReintroductionSchedule;
}

/** Run the full analysis over a diary snapshot. Pure; no I/O. */
export function analyze(
  diary: DiaryData,
  context: SafetyContext = {},
  options: ProposeOptions = {},
): AnalysisResult {
  const now = options.now ?? new Date();
  const triggerClasses = options.triggerClasses ?? diary.triggerClasses;
  const protocols = diary.protocols ?? [];
  const conclusions = diary.conclusions ?? [];

  const safetyRails = evaluateSafetyRails({
    symptoms: diary.symptoms,
    protocols,
    conclusions,
    plan: diary.plan,
    context,
    thresholds: options.thresholds,
  });

  const suspicions = rankSuspicions(
    correlate(diary.meals, diary.symptoms, {
      triggerClasses,
      thresholds: options.thresholds,
      triggers: options.triggers,
    }),
  );

  const proposal = proposeNext(diary, context, { ...options, now, triggerClasses });
  const reviews = surfaceReviews(conclusions, now);

  // The pre-diagnosis gluten block is surfaced as a rail too — but ONLY when gluten is
  // actually relevant to THIS diary (a gluten exposure has produced a suspicion, or the
  // proposal concerns gluten). Surfacing an urgent gluten warning on a diary with no
  // gluten in play would be noise. Then re-sort strongest-first (its `urgent` severity
  // must never sit below an `advisory` rail — Array.prototype.sort is stable, so
  // equal-severity order is preserved).
  const glutenRelevant =
    suspicions.some((s) => s.trigger === "gluten") || proposal.trigger === "gluten";
  const glutenBlock = glutenRelevant ? preDiagnosisGlutenBlock(context) : undefined;
  if (glutenBlock) safetyRails.push(glutenBlock);
  safetyRails.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const result: AnalysisResult = { safetyRails, suspicions, proposal, reviews };

  // Reintroduction schedule for the ONE active challenge (one-active-challenge rule).
  if (countActiveChallenges(protocols) >= 1) {
    const active = protocols.find((p) => isActiveChallengePhase(p.phase));
    if (active) {
      result.reintroductionSchedule = scheduleReintroduction(active, { now, triggerClasses });
    }
  }

  return result;
}
