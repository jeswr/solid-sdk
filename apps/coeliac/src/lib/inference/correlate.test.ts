// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { correlate } from "./correlate";
import { meal, symptom } from "./testUtils";
import { SUSPICION_CONFIDENCE_ORDER, type SuspicionConfidence, type SuspicionScore } from "./types";

// Type-level guard: `confirmed` is NOT assignable to a suspicion's confidence — a
// correlation result structurally cannot claim confirmation (DESIGN §4.2).
// @ts-expect-error 'confirmed' is unrepresentable as a SuspicionConfidence.
const _confirmedIsUnrepresentable: SuspicionConfidence = "confirmed";
void _confirmedIsUnrepresentable;

function byTrigger(scores: SuspicionScore[]): Map<string, SuspicionScore> {
  return new Map(scores.map((s) => [s.trigger, s]));
}

describe("lag-window matrix — per-class attribution", () => {
  it("a symptom inside the gluten window but OUTSIDE the lactose window attributes to gluten only", () => {
    // Meal exposed to BOTH gluten and lactose; symptom 10 h later.
    // gluten window [0,72] ∋ 10  → followed.  lactose window [0.5,6] ∌ 10 → not.
    const meals = [meal({ hours: 0, exposures: [{ trigger: "gluten" }, { trigger: "lactose" }] })];
    const symptoms = [symptom({ hours: 10 })];
    const scores = byTrigger(correlate(meals, symptoms));

    const gluten = scores.get("gluten")!;
    const lactose = scores.get("lactose")!;
    expect(gluten.followedCount).toBe(1);
    expect(gluten.attributedSymptomCount).toBe(1);
    expect(gluten.confounded).toBe(false); // lactose wasn't in-window, so no confounding
    expect(lactose.exposureCount).toBe(1);
    expect(lactose.followedCount).toBe(0);
    expect(lactose.attributedSymptomCount).toBe(0);
  });

  it("the same meal WITH a symptom in the tight lactose window co-attributes both", () => {
    // symptom 3 h later → in BOTH gluten [0,72] and lactose [0.5,6].
    const meals = [meal({ hours: 0, exposures: [{ trigger: "gluten" }, { trigger: "lactose" }] })];
    const scores = byTrigger(correlate(meals, [symptom({ hours: 3 })]));
    expect(scores.get("gluten")!.followedCount).toBe(1);
    expect(scores.get("lactose")!.followedCount).toBe(1);
    // one symptom shared by two triggers → each gets half-weight.
    expect(scores.get("gluten")!.attributedWeight).toBeCloseTo(0.5, 6);
    expect(scores.get("lactose")!.attributedWeight).toBeCloseTo(0.5, 6);
  });
});

describe("confounder case — dilution, not false certainty", () => {
  // 4 meals, each exposed to gluten AND lactose; a symptom 3 h after each — always
  // inside BOTH windows. Attribution must be SHARED, not doubly-certain.
  const meals = [0, 24, 48, 72].map((h) =>
    meal({ id: `https://pod.example/meals/c-${h}`, hours: h, exposures: [{ trigger: "gluten" }, { trigger: "lactose" }] }),
  );
  const symptoms = [3, 27, 51, 75].map((h) => symptom({ id: `https://pod.example/symptoms/c-${h}`, hours: h }));
  const scores = byTrigger(correlate(meals, symptoms));

  it("dilutes attribution weight to the shared fraction (4 symptoms → weight 2 each)", () => {
    expect(scores.get("gluten")!.attributedSymptomCount).toBe(4);
    expect(scores.get("gluten")!.attributedWeight).toBeCloseTo(2, 6);
    expect(scores.get("gluten")!.confoundedFraction).toBeCloseTo(0.5, 6);
  });

  it("flags the confounding and names the co-occurring trigger", () => {
    expect(scores.get("gluten")!.confounded).toBe(true);
    expect(scores.get("gluten")!.confounders).toContain("lactose");
    expect(scores.get("lactose")!.confounders).toContain("gluten");
  });

  it("a confounded signal can NEVER reach 'likely' (needs a test to separate)", () => {
    expect(scores.get("gluten")!.confidence).not.toBe("likely");
    expect(scores.get("gluten")!.confidence).toBe("suspected");
  });

  it("carries the co-present triggers on each evidence pairing (tap-through honesty)", () => {
    const ev = scores.get("gluten")!.evidence;
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((p) => p.coPresentTriggers.includes("lactose"))).toBe(true);
  });
});

describe("clean, well-powered signal can reach 'likely' (tight-window trigger)", () => {
  // 6 lactose meals spread over 10 days; 5 followed by a symptom 2 h later.
  const meals = [0, 48, 96, 144, 192, 240].map((h) =>
    meal({ id: `https://pod.example/meals/l-${h}`, hours: h, exposures: [{ trigger: "lactose" }] }),
  );
  const symptoms = [2, 50, 98, 146, 194].map((h) => symptom({ id: `https://pod.example/symptoms/l-${h}`, hours: h }));
  const scores = byTrigger(correlate(meals, symptoms));

  it("computes 5/6 followed with elevated lift, unconfounded → 'likely'", () => {
    const l = scores.get("lactose")!;
    expect(l.exposureCount).toBe(6);
    expect(l.followedCount).toBe(5);
    expect(l.followedRate).toBeCloseTo(5 / 6, 6);
    expect(l.lift).toBeGreaterThan(1.5);
    expect(l.confounded).toBe(false);
    expect(l.confidence).toBe("likely");
  });
});

