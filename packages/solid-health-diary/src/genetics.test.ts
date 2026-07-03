// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// GeneticSummary round-trip + the PRIVACY invariant: the model can hold ONLY the
// interpreted summary — never raw genotype bytes (DESIGN §7, RESEARCH §2.5).

import { describe, expect, it } from "vitest";
import {
  buildGeneticSummary,
  type GeneticSummaryData,
  type GeneticSummaryInput,
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

function summary(): GeneticSummaryInput {
  return {
    id: geneticSummarySubject(URL_),
    markers: [
      {
        rsid: "rs2187668",
        genotype: "AG",
        markerInterpretation: "DQ2.5 risk haplotype",
        riskHaplotype: "DQ2.5",
        markerPresence: "present",
      },
      {
        rsid: "rs7454108",
        genotype: "TT",
        markerInterpretation: "DQ8 tag",
        riskHaplotype: "DQ8",
        markerPresence: "absent",
      },
    ],
    interpretation: NEG_PREDICTIVE,
    enteredManually: false,
    consentGiven: true,
    sourceType: "consumer-array",
    coeliacGeneticRisk: "risk-haplotype-present",
    coverageComplete: true,
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
    const data: GeneticSummaryInput = {
      id: geneticSummarySubject(URL_),
      markers: [{ rsid: "rs2187668", markerInterpretation: "DQ2.5 risk haplotype" }],
      interpretation: NEG_PREDICTIVE,
      enteredManually: true,
      consentGiven: true,
      sourceType: "manual",
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    expect(parseGeneticSummary(URL_, buildGeneticSummary(URL_, data))).toEqual(data);
  });
});

