// AUTHORED-BY Claude Sonnet 5.5
/**
 * "Likely triggers" for a plain diary of meals and symptoms (no protocols or plan): the
 * ranked suspicions together with the hard safety rails that must be shown ABOVE them
 * (DESIGN §4.4). Surfaces without protocol state call this instead of pairing `correlate`
 * and `rankSuspicions` themselves, so the rails cannot be dropped.
 */

import type { MealData, SymptomData } from "@jeswr/solid-health-diary";
import { correlate } from "./correlate.js";
import { rankSuspicions } from "./rank.js";
import { evaluateSafetyRails, preDiagnosisGlutenBlock } from "./safety.js";
import type { SafetyContext, SafetyRail, SafetyRailSeverity, SuspicionScore } from "./types.js";

const SEVERITY_RANK: Record<SafetyRailSeverity, number> = { emergency: 0, urgent: 1, advisory: 2 };

/** Guidance for the emergency rail. Wording of record shared by every surface. */
export const EMERGENCY_GUIDANCE = {
  title: "This can be a medical emergency",
  intro:
    "Trouble breathing, wheezing, swelling of the lips, tongue or throat, or feeling faint " +
    "after eating can be anaphylaxis — a life-threatening reaction.",
  actions: [
    "Use your adrenaline auto-injector (EpiPen / Jext) now if you have one.",
    "Call emergency services immediately — 999 (UK), 112 (EU), 911 (US).",
    "Lie down and raise your legs; do not stand up suddenly.",
  ],
  note:
    "This app cannot help in an emergency and will not analyse or “correlate” this — get " +
    "medical help right now.",
} as const;

export interface DiaryTriggers {
  /** Strongest first. Render above every suspicion. */
  safetyRails: SafetyRail[];
  /** Ranked; only triggers with at least one completed exposure. Never `confirmed`. */
  suspicions: SuspicionScore[];
}

/**
 * Safety rails plus ranked suspicions for `meals` and `symptoms` observed up to `now`.
 * Future entries are ignored, exposures whose lag window has not elapsed do not count as
 * "not followed", and the pre-diagnosis gluten warning is raised whenever any gluten
 * exposure is logged and `context.coeliacDiagnosed` is not `true`.
 */
export function diaryTriggers(
  diary: { meals: readonly MealData[]; symptoms: readonly SymptomData[] },
  context: SafetyContext = {},
  now: Date = new Date(),
): DiaryTriggers {
  const meals = diary.meals.filter((meal) => meal.startTime <= now);
  const symptoms = diary.symptoms.filter((symptom) => symptom.onset <= now);
  const safetyRails = evaluateSafetyRails({ symptoms, context });
  const suspicions = rankSuspicions(correlate(meals, symptoms, { observedUntil: now })).filter(
    (score) => score.exposureCount > 0,
  );
  const gluten = meals.some((meal) =>
    meal.exposures?.some(
      (exposure) => exposure.trigger === "gluten" && exposure.exposureLevel !== "absent",
    ),
  );
  const block = gluten ? preDiagnosisGlutenBlock(context) : undefined;
  if (block) safetyRails.push(block);
  safetyRails.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { safetyRails, suspicions };
}
