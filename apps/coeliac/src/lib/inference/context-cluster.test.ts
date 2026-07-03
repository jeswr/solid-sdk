// AUTHORED-BY Claude Fable 5
/**
 * Eating-out context clustering (DESIGN §2.2/§4). The engine must:
 *  - surface a cluster when restaurant reactions are meaningfully more frequent than
 *    at home, with the counts shown and the honesty caveat attached;
 *  - stay quiet on thin data (a single bad meal never becomes "you react to eating out");
 *  - never treat an EMERGENCY symptom as clustering signal;
 *  - ignore meals with no recorded context (unattributable to a setting).
 */
import type { MealData, SymptomData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import {
  analyzeContextCluster,
  CONTEXT_WINDOW_HOURS,
  MIN_MEALS_PER_CONTEXT,
  PATTERN_NOT_DIAGNOSIS,
} from "./index";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");

function meal(day: number, context: MealData["context"]): MealData {
  return {
    id: `https://alice.example/meals/${context}-${day}.ttl`,
    startTime: new Date(BASE + day * DAY),
    context,
    items: [{ name: "food" }],
    exposures: [],
  };
}

function symptom(day: number, hoursAfter: number, type = "bloating"): SymptomData {
  return {
    id: `https://alice.example/symptoms/${day}-${type}.ttl`,
    symptomType: type as SymptomData["symptomType"],
    onset: new Date(BASE + day * DAY + hoursAfter * HOUR),
  };
}

describe("analyzeContextCluster", () => {
  it("returns undefined when there are too few restaurant meals", () => {
    const meals = [meal(0, "restaurant"), meal(1, "restaurant"), meal(2, "home")];
    const symptoms = [symptom(0, 2), symptom(1, 2)];
    expect(analyzeContextCluster(meals, symptoms)).toBeUndefined();
  });

  it("flags a cluster when restaurant reactions clearly exceed home reactions", () => {
    // 5 restaurant meals, all followed by a symptom; 5 home meals, none followed.
    const meals: MealData[] = [];
    const symptoms: SymptomData[] = [];
    for (let d = 0; d < 5; d++) {
      meals.push(meal(d, "restaurant"));
      symptoms.push(symptom(d, 3));
    }
    for (let d = 10; d < 15; d++) meals.push(meal(d, "home"));
    const result = analyzeContextCluster(meals, symptoms);
    expect(result).toBeDefined();
    expect(result?.clustered).toBe(true);
    expect(result?.eatingOut.mealCount).toBe(5);
    expect(result?.eatingOut.followedCount).toBe(5);
    expect(result?.home.mealCount).toBe(5);
    expect(result?.home.followedCount).toBe(0);
    expect(result?.windowHours).toBe(CONTEXT_WINDOW_HOURS);
    expect(result?.message).toContain("5 of your 5 restaurant meals");
    expect(result?.disclaimer).toBe(PATTERN_NOT_DIAGNOSIS);
  });

  it("does NOT flag a cluster when home reacts just as often", () => {
    const meals: MealData[] = [];
    const symptoms: SymptomData[] = [];
    for (let d = 0; d < 5; d++) {
      meals.push(meal(d, "restaurant"));
      symptoms.push(symptom(d, 3));
      meals.push(meal(d + 20, "home"));
      symptoms.push(symptom(d + 20, 3));
    }
    const result = analyzeContextCluster(meals, symptoms);
    expect(result).toBeDefined();
    expect(result?.clustered).toBe(false);
    expect(result?.liftOverHome).toBeCloseTo(1, 5);
  });

  it("excludes emergency symptoms from the clustering signal", () => {
    // 5 restaurant meals each followed only by an ANAPHYLAXIS symptom → not counted.
    const meals: MealData[] = [];
    const symptoms: SymptomData[] = [];
    for (let d = 0; d < 5; d++) {
      meals.push(meal(d, "restaurant"));
      symptoms.push(symptom(d, 1, "wheeze-breathing"));
      meals.push(meal(d + 30, "home"));
    }
    const result = analyzeContextCluster(meals, symptoms);
    // Restaurant follow-count must be 0 (emergency excluded) → no cluster.
    expect(result?.eatingOut.followedCount).toBe(0);
    expect(result?.clustered).toBe(false);
  });

  it("ignores meals with no recorded context", () => {
    const meals: MealData[] = [
      ...Array.from({ length: 4 }, (_, d) => meal(d, "restaurant")),
      meal(50, undefined),
      meal(51, undefined),
    ];
    const symptoms = Array.from({ length: 4 }, (_, d) => symptom(d, 2));
    const result = analyzeContextCluster(meals, symptoms);
    expect(result?.eatingOut.mealCount).toBe(4);
    // No context bucket for the undefined meals.
    expect(result?.byContext.every((r) => r.context !== undefined)).toBe(true);
  });

  it("respects the min-meals guard threshold", () => {
    const meals = Array.from({ length: MIN_MEALS_PER_CONTEXT - 1 }, (_, d) =>
      meal(d, "restaurant"),
    );
    expect(analyzeContextCluster(meals, [])).toBeUndefined();
  });

  it("clusters against a zero home baseline via the absolute-rate floor", () => {
    const meals: MealData[] = [];
    const symptoms: SymptomData[] = [];
    // 4 restaurant meals, 3 followed (75%); 4 home meals, none followed.
    for (let d = 0; d < 4; d++) {
      meals.push(meal(d, "restaurant"));
      if (d < 3) symptoms.push(symptom(d, 4));
      meals.push(meal(d + 40, "home"));
    }
    const result = analyzeContextCluster(meals, symptoms);
    expect(result?.home.followedRate).toBe(0);
    expect(result?.clustered).toBe(true);
    expect(result?.liftOverHome).toBeUndefined();
  });
});
