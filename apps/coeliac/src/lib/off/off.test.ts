// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { deriveExposures } from "@jeswr/solid-health-diary";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeOffResponse,
  offApiUrl,
  offProductToFoodItem,
  OffLookupError,
  lookupProduct,
} from "./off";

const APRICOTS = {
  status: 1,
  product: {
    code: "3800000000000",
    product_name: "Dried Apricots",
    brands: "SunCo",
    categories_tags: ["en:dried-fruits", "en:dried-apricots"],
    allergens_tags: [],
    traces_tags: [],
    additives_tags: [],
    data_quality_tags: ["en:ingredients-to-be-completed"],
    completeness: 0.3,
    last_edit_dates_tags: ["2025-11-01", "2025-11", "2025"],
  },
};

const WINE_WITH_SULPHITES = {
  status: 1,
  product: {
    code: "3801111111111",
    product_name: "Red Wine",
    additives_tags: ["en:e220"],
    categories_tags: ["en:wines"],
    allergens_tags: ["en:sulphur-dioxide-and-sulphites"],
    traces_tags: [],
    ingredients_text: "grapes, preservative (sulphur dioxide)",
  },
};

describe("OFF normalisation + mapping", () => {
  it("builds the v2 API URL with the barcode + fields", () => {
    const url = offApiUrl("3800000000000");
    expect(url).toContain("/api/v2/product/3800000000000.json");
    expect(url).toContain("allergens_tags");
  });

  it("normalises a found product with attribution + data-quality metadata", () => {
    const p = normalizeOffResponse("3800000000000", APRICOTS);
    expect(p.found).toBe(true);
    expect(p.name).toBe("Dried Apricots");
    expect(p.categoriesTags).toContain("en:dried-apricots");
    expect(p.attribution).toBe("Open Food Facts");
    expect(p.sourceUrl).toBe("https://world.openfoodfacts.org/product/3800000000000");
    expect(p.lastEdit).toBe("2025-11-01");
    expect(p.completeness).toBe(0.3);
  });

  it("normalises a not-found response (status 0) without throwing", () => {
    const p = normalizeOffResponse("0000000000000", { status: 0, product: {} });
    expect(p.found).toBe(false);
    expect(p.name).toBeUndefined();
  });

  it("maps to a FoodItem whose derived exposures fire the possible-undeclared flag", () => {
    const item = offProductToFoodItem(normalizeOffResponse("3800000000000", APRICOTS));
    expect(item.sourceConfidence).toBe("off");
    const exposures = deriveExposures([item]);
    const sulphite = exposures.find((e) => e.trigger === "sulphites");
    expect(sulphite?.exposureLevel).toBe("possible-undeclared");
    expect(sulphite?.note).toMatch(/verify against the packet/i);
  });

  it("maps declared sulphites to a 'present' exposure", () => {
    const item = offProductToFoodItem(normalizeOffResponse("3801111111111", WINE_WITH_SULPHITES));
    const exposures = deriveExposures([item]);
    expect(exposures.find((e) => e.trigger === "sulphites")?.exposureLevel).toBe("present");
  });
});

describe("lookupProduct (stubbed fetch)", () => {
  it("returns a found product", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(APRICOTS), { status: 200 }));
    const p = await lookupProduct("3800000000000", fetch as unknown as typeof globalThis.fetch);
    expect(p.found).toBe(true);
    expect(p.name).toBe("Dried Apricots");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("resolves found:false for a not-found barcode (status 0)", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 0, product: {} }), { status: 200 }));
    const p = await lookupProduct("0000000000000", fetch as unknown as typeof globalThis.fetch);
    expect(p.found).toBe(false);
  });

  it("throws OffLookupError on a non-2xx", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      lookupProduct("3800000000000", fetch as unknown as typeof globalThis.fetch),
    ).rejects.toBeInstanceOf(OffLookupError);
  });

  it("rejects a non-digit barcode before any fetch (injection guard)", async () => {
    const fetch = vi.fn();
    await expect(
      lookupProduct("../../secret", fetch as unknown as typeof globalThis.fetch),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
