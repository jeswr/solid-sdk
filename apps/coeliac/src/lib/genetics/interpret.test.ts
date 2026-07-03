// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { HlaMarkerData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import {
  buildSummaryData,
  callPresence,
  coverageComplete,
  GENETIC_FRAMING,
  interpretClinical,
  interpretConsumerArray,
  markerFromManual,
  rollup,
} from "./interpret.js";

describe("callPresence — the health-accuracy core", () => {
  it("rs2187668: a risk (T/A) allele on EITHER strand → present", () => {
    expect(callPresence("rs2187668", "CT")).toBe("present"); // plus-strand het
    expect(callPresence("rs2187668", "TT")).toBe("present");
    expect(callPresence("rs2187668", "AG")).toBe("present"); // minus-strand het (A = risk)
    expect(callPresence("rs2187668", "AA")).toBe("present");
  });

  it("rs2187668: homozygous non-risk (CC / GG) → absent", () => {
    expect(callPresence("rs2187668", "CC")).toBe("absent");
    expect(callPresence("rs2187668", "GG")).toBe("absent"); // minus-strand non-risk
  });

  it("rs7454108: risk C/G → present; non-risk T/A → absent", () => {
    expect(callPresence("rs7454108", "TC")).toBe("present");
    expect(callPresence("rs7454108", "CC")).toBe("present");
    expect(callPresence("rs7454108", "GG")).toBe("present"); // minus-strand risk
    expect(callPresence("rs7454108", "TT")).toBe("absent");
    expect(callPresence("rs7454108", "AA")).toBe("absent"); // minus-strand non-risk
  });

  it("a no-call / ambiguous genotype → uncertain, NEVER a false absent", () => {
    for (const g of ["--", "00", "0", "NN", "T", "II", "DD", "", "  "]) {
      expect(callPresence("rs2187668", g)).toBe("uncertain");
    }
  });

  it("an unmodelled secondary tag never asserts absent (conservative)", () => {
    // rs2395182 (DQ2.2) has no definitive strand model → uncertain, not absent.
    expect(callPresence("rs2395182", "AA")).toBe("uncertain");
  });
});

describe("coverageComplete + rollup (NPV gate)", () => {
  const marker = (rsid: string, presence: HlaMarkerData["markerPresence"]): HlaMarkerData => ({
    rsid,
    markerPresence: presence,
  });

  it("coverage is complete ONLY when both primary tags are definitively called", () => {
    expect(coverageComplete([marker("rs2187668", "absent"), marker("rs7454108", "absent")])).toBe(true);
    expect(coverageComplete([marker("rs2187668", "absent")])).toBe(false); // DQ8 missing
    expect(coverageComplete([marker("rs2187668", "absent"), marker("rs7454108", "uncertain")])).toBe(false);
  });

  it("any present marker → risk-haplotype-present", () => {
    expect(rollup([marker("rs2187668", "present"), marker("rs7454108", "absent")])).toBe(
      "risk-haplotype-present",
    );
  });

  it("all primary tags absent WITH complete coverage → risk-haplotype-absent (NPV)", () => {
    expect(rollup([marker("rs2187668", "absent"), marker("rs7454108", "absent")])).toBe(
      "risk-haplotype-absent",
    );
  });

  it("an absent call WITHOUT complete coverage → partial-coverage, never absent", () => {
    expect(rollup([marker("rs2187668", "absent"), marker("rs7454108", "uncertain")])).toBe(
      "partial-coverage",
    );
  });

  it("nothing definitively called → indeterminate", () => {
    expect(rollup([marker("rs2187668", "uncertain")])).toBe("indeterminate");
    expect(rollup([])).toBe("indeterminate");
  });
});

describe("buildSummaryData / interpret helpers", () => {
  it("always attaches the mandatory NPV framing", () => {
    const data = buildSummaryData([], "manual");
    expect(data.interpretation).toBe(GENETIC_FRAMING);
    expect(data.interpretation).toMatch(/does NOT mean you have coeliac/i);
    expect(data.interpretation).toMatch(/still eating gluten/i);
  });

  it("a no-call consumer array yields an indeterminate, coverage-incomplete summary (no false absent)", () => {
    const data = interpretConsumerArray([
      { rsid: "rs2187668", genotype: "--" },
      { rsid: "rs7454108", genotype: "00" },
    ]);
    expect(data.coeliacGeneticRisk).toBe("indeterminate");
    expect(data.coverageComplete).toBe(false);
    expect(data.markers.map((m) => m.markerPresence)).toEqual(["uncertain", "uncertain"]);
  });

  it("a clean double-negative consumer array yields the NPV risk-haplotype-absent rollup", () => {
    const data = interpretConsumerArray([
      { rsid: "rs2187668", genotype: "CC" },
      { rsid: "rs7454108", genotype: "TT" },
    ]);
    expect(data.coeliacGeneticRisk).toBe("risk-haplotype-absent");
    expect(data.coverageComplete).toBe(true);
    expect(data.sourceType).toBe("consumer-array");
  });

  it("manual entry: an unknown haplotype produces NO marker; present/absent map through", () => {
    const m = markerFromManual("DQ2.5", "present");
    expect(m.rsid).toBe("rs2187668");
    expect(m.riskHaplotype).toBe("DQ2.5");
    expect(m.markerPresence).toBe("present");
  });

  it("clinical prose 'DQ8 negative' → an absent DQ8 marker (partial coverage, not NPV-absent)", () => {
    const data = interpretClinical([{ haplotype: "DQ8", statedPresent: false }]);
    expect(data.markers[0].markerPresence).toBe("absent");
    expect(data.coeliacGeneticRisk).toBe("partial-coverage"); // DQ2.5 not covered
    expect(data.coverageComplete).toBe(false);
  });
});
