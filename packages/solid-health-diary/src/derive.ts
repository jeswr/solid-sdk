// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `deriveExposures` — turn a meal's FoodItems into derived trigger
 * {@link ExposureData} (DESIGN §2.2 entity 3, §5.2, RESEARCH §2.7).
 *
 * Pure, deterministic, no I/O. Maps OpenFoodFacts `allergens_tags` /
 * `traces_tags` / `additives_tags` (E220–E228 → sulphites) + ingredient-text
 * sulphite aliases → exposures with an {@link ExposureLevel}; and applies a
 * curated **high-risk-category → trigger** map to `diet:offCategory` to raise a
 * `possible-undeclared` flag when tags are clean (the sub-10-ppm sulphite honesty
 * flag — RESEARCH §2.7). If a FoodItem has no category, the `possible-undeclared`
 * fallback does NOT fire (no false alarm).
 *
 * **This is a safety-relevant transform.** Its job is to be honest, not to give a
 * false all-clear: OFF data is crowdsourced and incomplete (DESIGN §10.4), so a
 * high-risk category with clean tags yields an explicit "may contain undeclared"
 * flag rather than silence.
 */

import { isHttpIri } from "./iri.js";
import type { ExposureData, ExposureLevel, FoodItemData } from "./meal.js";
import type { TriggerSlug } from "./vocab.js";

// --- OFF allergen/trace tag → trigger class ----------------------------------
//
// OFF `allergens_tags` / `traces_tags` are language-prefixed (`en:milk`); we
// match on the local part (after the last `:`), lowercased. Only the trigger
// classes this model tracks are mapped — an unmapped allergen yields no exposure.
//
// NOTE (documented simplification): the OFF `milk` ALLERGEN tag maps to the
// `lactose` INTOLERANCE trigger. A true IgE milk-protein ALLERGY is a different
// condition (handled by the emergency safety rail, not this intolerance model);
// for a coeliac/intolerance diary, a milk-containing product is the lactose
// signal. Flagged for the vocab (1B) + inference engine (2A) to refine.

const ALLERGEN_LOCAL_TO_TRIGGER: ReadonlyMap<string, TriggerSlug> = new Map([
  // gluten sources
  ["gluten", "gluten"],
  ["wheat", "gluten"],
  ["barley", "gluten"],
  ["rye", "gluten"],
  ["spelt", "gluten"],
  ["kamut", "gluten"],
  // lactose (via the milk allergen tag — see NOTE above)
  ["milk", "lactose"],
  // egg
  ["eggs", "egg"],
  ["egg", "egg"],
  // soy
  ["soybeans", "soy"],
  ["soya", "soy"],
  ["soy", "soy"],
  // nuts (tree nuts + peanuts + specific nuts)
  ["nuts", "nuts"],
  ["tree-nuts", "nuts"],
  ["peanuts", "nuts"],
  ["almonds", "nuts"],
  ["hazelnuts", "nuts"],
  ["walnuts", "nuts"],
  ["cashew-nuts", "nuts"],
  ["pistachios", "nuts"],
  ["macadamia-nuts", "nuts"],
  ["pecan-nuts", "nuts"],
  ["brazil-nuts", "nuts"],
  // sulphites (declared)
  ["sulphur-dioxide-and-sulphites", "sulphites"],
  ["sulfur-dioxide-and-sulfites", "sulphites"],
  ["sulphites", "sulphites"],
  ["sulfites", "sulphites"],
]);

/** The local part (after the last `:`) of an OFF tag, lowercased + trimmed. */
function tagLocal(tag: string): string {
  const raw = tag.includes(":") ? tag.slice(tag.lastIndexOf(":") + 1) : tag;
  return raw.trim().toLowerCase();
}

/** The trigger an OFF allergen/trace tag maps to, or `undefined`. */
function allergenToTrigger(tag: string): TriggerSlug | undefined {
  return ALLERGEN_LOCAL_TO_TRIGGER.get(tagLocal(tag));
}

/**
 * Whether an OFF `additives_tags` entry is one of the sulphiting agents E220–E228
 * (sulphur dioxide + the sulphite salts). Matches `en:e220`, `en:e224`, and the
 * hyphen-suffixed `en:e224-potassium-metabisulfite` forms.
 */
function isSulphiteAdditive(tag: string): boolean {
  return /^e22[0-8](?![0-9])/.test(tagLocal(tag));
}

