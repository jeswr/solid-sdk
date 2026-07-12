// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Query-term policy for the knowledge integrations (Phase 3a/3b §3.2 / §8).
 *
 * PRIVACY DEFAULT: the external query sent to Europe PMC / ClinicalTrials.gov is a
 * fixed, GENERIC coeliac term — it reveals nothing about the user. Personalisation
 * happens LOCALLY over the cached public result set (see `literature.ts` ranking).
 *
 * QUERY-INJECTION GUARD: an intolerance-specific external query is EXPLICIT
 * OPT-IN only, and even then the condition term comes from a CURATED CONSTANT map
 * keyed by the closed `TriggerSlug` set — never free user text — so a hostile
 * `diet:TriggerClass` value read from a tampered pod cache can never inject into a
 * query. An unknown slug maps to nothing (fail-closed).
 */
import type { TriggerSlug } from "@jeswr/solid-health-diary";

/**
 * The generic, non-identifying condition term. This — and only this — is the
 * default query that leaves the device. It says nothing about the user.
 */
export const GENERIC_COELIAC_QUERY = '(coeliac OR "celiac disease")';

/** The generic condition string for the ClinicalTrials.gov `query.cond` param. */
export const GENERIC_COELIAC_CONDITION = "celiac disease";

/**
 * Curated map: a tracked `TriggerSlug` → a vetted public condition phrase for an
 * OPT-IN targeted external search. Free-text is never used; a slug not present
 * here yields `undefined` (no query), so a tampered pod value cannot inject.
 * `gluten` intentionally maps to the coeliac condition (its clinical context).
 */
const TRIGGER_QUERY_FRAGMENT: Partial<Record<TriggerSlug, string>> = Object.freeze({
  gluten: "celiac disease",
  lactose: "lactose intolerance",
  fructose: "fructose malabsorption",
  fructan: "irritable bowel syndrome FODMAP",
  galactan: "irritable bowel syndrome FODMAP",
  polyol: "irritable bowel syndrome FODMAP",
  sulphites: "sulfite sensitivity",
  histamine: "histamine intolerance",
  nuts: "tree nut allergy",
  soy: "soy allergy",
  egg: "egg allergy",
  caffeine: "caffeine sensitivity",
});

/**
 * The vetted public condition phrase for a tracked trigger, for an OPT-IN targeted
 * external search — or `undefined` for an unknown/untracked slug (fail-closed).
 * The caller URL-encodes it; it is never concatenated raw into a request path.
 */
export function triggerQueryFragment(slug: string): string | undefined {
  return (TRIGGER_QUERY_FRAGMENT as Record<string, string | undefined>)[slug];
}

/**
 * Local-personalisation keywords for a tracked trigger — the terms whose presence
 * in a public result's TITLE boosts its local rank (§3.2). These never leave the
 * device; they only re-order already-fetched public results. Lowercased.
 */
const TRIGGER_LOCAL_KEYWORDS: Partial<Record<TriggerSlug, readonly string[]>> = Object.freeze({
  gluten: ["gluten", "coeliac", "celiac"],
  lactose: ["lactose", "lactase"],
  fructose: ["fructose", "malabsorption"],
  fructan: ["fructan", "fodmap"],
  galactan: ["galactan", "fodmap", "gos"],
  polyol: ["polyol", "fodmap", "sorbitol", "mannitol"],
  sulphites: ["sulphite", "sulfite"],
  histamine: ["histamine"],
  nuts: ["nut", "peanut", "almond"],
  soy: ["soy", "soya"],
  egg: ["egg", "ovalbumin"],
  caffeine: ["caffeine"],
});

/** The lowercased local-boost keywords for a tracked trigger (empty if unknown). */
export function triggerLocalKeywords(slug: string): readonly string[] {
  return (TRIGGER_LOCAL_KEYWORDS as Record<string, readonly string[] | undefined>)[slug] ?? [];
}
