// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * OpenFoodFacts v2 product lookup (DESIGN §5.2, §6). A barcode is the ONLY thing
 * ever sent to OFF — never any health data. The result maps to a
 * `FoodItemData` (with `sourceConfidence "off"`) that the diary caches in the pod
 * and derives exposures from, and it carries the OFF metadata the product view
 * needs to show the data-quality caveat + ODbL attribution (never a bare green
 * tick — DESIGN §10.4).
 *
 * The fetch is issued through the foreign-origin SSRF guard over the pristine
 * credential-free fetch (see `../fetch/guarded.ts`); the barcode is validated
 * digits-only so it cannot alter the request path.
 */
import type { FoodItemData } from "@jeswr/solid-health-diary";
import { foreignFetch } from "../fetch/guarded.js";
import { assertBarcode } from "../pod/layout.js";

/** The OFF host (public, ODbL). */
export const OFF_HOST = "https://world.openfoodfacts.org";

/** The human/deep-link OFF product page for a barcode. */
export function offProductRef(barcode: string): string {
  return `${OFF_HOST}/product/${assertBarcode(barcode)}`;
}

/** The v2 JSON API URL for a barcode (only the fields we use). */
export function offApiUrl(barcode: string): string {
  const fields = [
    "code",
    "product_name",
    "brands",
    "quantity",
    "allergens_tags",
    "traces_tags",
    "additives_tags",
    "categories_tags",
    "ingredients_text",
    "data_quality_tags",
    "last_edit_dates_tags",
    "completeness",
  ].join(",");
  return `${OFF_HOST}/api/v2/product/${assertBarcode(barcode)}.json?fields=${fields}`;
}

/** A normalised OFF product (found or not). ODbL-attributed. */
export interface OffProduct {
  readonly barcode: string;
  readonly found: boolean;
  readonly name?: string;
  readonly brands?: string;
  readonly quantity?: string;
  readonly ingredientsText?: string;
  readonly allergensTags: readonly string[];
  readonly tracesTags: readonly string[];
  readonly additivesTags: readonly string[];
  readonly categoriesTags: readonly string[];
  /** OFF `data_quality_tags` — surfaced so the user can judge the data. */
  readonly dataQualityTags: readonly string[];
  /** The most recent edit date (from `last_edit_dates_tags[0]`), if any. */
  readonly lastEdit?: string;
  /** OFF `completeness` 0–1, if present. */
  readonly completeness?: number;
  /** Always Open Food Facts (ODbL) — shown on every product view. */
  readonly attribution: "Open Food Facts";
  /** The deep-link to the OFF product page. */
  readonly sourceUrl: string;
}

/** Coerce an unknown JSON value into a string, or undefined. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Coerce an unknown JSON value into a string[] (drops non-strings). */
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Normalise a raw OFF v2 response body (already JSON-parsed) into an
 * {@link OffProduct}. Defensive: OFF is crowdsourced and fields are frequently
 * missing/mistyped (DESIGN §10.4), so every field is coerced, never assumed.
 */
export function normalizeOffResponse(barcode: string, body: unknown): OffProduct {
  const bc = assertBarcode(barcode);
  const obj = (body ?? {}) as Record<string, unknown>;
  const found = obj.status === 1 && typeof obj.product === "object" && obj.product !== null;
  const p = (found ? (obj.product as Record<string, unknown>) : {}) as Record<string, unknown>;
  const lastEditTags = strArray(p.last_edit_dates_tags);
  const completenessRaw = p.completeness;
  return {
    barcode: bc,
    found,
    name: str(p.product_name),
    brands: str(p.brands),
    quantity: str(p.quantity),
    ingredientsText: str(p.ingredients_text),
    allergensTags: strArray(p.allergens_tags),
    tracesTags: strArray(p.traces_tags),
    additivesTags: strArray(p.additives_tags),
    categoriesTags: strArray(p.categories_tags),
    dataQualityTags: strArray(p.data_quality_tags),
    lastEdit: lastEditTags[0],
    completeness: typeof completenessRaw === "number" ? completenessRaw : undefined,
    attribution: "Open Food Facts",
    sourceUrl: offProductRef(bc),
  };
}

/** Map an OFF product to a `FoodItemData` (the diary's food-item shape). */
export function offProductToFoodItem(p: OffProduct): FoodItemData {
  return {
    name: p.name ?? `Barcode ${p.barcode}`,
    offBarcode: p.barcode,
    offRef: p.sourceUrl,
    ingredientsText: p.ingredientsText,
    declaredAllergen: [...p.allergensTags],
    traceAllergen: [...p.tracesTags],
    additive: [...p.additivesTags],
    offCategory: [...p.categoriesTags],
    sourceConfidence: "off",
  };
}

/** An OFF lookup failure (network / non-2xx / bad JSON) — the caller falls back to manual entry. */
export class OffLookupError extends Error {
  constructor(
    readonly barcode: string,
    message: string,
  ) {
    super(message);
    this.name = "OffLookupError";
  }
}

/**
 * Look up a product by barcode from OFF v2 through the SSRF guard.
 *
 * @param barcode - a GTIN/EAN/UPC (validated digits-only).
 * @param publicFetch - the pristine credential-free fetch (never the authed one).
 * @throws {@link OffLookupError} on a network error / non-2xx / non-JSON body.
 *   A well-formed "product not found" (`status:0`) resolves with `found:false`
 *   (NOT an error) so the UI can offer manual entry cleanly.
 */
export async function lookupProduct(
  barcode: string,
  publicFetch: typeof globalThis.fetch,
): Promise<OffProduct> {
  const bc = assertBarcode(barcode);
  const guarded = foreignFetch(publicFetch);
  let res: Response;
  try {
    res = await guarded(offApiUrl(bc), { headers: { accept: "application/json" } });
  } catch (err) {
    throw new OffLookupError(bc, `OFF request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new OffLookupError(bc, `OFF returned HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new OffLookupError(bc, "OFF returned a non-JSON body");
  }
  return normalizeOffResponse(bc, body);
}
