// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Suspicion ranking (DESIGN §4.1/§4.3) — order the per-trigger {@link SuspicionScore}s
 * so the proposal generator can pick the highest-value next trigger to test.
 *
 * Ranking is a stable sort on the documented `rankScore` heuristic (a sort key ONLY,
 * never a probability), tie-broken deterministically by trigger slug so the output is
 * reproducible. Nothing is fabricated: a trigger with no exposure data never enters
 * the list (it is not scored in the first place), and the filtered `suspected+` view
 * returns an EMPTY list when there is no real signal — never a manufactured ranking.
 */

import type { SuspicionScore } from "./types";

/** The confidence ordinal rank (weakest→strongest), for comparisons. */
const CONFIDENCE_RANK: Record<SuspicionScore["confidence"], number> = {
  emerging: 0,
  suspected: 1,
  likely: 2,
};

/**
 * Rank suspicions strongest-first. Stable + deterministic: primary key `rankScore`
 * (desc), then confidence ordinal (desc), then trigger slug (asc) so equal signals
 * order reproducibly.
 */
export function rankSuspicions(scores: readonly SuspicionScore[]): SuspicionScore[] {
  return [...scores].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    const cr = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (cr !== 0) return cr;
    return a.trigger < b.trigger ? -1 : a.trigger > b.trigger ? 1 : 0;
  });
}

/**
 * The ranked suspicions that are at least `suspected` — the set the proposal
 * generator will actually act on. An `emerging`-only or empty input yields an EMPTY
 * list (no proposal will be manufactured from thin signal).
 */
export function rankedSuspects(scores: readonly SuspicionScore[]): SuspicionScore[] {
  return rankSuspicions(scores).filter((s) => CONFIDENCE_RANK[s.confidence] >= CONFIDENCE_RANK.suspected);
}
