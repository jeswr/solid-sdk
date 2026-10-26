// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { categoryById } from "../categories.js";
import { allCatalogEntries } from "./registry.js";

it("keeps connector categories in the Pod Manager taxonomy", () => {
  for (const entry of allCatalogEntries()) {
    expect(entry.categories.length).toBeGreaterThan(0);
    for (const category of entry.categories) expect(categoryById(category)).toBeDefined();
  }
});
