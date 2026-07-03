// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The emergency-trigger detector (Phase 2B): a trigger exposed within its lag window
 * before an emergency (anaphylaxis / breathing) symptom is flagged so the FSM refuses
 * to auto-challenge it — the conservative OVER-approximation that keeps a dangerous
 * self-challenge from ever being proposed.
 */
import type { MealData, SymptomData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { emergencyTriggersFromDiary } from "./safety-context";

const BASE = Date.parse("2026-07-01T08:00:00.000Z");

function meal(hoursOffset: number, trigger: string): MealData {
  return {
    id: `meal-${hoursOffset}-${trigger}`,
    startTime: new Date(BASE + hoursOffset * 3_600_000),
    items: [{ name: trigger }],
    exposures: [
      { trigger: trigger as NonNullable<MealData["exposures"]>[number]["trigger"], exposureLevel: "present" },
    ],
  };
}

function symptom(hoursOffset: number, symptomType: string): SymptomData {
  return {
    id: `sym-${hoursOffset}-${symptomType}`,
    symptomType: symptomType as SymptomData["symptomType"],
    onset: new Date(BASE + hoursOffset * 3_600_000),
  };
}

describe("emergencyTriggersFromDiary", () => {
  it("is empty when there is no emergency symptom", () => {
    const meals = [meal(0, "sulphites")];
    const symptoms = [symptom(2, "bloating")]; // non-emergency
    expect(emergencyTriggersFromDiary(meals, symptoms)).toEqual([]);
  });

  it("flags a trigger exposed within its lag window before a breathing-difficulty symptom", () => {
    const meals = [meal(0, "sulphites")];
    // sulphite window is tight (~0.5–6h); a wheeze 2h later pairs.
    const symptoms = [symptom(2, "wheeze-breathing")];
    const flagged = emergencyTriggersFromDiary(meals, symptoms);
    expect(flagged).toContain("sulphites");
  });

  it("does NOT flag a trigger whose exposure is outside the lag window of the emergency symptom", () => {
    const meals = [meal(0, "sulphites")];
    // A wheeze 10 days later cannot be attributed to that meal's sulphites (tight window).
    const symptoms = [symptom(240, "wheeze-breathing")];
    expect(emergencyTriggersFromDiary(meals, symptoms)).toEqual([]);
  });
});