describe("empty / sparse data — never fabricates", () => {
  it("no data → no scores", () => {
    expect(correlate([], [])).toEqual([]);
  });

  it("exposures but no symptoms → scored, but zero followed and 'emerging'", () => {
    const scores = byTrigger(correlate([meal({ hours: 0, exposures: [{ trigger: "gluten" }] })], []));
    const g = scores.get("gluten")!;
    expect(g.exposureCount).toBe(1);
    expect(g.followedCount).toBe(0);
    expect(g.confidence).toBe("emerging");
  });

  it("a single exposure+symptom is only 'emerging' (too little to suspect)", () => {
    const scores = byTrigger(
      correlate([meal({ hours: 0, exposures: [{ trigger: "gluten" }] })], [symptom({ hours: 3 })]),
    );
    expect(scores.get("gluten")!.confidence).toBe("emerging");
  });

  it("triggers with no exposure are omitted entirely (no fabricated ranking)", () => {
    const scores = byTrigger(correlate([meal({ hours: 0, exposures: [{ trigger: "gluten" }] })], []));
    expect(scores.has("sulphites")).toBe(false);
    expect(scores.has("nuts")).toBe(false);
  });
});

describe("one symptom → one exposure (no forward-rate inflation on overlapping windows)", () => {
  it("a single symptom credits only the nearest preceding exposure, not all overlapping ones", () => {
    // 3 gluten meals an hour apart; ONE symptom 5 h later sits inside all 3 wide
    // (0–72 h) windows. Naive counting would read 3/3 followed; the matching credits
    // only the nearest (meal at hour 2) → 1/3.
    const meals = [0, 1, 2].map((h) =>
      meal({ id: `https://pod.example/meals/o-${h}`, hours: h, exposures: [{ trigger: "gluten" }] }),
    );
    const scores = byTrigger(correlate(meals, [symptom({ hours: 5 })]));
    const g = scores.get("gluten")!;
    expect(g.exposureCount).toBe(3);
    expect(g.followedCount).toBe(1);
    expect(g.followedRate).toBeCloseTo(1 / 3, 6);
    expect(g.evidence).toHaveLength(1);
    expect(g.evidence[0]!.mealId).toBe("https://pod.example/meals/o-2"); // nearest
  });
});

describe("one exposure EVENT per (meal, trigger) — duplicate records don't inflate", () => {
  it("collapses multiple same-trigger records into one event (strongest level, merged derivedFrom)", () => {
    const meals = [
      meal({
        hours: 0,
        exposures: [
          { trigger: "sulphites", level: "possible-undeclared", derivedFrom: ["https://pod.example/i#a"] },
          { trigger: "sulphites", level: "present", derivedFrom: ["https://pod.example/i#b"] },
        ],
      }),
    ];
    const scores = byTrigger(correlate(meals, [symptom({ hours: 1 })]));
    const s = scores.get("sulphites")!;
    expect(s.exposureCount).toBe(1); // NOT 2
    expect(s.followedCount).toBe(1);
    expect(s.evidence).toHaveLength(1);
    expect(s.evidence[0]!.exposureLevel).toBe("present"); // strongest of the two
    expect([...s.evidence[0]!.derivedFrom].sort()).toEqual([
      "https://pod.example/i#a",
      "https://pod.example/i#b",
    ]);
  });
});

describe("anti-overclaim invariants", () => {
  it("no correlation output ever carries a 'confirmed' confidence", () => {
    const meals = [0, 24, 48].map((h) => meal({ hours: h, exposures: [{ trigger: "gluten" }] }));
    const scores = correlate(meals, [symptom({ hours: 3 }), symptom({ hours: 27 })]);
    for (const s of scores) {
      expect(SUSPICION_CONFIDENCE_ORDER).toContain(s.confidence);
      expect(["emerging", "suspected", "likely"]).toContain(s.confidence);
    }
  });

  it("every score carries the 'pattern, not a diagnosis' disclaimer", () => {
    const scores = correlate([meal({ hours: 0, exposures: [{ trigger: "gluten" }] })], []);
    expect(scores[0]!.disclaimer.toLowerCase()).toContain("not a diagnosis");
  });
});

describe("emergency symptoms are excluded from correlation (DESIGN §4.4)", () => {
  it("an anaphylaxis symptom never pairs with an exposure", () => {
    const meals = [meal({ hours: 0, exposures: [{ trigger: "nuts" }] })];
    // The ONLY symptom is an emergency one, 1 h later (inside the nuts window).
    const scores = byTrigger(correlate(meals, [symptom({ hours: 1, type: "anaphylaxis" })]));
    expect(scores.get("nuts")!.followedCount).toBe(0);
    expect(scores.get("nuts")!.attributedSymptomCount).toBe(0);
  });
});
