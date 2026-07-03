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
import type { ExposureData, FoodItemData } from "./meal.js";
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
export declare function deriveExposures(items: readonly FoodItemData[]): ExposureData[];
//# sourceMappingURL=derive.d.ts.map