// --- Ingredient-text sulphite aliases (RESEARCH §2.7) ------------------------
//
// Lowercased substring scan. `sulphite`/`sulfite` already subsume
// `metabisulphite`/`bisulphite`, but the explicit forms document the intent.
const SULPHITE_ALIASES: readonly string[] = [
  "metabisulphite",
  "metabisulfite",
  "bisulphite",
  "bisulfite",
  "sulphite",
  "sulfite",
  "sulphur dioxide",
  "sulfur dioxide",
  "sulphurous acid",
  "sulfurous acid",
  "e220",
  "e221",
  "e222",
  "e223",
  "e224",
  "e225",
  "e226",
  "e227",
  "e228",
];

/** Whether an ingredient text mentions a sulphite alias (RESEARCH §2.7). */
function hasSulphiteAlias(ingredientsText: string): boolean {
  const t = ingredientsText.toLowerCase();
  return SULPHITE_ALIASES.some((a) => t.includes(a));
}

// --- High-risk-category → trigger (the possible-undeclared map) --------------
//
// RESEARCH §2.7: sub-10-ppm sulphites can be legally unlabelled, so a clean-tag
// product in a high-risk category can still hide them. Each entry matches a
// FoodItem's `diet:offCategory` tags by DELIMITER-AWARE token (hyphen/word
// boundary + optional plural — see {@link categoryHasToken}), NOT an unrestricted
// substring, so `en:swine` never matches `wine`. Kept curated + auditable (no broad
// wildcard) so an unknown category can never false-alarm.

interface HighRiskRule {
  /** Human label for the category family (used in the exposure note). */
  readonly label: string;
  /** Lowercased category tokens; a tag whose local part contains any one (at a
   * hyphen/word boundary, plural-tolerant — see {@link categoryHasToken}) matches. */
  readonly substrings: readonly string[];
  /** The trigger the category commonly hides. */
  readonly trigger: TriggerSlug;
}

const HIGH_RISK_CATEGORY_RULES: readonly HighRiskRule[] = [
  {
    label: "dried fruit",
    substrings: [
      "dried-fruit",
      "dried-apricot",
      "dried-apricots",
      "raisin",
      "sultana",
      "prune",
      "dried-fig",
      "dried-mango",
      "dried-cranberry",
    ],
    trigger: "sulphites",
  },
  { label: "wine", substrings: ["wine"], trigger: "sulphites" },
  { label: "beer", substrings: ["beer"], trigger: "sulphites" },
  {
    label: "bottled citrus juice",
    substrings: ["citrus-juice", "lemon-juice", "lime-juice"],
    trigger: "sulphites",
  },
  { label: "pickles", substrings: ["pickle"], trigger: "sulphites" },
];

/** The lowercased LOCAL part of an OFF tag (after the last `:`; `en:dried-apricots` → `dried-apricots`). */
function categoryLocalPart(tag: string): string {
  return (tag.includes(":") ? tag.slice(tag.lastIndexOf(":") + 1) : tag).toLowerCase();
}

/**
 * Whether an OFF category's local part contains `token` at HYPHEN/word boundaries
 * (with an optional trailing plural `s`/`es`) — NOT an unrestricted substring. A
 * bare `cat.includes("wine")` false-fires on `en:swine`, and `includes("raisin")`
 * on `en:raising-agents`; boundary matching requires the token to start at the
 * string start or just after a `-`, and to end at the string end / a `-` / a plural
 * suffix. So `wines`/`white-wines` match `wine`, but `swine` does not; `raisins`
 * matches `raisin`, but `raising-agents` does not.
 */
function categoryHasToken(local: string, token: string): boolean {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The plural forms to accept: base, +s, +es, and (for a `…y` token) `…ies`
  // (cranberry → cranberries). Matched only at hyphen/word boundaries.
  const forms = new Set([token, `${token}s`, `${token}es`]);
  if (token.endsWith("y")) forms.add(`${token.slice(0, -1)}ies`);
  const alternation = [...forms].map(esc).join("|");
  return new RegExp(`(?:^|-)(?:${alternation})(?:-|$)`).test(local);
}

/** The matching high-risk rule for a set of OFF category tags, or `undefined`. */
function matchHighRisk(categories: readonly string[]): HighRiskRule | undefined {
  const locals = categories.map(categoryLocalPart);
  return HIGH_RISK_CATEGORY_RULES.find((rule) =>
    locals.some((local) => rule.substrings.some((s) => categoryHasToken(local, s))),
  );
}

// --- Level ranking ------------------------------------------------------------

const LEVEL_RANK: Record<ExposureLevel, number> = {
  present: 3,
  trace: 2,
  "possible-undeclared": 1,
  absent: 0,
};

