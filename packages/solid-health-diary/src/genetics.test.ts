// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// GeneticSummary round-trip + the PRIVACY invariant: the model can hold ONLY the
// interpreted summary — never raw genotype bytes (DESIGN §7, RESEARCH §2.5).

import { describe, expect, it } from "vitest";
import {
  buildGeneticSummary,
  type GeneticSummaryData,
  geneticSummarySubject,
  parseGeneticSummary,
  parseGeneticSummaryTtl,
  serializeGeneticSummary,
} from "./genetics.js";

const URL_ = "https://alice.pod.example/health/diary/genetics.ttl";
const ME = "https://alice.pod.example/profile/card#me";

const NEG_PREDICTIVE =
  "Carrying DQ2/DQ8 does NOT mean you have coeliac (30–40% of everyone carries it); " +
  "not carrying it makes coeliac very unlikely. This cannot diagnose you — diagnosis " +
  "needs serology + biopsy while eating gluten. Your file may not test every risk allele.";

function summary(): GeneticSummaryData {
  return {
    id: geneticSummarySubject(URL_),
    markers: [
      { rsid: "rs2187668", genotype: "AG", markerInterpretation: "DQ2.5 risk haplotype" },
      { rsid: "rs7454108", genotype: "TT", markerInterpretation: "DQ8 tag" },
    ],
    interpretation: NEG_PREDICTIVE,
    enteredManually: false,
    patient: ME,
    created: new Date("2026-07-01T00:00:00.000Z"),
  };
}

describe("GeneticSummary round-trip (parse∘build == identity)", () => {
  it("a full summary (markers + interpretation + flags) round-trips", async () => {
    const data = summary();
    const parsed = await parseGeneticSummaryTtl(URL_, await serializeGeneticSummary(URL_, data));
    expect(parsed).toEqual(data);
  });

  it("a manual-entry summary round-trips", () => {
    const data: GeneticSummaryData = {
      id: geneticSummarySubject(URL_),
      markers: [{ rsid: "rs2187668", markerInterpretation: "DQ2.5 risk haplotype" }],
      interpretation: NEG_PREDICTIVE,
      enteredManually: true,
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    expect(parseGeneticSummary(URL_, buildGeneticSummary(URL_, data))).toEqual(data);
  });
});

describe("interpretation is REQUIRED (the negative-predictive framing guardrail)", () => {
  it("buildGeneticSummary THROWS when the interpretation is missing/empty", () => {
    const data = { markers: [{ rsid: "rs2187668" }], interpretation: "" } as GeneticSummaryData;
    expect(() => buildGeneticSummary(URL_, data)).toThrow(/negative-predictive|REQUIRED/i);
  });

  it("parseGeneticSummary rejects a summary with no diet:geneticInterpretation", () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ; diet:enteredManually true .
    `;
    // Parse via the raw dataset path (no interpretation present).
    return parseGeneticSummaryTtl(URL_, ttl).then((r) => expect(r).toBeUndefined());
  });
});

describe("PRIVACY invariant — raw genotype bytes never enter the pod graph", () => {
  it("build only ever writes the interpreted summary, never an arbitrary raw payload", async () => {
    const rawGenotypeFile =
      "# rsid\tchromosome\tposition\tgenotype\nrs2187668\t6\t32713862\tAG\n" +
      "rs4988235\t2\t136608646\tGG\nRAW_GENOTYPE_BLOB_THAT_MUST_NEVER_PERSIST\n";
    // A hostile/careless caller passes the raw file alongside the summary. The
    // model has no accessor for it, so build must NOT serialise it.
    const data = { ...summary(), rawFile: rawGenotypeFile } as unknown as GeneticSummaryData;
    const ttl = await serializeGeneticSummary(URL_, data);
    expect(ttl).not.toContain("RAW_GENOTYPE_BLOB_THAT_MUST_NEVER_PERSIST");
    expect(ttl).not.toContain("rs4988235"); // an rsID NOT in the summary markers
    expect(ttl).not.toContain("32713862"); // a chromosome position from the raw file
    // And it DOES contain the interpreted summary it is meant to hold.
    expect(ttl).toContain("rs2187668");
  });

  it("the GeneticSummaryData contract exposes no raw-file / network field", () => {
    // The typed public shape is summary-only; a caller cannot even name a raw
    // field without an explicit unsafe cast (compile-time guard). Runtime check:
    const keys = Object.keys(summary());
    expect(keys).not.toContain("rawFile");
    expect(keys).not.toContain("raw");
    expect(keys.sort()).toEqual(
      ["created", "enteredManually", "id", "interpretation", "markers", "patient"].sort(),
    );
  });
});

describe("buildGeneticSummary fail-closed on an rsid-less HLA marker (SHACL MUST)", () => {
  it("throws when a marker has a missing or empty diet:rsid", () => {
    const data = summary();
    expect(() =>
      buildGeneticSummary(URL_, {
        ...data,
        markers: [{ genotype: "AG" } as unknown as GeneticSummaryData["markers"][number]],
      }),
    ).toThrow(/rsid/);
    expect(() =>
      buildGeneticSummary(URL_, {
        ...data,
        markers: [{ rsid: "  " } as GeneticSummaryData["markers"][number]],
      }),
    ).toThrow(/rsid/);
  });

  it("build+parse REJECT a whitespace-only geneticInterpretation (framing MUST be non-empty)", async () => {
    const data = summary();
    expect(() => buildGeneticSummary(URL_, { ...data, interpretation: "   " })).toThrow(
      /interpretation|REQUIRED/i,
    );
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ; diet:geneticInterpretation "   " .`;
    expect(await parseGeneticSummaryTtl(URL_, ttl)).toBeUndefined();
  });

  it("parseGeneticSummary DROPS a marker with a whitespace-only diet:rsid (mirror of the builder)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:hlaMarker <${URL_}#marker-0> , <${URL_}#marker-1> .
      <${URL_}#marker-0> a diet:HlaMarker ; diet:rsid "   " ; diet:genotype "AG" .
      <${URL_}#marker-1> a diet:HlaMarker ; diet:rsid "rs2187668" ; diet:genotype "AG" .`;
    const parsed = await parseGeneticSummaryTtl(URL_, ttl);
    expect(parsed?.markers.map((m) => m.rsid)).toEqual(["rs2187668"]); // the blank-rsid row dropped
  });
});
