// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// The CORE acceptance of Brief 1A: `deriveExposures` maps OFF allergen/trace/
// additive tags + ingredient-text sulphite aliases → exposures, and applies the
// high-risk-category → possible-undeclared fallback ONLY when tags are clean and
// a category is present. Includes the two MANDATED fixtures (BUILD-PLAN §1A).

import { describe, expect, it } from "vitest";
import { deriveExposures } from "./derive.js";
import type { ExposureData, FoodItemData } from "./meal.js";

/** The exposure for a given trigger, or undefined. */
function forTrigger(exposures: ExposureData[], trigger: string): ExposureData | undefined {
  return exposures.find((e) => e.trigger === trigger);
}

describe("deriveExposures — OFF tag mapping", () => {
  it("maps declared allergens_tags → present exposures", () => {
    const item: FoodItemData = { name: "Bread", declaredAllergen: ["en:gluten", "en:milk"] };
    const out = deriveExposures([item]);
    expect(forTrigger(out, "gluten")?.exposureLevel).toBe("present");
    expect(forTrigger(out, "lactose")?.exposureLevel).toBe("present");
  });

  it("maps traces_tags → trace exposures", () => {
    const item: FoodItemData = { name: "Choc", traceAllergen: ["en:nuts"] };
    expect(forTrigger(deriveExposures([item]), "nuts")?.exposureLevel).toBe("trace");
  });

  it("maps additives_tags E220–E228 → sulphites present", () => {
    for (const code of ["en:e220", "en:e224", "en:e228", "en:e224-potassium-metabisulfite"]) {
      const out = deriveExposures([{ name: "x", additive: [code] }]);
      expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("present");
    }
  });

  it("does NOT map a non-sulphite additive (e.g. en:e322 lecithin) to sulphites", () => {
    const out = deriveExposures([{ name: "x", additive: ["en:e322"] }]);
    expect(forTrigger(out, "sulphites")).toBeUndefined();
  });

  it("maps ingredient-text sulphite aliases → sulphites present (RESEARCH §2.7)", () => {
    for (const text of [
      "Water, sodium metabisulphite, flavouring",
      "contains potassium bisulfite",
      "preservative: sulphur dioxide",
      "sulfurous acid",
    ]) {
      const out = deriveExposures([{ name: "x", ingredientsText: text }]);
      expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("present");
    }
  });

  it("present dominates a same-trigger possible-undeclared (strongest wins)", () => {
    // Dried apricots (high-risk category) that ALSO declares sulphites via E220.
    const item: FoodItemData = {
      name: "Apricots (sulphured)",
      additive: ["en:e220"],
      offCategory: ["en:dried-apricots"],
    };
    const out = deriveExposures([item]);
    expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("present");
    // Exactly one sulphites exposure (not a duplicate possible-undeclared).
    expect(out.filter((e) => e.trigger === "sulphites")).toHaveLength(1);
  });

  it("carries prov derivedFrom item ids (http-filtered) through to the exposure", () => {
    const item: FoodItemData = {
      id: "https://alice.pod.example/health/diary/meals/2026/07/01.ttl#item-0",
      name: "Bread",
      declaredAllergen: ["en:gluten"],
    };
    const out = deriveExposures([item]);
    expect(forTrigger(out, "gluten")?.derivedFrom).toEqual([item.id]);
  });
});

describe("deriveExposures — MANDATED FIXTURE 1: clean-tag high-risk category", () => {
  it("en:dried-apricots with clean tags → possible-undeclared sulphites", () => {
    const item: FoodItemData = {
      name: "Dried apricots",
      offCategory: ["en:dried-apricots"],
      // NO additive, NO declared/trace allergens, NO ingredient-text alias.
    };
    const out = deriveExposures([item]);
    const sulphites = forTrigger(out, "sulphites");
    expect(sulphites).toBeDefined();
    expect(sulphites?.exposureLevel).toBe("possible-undeclared");
    // The honest note is present (never a bare all-clear).
    expect(sulphites?.note).toMatch(/verify against the packet/i);
  });

  it("also fires for wine / beer / bottled citrus / pickle categories", () => {
    for (const cat of ["en:wines", "en:beers", "en:lemon-juices-citrus-juice", "en:pickles"]) {
      const out = deriveExposures([{ name: "x", offCategory: [cat] }]);
      expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("possible-undeclared");
    }
  });

  it("matches the y→ies plural of a dried-fruit token (dried-cranberry / -cranberries)", () => {
    for (const cat of ["en:dried-cranberry", "en:dried-cranberries"]) {
      const out = deriveExposures([{ name: "x", offCategory: [cat] }]);
      expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("possible-undeclared");
    }
  });
});

describe("deriveExposures — MANDATED FIXTURE 2: no false alarm", () => {
  it("an UNKNOWN category with clean tags → NO exposure at all", () => {
    const item: FoodItemData = { name: "Plain crackers", offCategory: ["en:crackers"] };
    expect(deriveExposures([item])).toEqual([]);
  });

  it("category ABSENT (no offCategory) → possible-undeclared does NOT fire", () => {
    // No category → the fallback branch is skipped entirely.
    const item: FoodItemData = { name: "Mystery snack" };
    expect(deriveExposures([item])).toEqual([]);
  });

  it("category absent but a REAL tag present → still derives the tag exposure (fallback unaffected)", () => {
    const item: FoodItemData = { name: "Wine gum", additive: ["en:e220"] };
    const out = deriveExposures([item]);
    expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("present");
  });

  it("NO false positive from a substring collision (en:swine ⊅ wine, en:raising-agents ⊅ raisin)", () => {
    // These categories merely CONTAIN a rule token as a raw substring; delimiter-aware
    // matching must NOT fire a sulphite exposure for any of them.
    for (const cat of ["en:swine", "en:swine-meat", "en:raising-agents", "en:winery-equipment"]) {
      expect(deriveExposures([{ name: "x", offCategory: [cat] }])).toEqual([]);
    }
  });
});

describe("deriveExposures — meal-level aggregation", () => {
  it("aggregates per trigger to the strongest level across items, ordered by slug", () => {
    const items: FoodItemData[] = [
      { name: "Bread", traceAllergen: ["en:gluten"] }, // gluten trace
      { name: "Pasta", declaredAllergen: ["en:gluten"] }, // gluten present
      { name: "Apricots", offCategory: ["en:dried-apricots"] }, // sulphites possible-undeclared
    ];
    const out = deriveExposures(items);
    expect(forTrigger(out, "gluten")?.exposureLevel).toBe("present");
    expect(forTrigger(out, "sulphites")?.exposureLevel).toBe("possible-undeclared");
    // Deterministic slug order.
    expect(out.map((e) => e.trigger)).toEqual([...out.map((e) => e.trigger)].sort());
  });

  it("is deterministic (same input → same output)", () => {
    const items: FoodItemData[] = [{ name: "x", declaredAllergen: ["en:soybeans", "en:eggs"] }];
    expect(deriveExposures(items)).toEqual(deriveExposures(items));
  });

  it("empty input → empty output", () => {
    expect(deriveExposures([])).toEqual([]);
  });
});
