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
 *
 * SAFETY (never re-challenge a lifelong exclusion): only triggers in
 * {@link TIME_BOXED_TRIGGERS} — the SECONDARY intolerances that can resolve as the gut
 * heals — are ever surfaced for re-test. Gluten (coeliac) is deliberately absent from
 * that set and is lifelong. `deriveConfirmedConclusion` never stamps a `reviewAfter` on
 * a gluten conclusion, but this surfacing must not TRUST that: malformed, legacy, or
 * hand-authored diary data could carry a stray `reviewAfter` on a gluten (or other
 * non-time-boxed) exclusion, and surfacing it would produce dangerous "re-test gluten"
 * advice (and, via `proposeNext`, a gluten re-challenge proposal). So we fail closed and
 * filter to the time-boxed set here, independently of the write path.
 */

import type { ToleranceConclusionData, TriggerSlug } from "@jeswr/solid-health-diary";
import { TIME_BOXED_TRIGGERS } from "./conclude";
import { latestByTrigger } from "./latest-conclusion";
import type { ReviewSurfacing } from "./types";

const DAY_MS = 86_400_000;

/**
 * Surface every time-boxed exclusion whose `reviewAfter` date has ARRIVED
 * (`reviewAfter <= now`), most-overdue first. A conclusion with no `reviewAfter`, a
 * still-future `reviewAfter`, a non-`confirmed` confidence, a non-exclusion verdict, or
 * a trigger NOT in `timeBoxedTriggers` (a lifelong exclusion such as gluten) is not
 * surfaced.
 */
export function surfaceReviews(
  conclusions: readonly ToleranceConclusionData[],
  now: Date = new Date(),
  timeBoxedTriggers: readonly TriggerSlug[] = TIME_BOXED_TRIGGERS,
): ReviewSurfacing[] {
  // Collapse to the single LATEST confirmed conclusion per trigger FIRST, so an
  // older `reacts` (with a `reviewAfter`) can never surface a re-test prompt after a
  // NEWER `tolerated` conclusion for the same trigger has superseded it (stale
  // medical guidance — roborev Medium). Deterministic + input-order-independent.
  const confirmed = conclusions.filter((c) => c.confidence === "confirmed");
  const accessors = {
    triggerOf: (c: ToleranceConclusionData) => c.aboutTrigger,
    createdMsOf: (c: ToleranceConclusionData) => c.created?.getTime() ?? Number.NaN,
    idOf: (c: ToleranceConclusionData) => c.id ?? "",
  };
  // The current conclusion per trigger (any verdict) decides whether a re-challenge
  // is still open; the current EXCLUSION conclusion per trigger carries the `why`/
  // review date. Only a latest `tolerated` closes the re-challenge — a later
  // `inconclusive` (e.g. an aborted re-test) must NOT suppress an overdue prompt from
  // an earlier `reacts` (aligns with `settledTriggers`: `inconclusive` is not settled).
  const latest = latestByTrigger(confirmed, accessors);
  const latestExclusion = latestByTrigger(
    confirmed.filter((c) => c.verdict === "reacts" || c.verdict === "dose-dependent"),
    accessors,
  );
  const sources: ToleranceConclusionData[] = [];
  for (const [trigger, cur] of latest) {
    if (cur.verdict === "tolerated") continue; // the food is now tolerated — no re-test
    const src = latestExclusion.get(trigger);
    if (src) sources.push(src);
  }

  const due: ReviewSurfacing[] = [];
  for (const c of sources) {
    // Only a CONFIRMED exclusion (from a completed protocol) is re-challenged — a
    // low-confidence or malformed conclusion carrying a stray `reviewAfter` must not
    // drive re-challenge advice or suppress a fresh elimination proposal.
    if (c.confidence !== "confirmed") continue;
    if (!c.reviewAfter) continue;
    if (c.verdict !== "reacts" && c.verdict !== "dose-dependent") continue;
    // FAIL CLOSED on the trigger: never surface a lifelong exclusion (e.g. gluten) for
    // re-test, even if untrusted/legacy data put a `reviewAfter` on it.
    if (!timeBoxedTriggers.includes(c.aboutTrigger)) continue;
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
