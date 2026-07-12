// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The curated guideline catalog (§3.1): each entry cited, the key safety message present. */
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_KEY_MESSAGE, GUIDELINES } from "./guidelines";

describe("guidelines catalog", () => {
  it("includes NICE NG20, ACG 2023, BSG, and Coeliac UK", () => {
    const ids = GUIDELINES.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(["nice-ng20", "acg-2023", "bsg-2014", "coeliac-uk"]));
  });

  it("every entry is cited with an https source URL + org + year", () => {
    for (const g of GUIDELINES) {
      expect(g.url).toMatch(/^https:\/\//);
      expect(g.org).toBeTruthy();
      expect(g.year).toBeGreaterThan(2000);
      expect(g.summary.length).toBeGreaterThan(10);
    }
  });

  it("the key diagnostic-safety message says: keep eating gluten until tested", () => {
    expect(DIAGNOSIS_KEY_MESSAGE.toLowerCase()).toContain("still eating gluten");
    expect(DIAGNOSIS_KEY_MESSAGE.toLowerCase()).toContain("do not start a gluten-free diet before");
  });
});
