// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Derive the {@link ProtocolSafetyContext} `emergencyTriggers` set from the diary —
 * the triggers a challenge must NEVER auto-start for (RESEARCH §4, §2.7). Emergency
 * (anaphylaxis / breathing-difficulty) symptoms are EXCLUDED from ordinary
 * correlation (they are emergency-rail territory), but here they are used for the
 * OPPOSITE, safety-conservative purpose: any trigger that was ingested within its
 * lag window before an emergency symptom is flagged as emergency-associated, so the
 * FSM refuses a self-run challenge for it.
 *
 * This is a deliberate OVER-approximation — over-blocking a challenge is safe;
 * under-blocking one for a trigger that once preceded an anaphylactic reaction is
 * not. Pure; no I/O. A malformed lag anchor is simply skipped (fail-closed).
 */
import type { MealData, SymptomData, TriggerClassData, TriggerSlug } from "@jeswr/solid-health-diary";
import { onsetWithinLag, resolveLag } from "../inference/lag.js";
import { partitionEmergencySymptoms } from "../inference/safety.js";

/**
 * The set of triggers that were exposed within their lag window before ANY emergency
 * symptom — the triggers the protocol FSM must refuse to auto-challenge. Returned
 * sorted + de-duplicated.
 */
export function emergencyTriggersFromDiary(
  meals: readonly MealData[],
  symptoms: readonly SymptomData[],
  triggerClasses?: readonly TriggerClassData[],
): TriggerSlug[] {
  const { emergency } = partitionEmergencySymptoms(symptoms as SymptomData[]);
  if (emergency.length === 0) return [];
  const flagged = new Set<TriggerSlug>();
  for (const symptom of emergency) {
    for (const meal of meals) {
      for (const exposure of meal.exposures ?? []) {
        const trigger = exposure.trigger;
        if (flagged.has(trigger)) continue;
        const lag = resolveLag(trigger, triggerClasses);
        if (onsetWithinLag(meal.startTime, symptom.onset, lag)) flagged.add(trigger);
      }
    }
  }
  return [...flagged].sort();
}
