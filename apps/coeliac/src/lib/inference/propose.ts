// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Elimination-diet proposal generation (DESIGN §4.3). From the suspicion ranking,
 * propose the highest-value next step — always as a *proposal* the user confirms,
 * never autopilot. The decision order encodes the design's safety pillars:
 *
 * 1. **One variable at a time.** If ANY protocol is still in progress (any phase that
 *    is not `concluded` — INCLUDING `baseline`, which is already committed to testing
 *    one trigger and establishing its pre-elimination baseline), suppress every new
 *    proposal and return `wait-active-challenge`. Running a second protocol alongside
 *    one that is even just in baseline muddies attribution; the model's
 *    one-active-challenge invariant is the stricter `reintroduce`/`observe` subset.
 * 2. **Bias toward EXPANSION** (orthorexia guard, RESEARCH §2.8). A due time-boxed
 *    exclusion is offered for RE-CHALLENGE *before* any new elimination — the app
 *    grows the safe-food set where evidence allows, not shrink it.
 * 3. **Pre-diagnosis gluten HARD BLOCK** (RESEARCH §4). Gluten elimination is never
 *    proposed before a coeliac diagnosis — going gluten-free first invalidates the
 *    tests. The candidate is skipped and "get tested first" surfaced instead.
 * 4. Otherwise, propose eliminating the top remaining suspect (skipping triggers
 *    already `confirmed`). No qualifying suspect ⇒ `none` (never a fabricated
 *    proposal from thin data).
 */

import {
  countActiveChallenges,
  type ProtocolData,
  type ToleranceConclusionData,
  type TriggerSlug,
} from "@jeswr/solid-health-diary";
import { correlate, type CorrelateOptions } from "./correlate";
import { rankedSuspects } from "./rank";
import { surfaceReviews } from "./review";
import type {
  DiaryData,
  EliminationProposal,
  PhaseSchedule,
  SafetyContext,
  SuspicionScore,
} from "./types";

/**
 * Default phase schedule for a PROPOSED protocol (RESEARCH §2.4; user-adjustable).
 * Durations only — dose-step dates are computed by the reintroduction scheduler once
 * the protocol actually reaches the reintroduce phase.
 */
export const DEFAULT_PHASE_SCHEDULE: PhaseSchedule = {
  baselineDays: 5, // 3–7 d
  eliminateDays: 14, // 2–6 wk (FODMAP-style); start at 2 wk
  washoutDays: 3, // ≥3 d
};

/** Options for {@link proposeNext}. */
export interface ProposeOptions extends CorrelateOptions {
  /** "Now", used to decide which reviews are due. */
  now?: Date;
}

/**
 * Generate the single best next proposal from the diary snapshot + safety context.
 * Pure: runs the correlation internally and returns exactly one {@link EliminationProposal}.
 */
export function proposeNext(
  diary: DiaryData,
  context: SafetyContext = {},
  options: ProposeOptions = {},
): EliminationProposal {
  const now = options.now ?? new Date();
  const protocols = diary.protocols ?? [];
  const conclusions = diary.conclusions ?? [];

  // 1. One-variable-at-a-time: any in-progress protocol suppresses new proposals.
  const inProgress = protocols.find((p) => p.phase !== "concluded");
  if (inProgress) {
    const active = countActiveChallenges(protocols) >= 1;
    return {
      kind: "wait-active-challenge",
      trigger: inProgress.targetTrigger,
      relatedResource: inProgress.id,
      rationale: active
        ? `A challenge for ${inProgress.targetTrigger} is already underway. Finish it before ` +
          "starting another — testing one trigger at a time is the only way to know which " +
          "one is responsible."
        : `A test for ${inProgress.targetTrigger} is already in progress (currently in its ` +
          `${inProgress.phase} phase). Let it run its course before testing another trigger — ` +
          "one variable at a time.",
    };
  }

  // 2. Expansion bias: offer a due re-challenge before any new elimination.
  const dueReviews = surfaceReviews(conclusions, now);
  if (dueReviews.length > 0) {
    const top = dueReviews[0]!;
    return {
      kind: "re-challenge",
      trigger: top.trigger,
      relatedResource: top.conclusionId,
      rationale:
        `Before testing anything new, it's worth re-checking ${top.trigger}: sensitivities ` +
        "like this often ease over time, and re-testing could let you add it back to your diet.",
    };
  }

  // 3 + 4. Highest suspect, honouring the pre-diagnosis gluten block + skipping any
  // trigger already SETTLED by a completed test (not an inconclusive one — that may
  // still be worth re-testing).
  const settled = settledTriggers(conclusions);
  const candidates = rankedSuspects(runCorrelation(diary, options)).filter(
    (s) => !settled.has(s.trigger),
  );

  let glutenBlocked = false;
  for (const suspect of candidates) {
    if (suspect.trigger === "gluten" && context.coeliacDiagnosed !== true) {
      glutenBlocked = true; // never propose gluten elimination pre-diagnosis.
      continue;
    }
    return eliminateProposal(suspect);
  }

  if (glutenBlocked) {
    return {
      kind: "none",
      trigger: "gluten",
      rationale:
        "Your data points at gluten, but don't cut it out yet — coeliac disease must be " +
        "diagnosed by a blood test and biopsy taken WHILE you're still eating gluten. Please " +
        "get tested first; going gluten-free now can make those tests falsely negative.",
    };
  }

  return {
    kind: "none",
    rationale:
      "Not enough of a pattern yet to suggest a trigger to test. Keep logging meals and " +
      "symptoms — a suggestion appears once a clearer signal emerges.",
  };
}

// --- helpers -----------------------------------------------------------------

function runCorrelation(diary: DiaryData, options: CorrelateOptions): SuspicionScore[] {
  return correlate(diary.meals, diary.symptoms, {
    triggerClasses: options.triggerClasses ?? diary.triggerClasses,
    thresholds: options.thresholds,
    triggers: options.triggers,
  });
}

function eliminateProposal(suspect: SuspicionScore): EliminationProposal {
  return {
    kind: "eliminate",
    trigger: suspect.trigger,
    basedOn: suspect,
    suggestedSchedule: { ...DEFAULT_PHASE_SCHEDULE },
    rationale:
      `${suspect.trigger} is your strongest pattern so far: symptoms followed ` +
      `${suspect.followedCount} of ${suspect.exposureCount} exposures within ` +
      `${suspect.lagWindowMin}–${suspect.lagWindowMax} h. ${suspect.disclaimer} ` +
      "A supervised elimination-and-reintroduction is how you'd confirm it.",
  };
}

/**
 * Triggers already SETTLED by a completed protocol — a confirmed conclusion with a
 * verdict that actually resolves the trigger (`tolerated`/`reacts`/`dose-dependent`).
 * A confirmed but `inconclusive` protocol does NOT settle it, so its trigger stays
 * eligible for a fresh proposal (re-testing after an inconclusive challenge).
 */
function settledTriggers(conclusions: readonly ToleranceConclusionData[]): Set<TriggerSlug> {
  const set = new Set<TriggerSlug>();
  for (const c of conclusions) {
    if (c.confidence === "confirmed" && c.verdict !== "inconclusive") set.add(c.aboutTrigger);
  }
  return set;
}

/** Exposed for callers that already have protocols but want the in-progress guard. */
export function hasInProgressProtocol(protocols: readonly ProtocolData[]): boolean {
  return protocols.some((p) => p.phase !== "concluded");
}
