// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Time-boxed conclusion re-challenge surfacing (DESIGN §4.3, RESEARCH §2.2). The
 * engine is biased toward EXPANSION (orthorexia guard): when a secondary-intolerance
 * conclusion passes its `diet:reviewAfter` date, proactively surface a re-challenge
 * so the avoid-list can shrink as the gut heals — the app's job is to grow the
 * safe-food set where evidence allows, not shrink it.
 *
 * Only EXCLUSIONS (`reacts` / `dose-dependent`) are surfaced — a `tolerated` verdict
 * needs no re-test — and only ones whose review date has actually arrived.
 */

import type { ToleranceConclusionData } from "@jeswr/solid-health-diary";
import type { ReviewSurfacing } from "./types";

const DAY_MS = 86_400_000;

/**
 * Surface every time-boxed exclusion whose `reviewAfter` date has ARRIVED
 * (`reviewAfter <= now`), most-overdue first. A conclusion with no `reviewAfter`, a
 * still-future `reviewAfter`, a non-`confirmed` confidence, or a non-exclusion verdict
 * is not surfaced.
 */
export function surfaceReviews(
  conclusions: readonly ToleranceConclusionData[],
  now: Date = new Date(),
): ReviewSurfacing[] {
  const due: ReviewSurfacing[] = [];
  for (const c of conclusions) {
    // Only a CONFIRMED exclusion (from a completed protocol) is re-challenged — a
    // low-confidence or malformed conclusion carrying a stray `reviewAfter` must not
    // drive re-challenge advice or suppress a fresh elimination proposal.
    if (c.confidence !== "confirmed") continue;
    if (!c.reviewAfter) continue;
    if (c.verdict !== "reacts" && c.verdict !== "dose-dependent") continue;
    if (c.reviewAfter.getTime() > now.getTime()) continue;
    const overdueDays = Math.max(
      0,
      Math.floor((now.getTime() - c.reviewAfter.getTime()) / DAY_MS),
    );
    due.push({
      conclusionId: c.id,
      trigger: c.aboutTrigger,
      verdict: c.verdict,
      reviewAfter: c.reviewAfter,
      overdueDays,
      message:
        `It's time to re-test ${c.aboutTrigger}. Sensitivities like this often ease as ` +
        "your gut heals, so it's worth carefully re-challenging it — you may be able to " +
        "add it back to your diet. Talk to your clinician if you're unsure.",
    });
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays || cmp(a.trigger, b.trigger));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
