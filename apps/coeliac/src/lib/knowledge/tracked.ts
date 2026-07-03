// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Derive the set of `TriggerSlug`s the user actively tracks, from their LOCAL
 * cached diary (protocols, conclusions, and meal-derived exposures). This drives
 * LOCAL personalisation of the literature ranking (§3.2) ONLY — the trigger set
 * never leaves the device; it merely re-orders already-fetched PUBLIC results. No
 * trigger term is ever sent to an external API by default.
 */
import type { TriggerSlug } from "@jeswr/solid-health-diary";
import type { DiaryStore } from "../cache/diary-store";

/**
 * The distinct triggers the user tracks: every active/past protocol target, every
 * conclusion subject, and every trigger appearing in a meal's derived exposures.
 * Read-only over the local store; returns [] on any read error (fail-soft).
 */
export async function trackedTriggers(store: DiaryStore | null): Promise<TriggerSlug[]> {
  if (!store) return [];
  try {
    const [meals, protocols, conclusions] = await Promise.all([
      store.allMeals(),
      store.allProtocols(),
      store.allConclusions(),
    ]);
    const set = new Set<TriggerSlug>();
    for (const p of protocols) set.add(p.targetTrigger);
    for (const c of conclusions) set.add(c.aboutTrigger);
    for (const m of meals) for (const e of m.exposures) set.add(e.trigger);
    return [...set];
  } catch {
    return [];
  }
}