/** The stronger of two levels. */
function strongerLevel(a: ExposureLevel, b: ExposureLevel): ExposureLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Derive the per-trigger exposures for ONE FoodItem — the strongest level found
 * per trigger, keyed by trigger slug. `possible-undeclared` is only added for a
 * trigger with no `present`/`trace` evidence AND only when the item has a
 * high-risk category (absent/unknown category ⇒ it does not fire).
 */
function derivePerItem(item: FoodItemData): Map<TriggerSlug, ExposureLevel> {
  const out = new Map<TriggerSlug, ExposureLevel>();
  const bump = (trigger: TriggerSlug, level: ExposureLevel) => {
    const existing = out.get(trigger);
    out.set(trigger, existing ? strongerLevel(existing, level) : level);
  };

  // present — declared allergens
  for (const tag of item.declaredAllergen ?? []) {
    const t = allergenToTrigger(tag);
    if (t) bump(t, "present");
  }
  // present — sulphiting additives E220–E228
  for (const tag of item.additive ?? []) {
    if (isSulphiteAdditive(tag)) bump("sulphites", "present");
  }
  // present — ingredient-text sulphite aliases
  if (item.ingredientsText && hasSulphiteAlias(item.ingredientsText)) {
    bump("sulphites", "present");
  }
  // trace — "may contain" cross-contamination
  for (const tag of item.traceAllergen ?? []) {
    const t = allergenToTrigger(tag);
    if (t) bump(t, "trace");
  }

  // possible-undeclared — high-risk category with clean tags for that trigger.
  // Category ABSENT/empty ⇒ this branch is skipped entirely (no false alarm).
  const categories = item.offCategory ?? [];
  if (categories.length > 0) {
    const rule = matchHighRisk(categories);
    if (rule && !out.has(rule.trigger)) {
      bump(rule.trigger, "possible-undeclared");
    }
  }

  return out;
}

/** A standard, honest note attached to a `possible-undeclared` exposure. */
function possibleUndeclaredNote(trigger: TriggerSlug, categoryLabel: string): string {
  return (
    `Clean tags, but this product's category (${categoryLabel}) commonly hides ${trigger} ` +
    `below the labelling threshold — verify against the packet (not a false all-clear).`
  );
}

/** The high-risk category label a possible-undeclared exposure came from (for the note). */
function highRiskLabelFor(
  items: readonly FoodItemData[],
  trigger: TriggerSlug,
): string | undefined {
  for (const item of items) {
    const rule = matchHighRisk(item.offCategory ?? []);
    if (rule && rule.trigger === trigger) return rule.label;
  }
  return undefined;
}

/**
 * Derive the meal-level trigger exposures for a set of FoodItems.
 *
 * Aggregates per trigger to the **strongest** level across all items (so a meal
 * where one item declares sulphites `present` does not also carry a weaker
 * `possible-undeclared` for the same trigger), unions the source `derivedFrom`
 * IRIs (each item's `id`, http(s)-filtered), and returns exposures ordered by
 * trigger slug for determinism. A `possible-undeclared` exposure carries an
 * honest note. Never emits `absent`.
 *
 * @param items - the meal's FoodItems (as plain data). Item `id`s, when present +
 *   http(s), become the `prov:wasDerivedFrom` provenance of each exposure.
 */
export function deriveExposures(items: readonly FoodItemData[]): ExposureData[] {
  // trigger → { level, sources }
  const agg = new Map<TriggerSlug, { level: ExposureLevel; sources: Set<string> }>();

  for (const item of items) {
    const perItem = derivePerItem(item);
    for (const [trigger, level] of perItem) {
      const entry = agg.get(trigger);
      if (entry) {
        entry.level = strongerLevel(entry.level, level);
        if (item.id && isHttpIri(item.id)) entry.sources.add(item.id);
      } else {
        const sources = new Set<string>();
        if (item.id && isHttpIri(item.id)) sources.add(item.id);
        agg.set(trigger, { level, sources });
      }
    }
  }

  const out: ExposureData[] = [];
  for (const [trigger, { level, sources }] of [...agg].sort((a, b) => a[0].localeCompare(b[0]))) {
    const exposure: ExposureData = { trigger, exposureLevel: level };
    const derivedFrom = [...sources].sort();
    if (derivedFrom.length) exposure.derivedFrom = derivedFrom;
    if (level === "possible-undeclared") {
      const label = highRiskLabelFor(items, trigger) ?? "a high-risk category";
      exposure.note = possibleUndeclaredNote(trigger, label);
    }
    out.push(exposure);
  }
  return out;
}
