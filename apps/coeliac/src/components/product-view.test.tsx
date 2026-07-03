// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The scan→log acceptance: the product view works with a STUBBED fetch (no
 * server). It shows the derived exposures (incl. the honest possible-undeclared
 * note), the OFF attribution, the data-quality caveat, and "Ate it now" writes an
 * owner-only-ACL'd meal to the pod optimistically.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { OffProduct } from "@/lib/off/off";
import { renderWithSession } from "../../test/session-harness";
import { ProductView } from "./product-view";

const APRICOTS: OffProduct = {
  barcode: "3800000000000",
  found: true,
  name: "Dried Apricots",
  brands: "SunCo",
  allergensTags: [],
  tracesTags: [],
  additivesTags: [],
  categoriesTags: ["en:dried-apricots"],
  dataQualityTags: ["en:ingredients-to-be-completed"],
  completeness: 0.3,
  attribution: "Open Food Facts",
  sourceUrl: "https://world.openfoodfacts.org/product/3800000000000",
};

describe("ProductView", () => {
  it("shows the product, the possible-undeclared exposure, attribution + data-quality", () => {
    renderWithSession(<ProductView product={APRICOTS} />);
    expect(screen.getByRole("heading", { name: "Dried Apricots" })).toBeInTheDocument();
    expect(screen.getByText(/Possibly undeclared/i)).toBeInTheDocument();
    expect(screen.getByText("Sulphites")).toBeInTheDocument();
    expect(screen.getByText(/not a false all-clear/i)).toBeInTheDocument();
    // OFF attribution present on the product view.
    const attribution = screen.getByRole("link", { name: /Open Food Facts/i });
    expect(attribution).toHaveAttribute("href", APRICOTS.sourceUrl);
    expect(attribution).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // Data-quality caveat — never a bare green tick.
    expect(screen.getByText(/crowdsourced/i)).toBeInTheDocument();
  });

  it("'Ate it now' writes an owner-only meal to the pod + caches it optimistically", async () => {
    const user = userEvent.setup();
    const { store, fetchMock } = renderWithSession(<ProductView product={APRICOTS} />);
    await user.click(screen.getByRole("button", { name: /Ate it now/i }));

    // Optimistic: shown as saved + present in the durable cache immediately.
    await waitFor(() => expect(screen.getByText(/Saved to your pod/i)).toBeInTheDocument());
    const meals = await store.allMeals();
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0].name).toBe("Dried Apricots");

    // The pod write happened: an owner-only ACL then the meal resource.
    await waitFor(() => {
      const puts = fetchMock.puts();
      expect(puts.some((u) => u.endsWith("/health/diary/.acl"))).toBe(true);
      expect(puts.some((u) => u.includes("/meals/") && u.endsWith(".ttl"))).toBe(true);
    });
    const acl = fetchMock.calls.find((c) => c.method === "PUT" && c.url.endsWith("/health/diary/.acl"));
    expect(acl?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
  });
});
