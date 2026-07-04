// AUTHORED-BY Claude Sonnet 5
import type { TriggerSlug } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { PATTERN_NOT_DIAGNOSIS, type EvidencePairing, type SuspicionScore } from "./types";
import { isValidLagProfile } from "@jeswr/solid-health-diary";
import { learnTriggerClasses, MIN_SAMPLE_SIZE, MIN_WINDOW_WIDTH_HOURS } from "./learn-lag-profile";

/** Build a minimal evidence pairing with a single symptom at the given lag (hours). */
function pairing(lagHours: number, coPresent: TriggerSlug[] = []): EvidencePairing {
  return {
    mealId: `https://pod.example/meals/${lagHours}`,
    ingestedAt: new Date("2026-01-01T08:00:00.000Z"),
    exposureLevel: "present",
    derivedFrom: [],
    symptoms: [
      {
        symptomId: `https://pod.example/symptoms/${lagHours}`,
        symptomType: "bloating",
        onset: new Date(new Date("2026-01-01T08:00:00.000Z").getTime() + lagHours * 3_600_000),
        severity: 5,
        lagHours,
      },
    ],
    coPresentTriggers: coPresent,
  };
}

function mkScore(input: {
  trigger: TriggerSlug;
  confidence: SuspicionScore["confidence"];
  confounded?: boolean;
  evidence: EvidencePairing[];
}): SuspicionScore {
  return {
    trigger: input.trigger,
    lagWindowMin: 0,
    lagWindowMax: 6,
    exposureCount: input.evidence.length,
    followedCount: input.evidence.length,
    followedRate: 1,
    expectedRate: 0.2,
    lift: 5,
    attributedSymptomCount: input.evidence.length,
    attributedWeight: input.evidence.length,
    confoundedFraction: 0,
    confounded: input.confounded ?? false,
    confounders: [],
    confidence: input.confidence,
    rankScore: 1,
    evidence: input.evidence,
    disclaimer: PATTERN_NOT_DIAGNOSIS,
  };
}

describe("learnTriggerClasses", () => {
  it("learns nothing for a suspicion below the 'likely' tier", () => {
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "suspected",
        evidence: Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => pairing(1 + i)),
      }),
    ];
    expect(learnTriggerClasses(suspicions)).toEqual([]);
  });

  it("learns nothing for a confounded 'likely' suspicion", () => {
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        confounded: true,
        evidence: Array.from({ length: MIN_SAMPLE_SIZE }, (_, i) => pairing(1 + i)),
      }),
    ];
    expect(learnTriggerClasses(suspicions)).toEqual([]);
  });

  it("learns nothing below the minimum sample size, even at 'likely'", () => {
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        evidence: Array.from({ length: MIN_SAMPLE_SIZE - 1 }, (_, i) => pairing(1 + i)),
      }),
    ];
    expect(learnTriggerClasses(suspicions)).toEqual([]);
  });

  it("learns a valid [min, max, median] profile from a well-supported 'likely' suspicion", () => {
    // Observed lags: 1, 2, 3, 4, 10 hours — median 3, min 1, max 10.
    const lags = [1, 2, 3, 4, 10];
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        evidence: lags.map((h) => pairing(h)),
      }),
    ];
    const learned = learnTriggerClasses(suspicions);
    expect(learned).toHaveLength(1);
    expect(learned[0].data).toEqual({
      slug: "lactose",
      lagWindowMin: 1,
      lagWindowMax: 10,
      lagMode: 3,
    });
    expect(learned[0].sampleSize).toBe(5);
  });

  it("uses the even-count median (average of the two middle values)", () => {
    const lags = [1, 2, 4, 5, 6, 8]; // sorted middle two: 4, 5 → median 4.5
    const suspicions = [
      mkScore({
        trigger: "gluten",
        confidence: "likely",
        evidence: lags.map((h) => pairing(h)),
      }),
    ];
    const learned = learnTriggerClasses(suspicions);
    expect(learned[0].data.lagMode).toBe(4.5);
  });

  it("only returns entries for eligible triggers, skipping ineligible ones in the same run", () => {
    const eligible = mkScore({
      trigger: "lactose",
      confidence: "likely",
      evidence: [1, 2, 3, 4, 5].map((h) => pairing(h)),
    });
    const ineligible = mkScore({
      trigger: "gluten",
      confidence: "suspected",
      evidence: [1, 2, 3, 4, 5].map((h) => pairing(h)),
    });
    const learned = learnTriggerClasses([eligible, ineligible]);
    expect(learned.map((l) => l.data.slug)).toEqual(["lactose"]);
  });

  it("counts every symptom in a multi-symptom pairing toward the sample size", () => {
    const multi: EvidencePairing = {
      mealId: "https://pod.example/meals/multi",
      ingestedAt: new Date("2026-01-01T08:00:00.000Z"),
      exposureLevel: "present",
      derivedFrom: [],
      symptoms: [1, 2, 3].map((h) => ({
        symptomId: `https://pod.example/symptoms/multi-${h}`,
        symptomType: "bloating" as const,
        onset: new Date(new Date("2026-01-01T08:00:00.000Z").getTime() + h * 3_600_000),
        severity: 5,
        lagHours: h,
      })),
      coPresentTriggers: [],
    };
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        evidence: [multi, pairing(5), pairing(6)],
      }),
    ];
    const learned = learnTriggerClasses(suspicions);
    expect(learned[0].sampleSize).toBe(5); // 3 from the multi-symptom pairing + 2 singles
  });

  it("pads a ZERO-WIDTH window (every observed lag identical) out to the floor width — the self-undermining feedback bug", () => {
    // A very consistent reactor: every single observation lags by EXACTLY 2h.
    // Without padding, lagWindowMin===lagWindowMax===2 — a zero-width window
    // that `correlate.ts`'s baseline/lift math treats as "cannot compute a
    // baseline" (lift: undefined), which then makes the NEXT run's confidence
    // classification unable to ever reach "likely" again (a one-way ratchet
    // down to "suspected", since only a "likely" suspicion is eligible to
    // re-learn). The learned window must stay strictly positive-width.
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        evidence: Array.from({ length: MIN_SAMPLE_SIZE }, () => pairing(2)),
      }),
    ];
    const learned = learnTriggerClasses(suspicions);
    expect(learned).toHaveLength(1);
    const { lagWindowMin, lagWindowMax, lagMode } = learned[0].data;
    expect(lagWindowMax - lagWindowMin).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH_HOURS);
    expect(lagWindowMin).toBeLessThanOrEqual(2);
    expect(lagWindowMax).toBeGreaterThanOrEqual(2);
    expect(lagMode).toBe(2);
    expect(isValidLagProfile({ lagWindowMin, lagWindowMax, lagMode })).toBe(true);
  });

  it("clamps the pad at 0 without shrinking below the floor width when the raw window sits at the lag-hours origin", () => {
    // Every observation at lag 0h — padding downward would go negative; the
    // shortfall must be pushed onto the max side instead.
    const suspicions = [
      mkScore({
        trigger: "lactose",
        confidence: "likely",
        evidence: Array.from({ length: MIN_SAMPLE_SIZE }, () => pairing(0)),
      }),
    ];
    const learned = learnTriggerClasses(suspicions);
    const { lagWindowMin, lagWindowMax } = learned[0].data;
    expect(lagWindowMin).toBe(0); // never negative
    expect(lagWindowMax - lagWindowMin).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH_HOURS);
  });
});
