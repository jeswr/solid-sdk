// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { TriggerSlug } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { rankedSuspects, rankSuspicions } from "./rank";
import { PATTERN_NOT_DIAGNOSIS, type SuspicionConfidence, type SuspicionScore } from "./types";

function mkScore(
  trigger: TriggerSlug,
  rankScore: number,
  confidence: SuspicionConfidence,
): SuspicionScore {
  return {
    trigger,
    lagWindowMin: 0,
    lagWindowMax: 6,
    exposureCount: 5,
    followedCount: 3,
    followedRate: 0.6,
    expectedRate: 0.2,
    lift: 3,
    attributedSymptomCount: 3,
    attributedWeight: 3,
    confoundedFraction: 0,
    confounded: false,
    confounders: [],
    confidence,
    rankScore,
    evidence: [],
    disclaimer: PATTERN_NOT_DIAGNOSIS,
  };
}

describe("rankSuspicions", () => {
  it("orders strongest rankScore first", () => {
    const ranked = rankSuspicions([
      mkScore("lactose", 1, "suspected"),
      mkScore("sulphites", 5, "likely"),
      mkScore("nuts", 3, "suspected"),
    ]);
    expect(ranked.map((s) => s.trigger)).toEqual(["sulphites", "nuts", "lactose"]);
  });

  it("breaks ties deterministically by confidence then trigger slug", () => {
    const ranked = rankSuspicions([
      mkScore("sulphites", 2, "suspected"),
      mkScore("lactose", 2, "likely"), // higher confidence wins the tie
      mkScore("nuts", 2, "suspected"),
    ]);
    expect(ranked.map((s) => s.trigger)).toEqual(["lactose", "nuts", "sulphites"]);
  });
});

describe("rankedSuspects — only actionable (suspected+) signals", () => {
  it("filters out 'emerging' signals so no proposal is made from thin data", () => {
    const suspects = rankedSuspects([
      mkScore("lactose", 4, "emerging"),
      mkScore("sulphites", 2, "suspected"),
    ]);
    expect(suspects.map((s) => s.trigger)).toEqual(["sulphites"]);
  });

  it("returns an empty list when nothing is at least suspected", () => {
    expect(rankedSuspects([mkScore("lactose", 9, "emerging")])).toEqual([]);
  });
});