describe("interpretation is REQUIRED (the negative-predictive framing guardrail)", () => {
  it("buildGeneticSummary THROWS when the interpretation is missing/empty", () => {
    const data = {
      markers: [{ rsid: "rs2187668" }],
      interpretation: "",
    } as unknown as GeneticSummaryInput;
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
    const data = { ...summary(), rawFile: rawGenotypeFile } as unknown as GeneticSummaryInput;
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
      [
        "coeliacGeneticRisk",
        "consentGiven",
        "coverageComplete",
        "created",
        "enteredManually",
        "id",
        "interpretation",
        "markers",
        "patient",
        "sourceType",
      ].sort(),
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

describe("consent guardrail — diet:consentGiven MUST be true to write (fail-closed)", () => {
  it("buildGeneticSummary THROWS when consentGiven is undefined (no consent)", () => {
    // The type BLOCKS omitting consent (GeneticSummaryInput requires consentGiven:true);
    // cast through unknown to exercise the runtime guardrail a cast could bypass.
    const { consentGiven: _omit, ...noConsent } = summary();
    expect(() => buildGeneticSummary(URL_, noConsent as unknown as GeneticSummaryInput)).toThrow(
      /consentGiven MUST be true|explicit consent/i,
    );
  });

  it("buildGeneticSummary THROWS when consentGiven is explicitly false", () => {
    // consentGiven:false is a compile error against GeneticSummaryInput — cast to
    // prove the runtime guardrail also rejects it.
    expect(() =>
      buildGeneticSummary(URL_, {
        ...summary(),
        consentGiven: false,
      } as unknown as GeneticSummaryInput),
    ).toThrow(/consentGiven MUST be true|explicit consent/i);
  });

  it("parseGeneticSummary REJECTS a stored summary whose consentGiven is present-but-false", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:consentGiven "false"^^xsd:boolean .`;
    expect(await parseGeneticSummaryTtl(URL_, ttl)).toBeUndefined();
  });

  it("parseGeneticSummary ALLOWS a pre-refinement summary with NO consentGiven triple (back-compat)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:enteredManually true .`;
    const parsed = await parseGeneticSummaryTtl(URL_, ttl);
    expect(parsed).toBeDefined();
    expect(parsed?.consentGiven).toBeUndefined();
  });

  it("a consent-true summary round-trips with consentGiven surfaced", async () => {
    const parsed = await parseGeneticSummaryTtl(
      URL_,
      await serializeGeneticSummary(URL_, summary()),
    );
    expect(parsed?.consentGiven).toBe(true);
  });
});

describe("NPV-only guardrail — 'risk-haplotype-absent' requires complete coverage", () => {
  it("buildGeneticSummary THROWS when risk-haplotype-absent but coverageComplete is undefined", () => {
    const { coverageComplete: _omit, ...noCoverage } = summary();
    expect(() =>
      buildGeneticSummary(URL_, {
        ...noCoverage,
        coeliacGeneticRisk: "risk-haplotype-absent",
      }),
    ).toThrow(/coverageComplete=true|overstate/i);
  });

  it("buildGeneticSummary THROWS when risk-haplotype-absent but coverageComplete is false", () => {
    expect(() =>
      buildGeneticSummary(URL_, {
        ...summary(),
        coeliacGeneticRisk: "risk-haplotype-absent",
        coverageComplete: false,
      }),
    ).toThrow(/coverageComplete=true|overstate/i);
  });

  it("a risk-haplotype-absent summary WITH coverageComplete=true is allowed + round-trips", async () => {
    const data: GeneticSummaryInput = {
      ...summary(),
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: true,
    };
    const parsed = await parseGeneticSummaryTtl(URL_, await serializeGeneticSummary(URL_, data));
    expect(parsed?.coeliacGeneticRisk).toBe("risk-haplotype-absent");
    expect(parsed?.coverageComplete).toBe(true);
  });

  it("risk-haplotype-present is NOT coverage-gated (a positive is never a diagnosis, but not overstated by absence)", () => {
    const { coverageComplete: _omit, ...noCoverage } = summary();
    expect(() =>
      buildGeneticSummary(URL_, {
        ...noCoverage,
        coeliacGeneticRisk: "risk-haplotype-present",
      }),
    ).not.toThrow();
  });

  it("parseGeneticSummary REJECTS a stored summary asserting risk-haplotype-absent WITHOUT complete coverage", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:consentGiven true ;
        diet:coeliacGeneticRisk diet:riskHaplotypeAbsent .`;
    // No diet:coverageComplete → an overstated negative; must fail closed.
    expect(await parseGeneticSummaryTtl(URL_, ttl)).toBeUndefined();
  });
});

describe("structured genetics fields round-trip + wire encoding (concept IRIs)", () => {
  it("markerPresence / riskHaplotype / coeliacGeneticRisk / sourceType round-trip as friendly tokens", async () => {
    const parsed = await parseGeneticSummaryTtl(
      URL_,
      await serializeGeneticSummary(URL_, summary()),
    );
    expect(parsed?.sourceType).toBe("consumer-array");
    expect(parsed?.coeliacGeneticRisk).toBe("risk-haplotype-present");
    expect(parsed?.markers.map((m) => m.riskHaplotype)).toEqual(["DQ2.5", "DQ8"]);
    expect(parsed?.markers.map((m) => m.markerPresence)).toEqual(["present", "absent"]);
  });

  it("the friendly tokens are STORED as diet: concept IRIs on the wire (distinct from reused schemes)", async () => {
    const ttl = await serializeGeneticSummary(URL_, summary());
    // riskHaplotype DQ2.5 → diet:DQ2_5 (dot is not a bare local-name char)
    expect(ttl).toContain("diet:DQ2_5");
    expect(ttl).toContain("diet:DQ8");
    // markerPresence uses DISTINCT IRIs so it never conflates with the ExposureLevel
    // diet:present / diet:absent concepts (a different scheme).
    expect(ttl).toContain("diet:markerPresent");
    expect(ttl).toContain("diet:markerAbsent");
    // sourceType manual → diet:manualEntry (distinct from the SourceConfidence diet:manual)
    expect(ttl).toContain("diet:consumerArray");
    // coeliacGeneticRisk present → diet:riskHaplotypePresent
    expect(ttl).toContain("diet:riskHaplotypePresent");
    expect(ttl).toContain("diet:consentGiven");
  });
});

describe("provenance-consistency guardrail — sourceType vs enteredManually must agree", () => {
  it("THROWS on sourceType:'manual' with enteredManually:false", () => {
    expect(() =>
      buildGeneticSummary(URL_, { ...summary(), sourceType: "manual", enteredManually: false }),
    ).toThrow(/sourceType and diet:enteredManually disagree|manual/i);
  });

  it("THROWS on a non-manual sourceType with enteredManually:true", () => {
    expect(() =>
      buildGeneticSummary(URL_, {
        ...summary(),
        sourceType: "consumer-array",
        enteredManually: true,
      }),
    ).toThrow(/sourceType and diet:enteredManually disagree|manual/i);
  });

  it("ALLOWS an agreeing pair (manual + enteredManually:true)", () => {
    expect(() =>
      buildGeneticSummary(URL_, { ...summary(), sourceType: "manual", enteredManually: true }),
    ).not.toThrow();
  });

  it("ALLOWS only one of the two provenance fields set", () => {
    const { enteredManually: _drop, ...noManualFlag } = summary();
    expect(() =>
      buildGeneticSummary(URL_, { ...noManualFlag, sourceType: "manual" }),
    ).not.toThrow();
  });

  it("parseGeneticSummary REJECTS stored data whose sourceType and enteredManually contradict", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:consentGiven true ;
        diet:sourceType diet:manualEntry ;
        diet:enteredManually false .`;
    // manual (via sourceType) but enteredManually=false → hostile/stale; fail closed.
    expect(await parseGeneticSummaryTtl(URL_, ttl)).toBeUndefined();
  });

  it("parseGeneticSummary REJECTS a non-manual sourceType with enteredManually:true", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:consentGiven true ;
        diet:sourceType diet:consumerArray ;
        diet:enteredManually true .`;
    expect(await parseGeneticSummaryTtl(URL_, ttl)).toBeUndefined();
  });

  it("parseGeneticSummary ALLOWS an agreeing stored pair (manual + enteredManually:true)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation ${JSON.stringify(NEG_PREDICTIVE)} ;
        diet:consentGiven true ;
        diet:sourceType diet:manualEntry ;
        diet:enteredManually true .`;
    const parsed = await parseGeneticSummaryTtl(URL_, ttl);
    expect(parsed?.sourceType).toBe("manual");
    expect(parsed?.enteredManually).toBe(true);
  });
});
