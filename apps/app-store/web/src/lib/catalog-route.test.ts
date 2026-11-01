// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCatalogRoute } from "./catalog-route";

afterEach(() => vi.unstubAllEnvs());

describe("catalog route", () => {
  it.each(["/", "./", "/solid-sdk/app-store/"])("resolves the catalog within base %s", (base) => {
    vi.stubEnv("BASE_URL", base);
    const root = new URL(base, "https://jeswr.github.io/").href;
    for (const route of ["catalog", "catalog/", "#/catalog"]) {
      expect(isCatalogRoute(new URL(route, root))).toBe(true);
    }
    for (const route of ["", "catalog.ttl", "catalog.jsonld", "nested/catalog"]) {
      expect(isCatalogRoute(new URL(route, root))).toBe(false);
    }
    if (base.startsWith("/solid-sdk/")) {
      expect(isCatalogRoute(new URL("https://jeswr.github.io/catalog"))).toBe(false);
    }
  });
});
