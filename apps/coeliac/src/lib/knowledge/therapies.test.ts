// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Therapies (§4.4): the honest static pipeline + the openFDA named-product LABEL
 * lookup. Health-accuracy asserts: failures shown as failures, no candidate marked
 * effective, and a 404 label lookup is never treated as "nothing approved" proof.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildOpenFdaLabelUrl,
  lookupDrugLabel,
  NO_APPROVED_DRUG_HEADER,
  parseOpenFdaLabel,
  recruitingTherapies,
  THERAPIES,
} from "./therapies";
import { knowledgeFetch } from "./fetch";

describe("pipeline honesty (§1.3)", () => {
  it("header truth: GF diet is the only treatment; nothing approved", () => {
    expect(NO_APPROVED_DRUG_HEADER.toLowerCase()).toContain("gluten-free diet is still the only treatment");
    expect(NO_APPROVED_DRUG_HEADER.toLowerCase()).toContain("no approved drug");
  });

  it("larazotide + Nexvax2 are shown as discontinued/failed, not live options", () => {
    const lara = THERAPIES.find((t) => t.id === "larazotide");
    const nex = THERAPIES.find((t) => t.id === "nexvax2");
    expect(lara?.stage).toBe("discontinued");
    expect(lara?.status.toLowerCase()).toMatch(/fail|discontinu/);
    expect(nex?.stage).toBe("discontinued");
    expect(nex?.status.toLowerCase()).toContain("discontinued");
  });

  it("no candidate is described as an effective/approved treatment", () => {
    for (const t of THERAPIES) {
      const text = `${t.status} ${t.note}`.toLowerCase();
      expect(text).not.toMatch(/\b(cures? coeliac|proven treatment|approved treatment|works\b)/);
    }
  });

  it("enzyme supplements are flagged as not-a-substitute for the diet", () => {
    const supp = THERAPIES.find((t) => t.id === "glutenase-supplements");
    expect(supp?.stage).toBe("supplement");
    expect(supp?.note.toLowerCase()).toContain("substitute");
  });

  it("every therapy cites at least one source", () => {
    for (const t of THERAPIES) expect(t.sources.length).toBeGreaterThan(0);
  });

  it("recruitingTherapies returns only recruiting candidates that carry a live CT.gov term", () => {
    const rec = recruitingTherapies();
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((t) => t.recruiting && t.ctgovTerm)).toBe(true);
    expect(rec.some((t) => t.id === "zed1227")).toBe(true);
  });
});

describe("openFDA label lookup (named-product only — §4.4)", () => {
  it("builds a validated search URL (name cannot alter the path)", () => {
    const url = buildOpenFdaLabelUrl("larazotide");
    expect(url).toContain("api.fda.gov/drug/label.json");
    expect(decodeURIComponent(url)).toContain('openfda.generic_name:"larazotide"');
    expect(() => buildOpenFdaLabelUrl("../../etc")).toThrow();
  });

  it("parses a not-found (empty results) as found:false", () => {
    expect(parseOpenFdaLabel("larazotide", { results: [] }).found).toBe(false);
    expect(parseOpenFdaLabel("larazotide", {}).found).toBe(false);
  });

  it("parses a found label", () => {
    const body = { results: [{ openfda: { brand_name: ["SomeDrug"], generic_name: ["larazotide"] } }] };
    const r = parseOpenFdaLabel("larazotide", body);
    expect(r.found).toBe(true);
    expect(r.labelName).toBe("SomeDrug");
  });

  it("a 404 resolves to found:false (expected for investigational drugs), never throws", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 404 }));
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const r = await lookupDrugLabel(kf, "larazotide");
    expect(r.found).toBe(false);
  });
});
