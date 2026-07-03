// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// SHACL conformance against the LANDED diet: profile (vendored verbatim from
// solid-federation-vocab @ Brief 1B). The build* outputs must produce no
// sh:Violation; a malformed entity must. Uses rdf-validate-shacl over a
// @zazuko/env-node dataset (the suite pattern).
//
// The vocabulary is loaded INTO THE DATA GRAPH alongside the instance data,
// because several MUST constraints are sh:class checks over the coded-value
// concept IRIs (e.g. diet:sulphites a diet:TriggerClass) whose typing lives in
// the vocab. Conformance is judged by ABSENCE of sh:Violation (the vocab's own
// grading: MUST=Violation, SHOULD=Warning), so a legitimately-omitted SHOULD
// field does not fail a fixture.

import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { buildDietPlan, buildToleranceConclusion } from "./conclusion.js";
import { deriveExposures } from "./derive.js";
import { buildGeneticSummary } from "./genetics.js";
import { buildMeal, foodItemSubject, type MealData } from "./meal.js";
import { buildProtocol } from "./protocol.js";
import { dietShaclTtl, dietVocabTtl } from "./shape.js";
import { buildSymptom } from "./symptom.js";
import { buildTriggerScheme } from "./trigger.js";

const URL_ = "https://alice.pod.example/health/diary/meals/2026/07/01.ttl";
const ME = "https://alice.pod.example/profile/card#me";

type Quad = Parameters<ReturnType<typeof env.dataset>["add"]>[0];

function toDataset(quads: Iterable<Quad>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const shapes = toDataset(new Parser().parse(dietShaclTtl()));
// The vocab (concept-class typing) is mixed into every data graph so sh:class
// checks over the coded-value IRIs resolve.
const vocabQuads = [...toDataset(new Parser().parse(dietVocabTtl()))];

async function violations(quads: Iterable<Quad>): Promise<string[]> {
  const data = toDataset([...quads, ...vocabQuads]);
  const report = await new SHACLValidator(shapes, { factory: env }).validate(data);
  return report.results
    .filter((r) => String(r.severity?.value).endsWith("Violation"))
    .map((r) => `${String(r.path?.value)}: ${String(r.message?.[0]?.value ?? r.message)}`);
}

describe("SHACL — the build* outputs produce NO violation", () => {
  it("a full Meal (with named items + derived exposures) has no violation", async () => {
    const item0 = foodItemSubject(URL_, 0);
    const exposures = deriveExposures([
      { id: item0, name: "Dried apricots", offCategory: ["en:dried-apricots"] },
    ]).map((e, i) => ({ ...e, id: `${URL_}#exposure-${i}` }));
    const data: MealData = {
      startTime: new Date("2026-07-01T09:00:00.000Z"),
      context: "home",
      portion: "normal",
      patient: ME,
      items: [
        {
          id: item0,
          name: "Dried apricots",
          offCategory: ["en:dried-apricots"],
          sourceConfidence: "off",
        },
      ],
      exposures,
    };
    expect(await violations(buildMeal(URL_, data))).toEqual([]);
  });

  it("a Symptom (with patient) has no violation", async () => {
    const store = buildSymptom(URL_, {
      symptomType: "bloating",
      onset: new Date("2026-07-01T14:00:00.000Z"),
      severity: 6,
      patient: ME,
    });
    expect(await violations(store)).toEqual([]);
  });

  it("the evidence-prior TriggerClass scheme has no violation", async () => {
    expect(await violations(buildTriggerScheme())).toEqual([]);
  });

  it("a Protocol has no violation", async () => {
    const store = buildProtocol(URL_, {
      targetTrigger: "lactose",
      phase: "reintroduce",
      challengeStep: 1,
    });
    expect(await violations(store)).toEqual([]);
  });

  it("a ToleranceConclusion (with reviewAfter) has no violation", async () => {
    const store = buildToleranceConclusion(URL_, {
      aboutTrigger: "lactose",
      verdict: "reacts",
      confidence: "likely",
      reviewAfter: new Date("2027-01-01"),
    });
    expect(await violations(store)).toEqual([]);
  });

  it("a GeneticSummary (interpretation + consent MUST-present) has no violation", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [
        {
          rsid: "rs2187668",
          markerInterpretation: "DQ2.5 risk haplotype",
          riskHaplotype: "DQ2.5",
          markerPresence: "present",
        },
      ],
      interpretation: "Cannot diagnose; negative-predictive only; chip may miss alleles.",
      enteredManually: true,
      consentGiven: true,
      sourceType: "manual",
      coeliacGeneticRisk: "risk-haplotype-present",
      coverageComplete: false,
    });
    expect(await violations(store)).toEqual([]);
  });

  it("a DietPlan (excludes + restsOn) has no violation", async () => {
    const store = buildDietPlan(URL_, {
      excludes: ["lactose"],
      restsOn: [`${URL_}#it`],
    });
    expect(await violations(store)).toEqual([]);
  });
});

describe("SHACL — malformed data yields a violation", () => {
  it("a Meal with NO ingestion time violates the MUST", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      <${URL_}#it> a diet:Meal ; diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ; schema:name "x" .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(v.some((m) => m.includes("startTime"))).toBe(true);
  });

  it("a GeneticSummary with NO interpretation violates the MUST", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(v.some((m) => m.includes("geneticInterpretation"))).toBe(true);
  });

  it("a GeneticSummary with NO consent violates the MUST (consent MUST be true)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation "Cannot diagnose; negative-predictive only." .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(v.some((m) => m.includes("consentGiven"))).toBe(true);
  });

  it("a GeneticSummary with consentGiven=false violates the MUST (sh:hasValue true)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation "Cannot diagnose; negative-predictive only." ;
        diet:consentGiven "false"^^xsd:boolean .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(v.some((m) => m.includes("consentGiven"))).toBe(true);
  });

  it("a GeneticSummary claiming risk-haplotype-absent WITHOUT coverageComplete=true violates the MUST", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation "Cannot diagnose; negative-predictive only." ;
        diet:consentGiven true ;
        diet:coeliacGeneticRisk diet:riskHaplotypeAbsent .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(
      v.some((m) => m.includes("coverageComplete") || m.includes("risk-haplotype-absent")),
    ).toBe(true);
  });

  it("a GeneticSummary claiming risk-haplotype-absent WITH coverageComplete=true has no violation", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [{ rsid: "rs2187668", markerInterpretation: "no risk haplotype found" }],
      interpretation: "Cannot diagnose; negative-predictive only; coverage complete.",
      consentGiven: true,
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: true,
    });
    expect(await violations(store)).toEqual([]);
  });
});

// Two genetic-data defense-in-depth gaps roborev found in the vendored diet:
// profile, closed in lockstep with the authoritative solid-federation-vocab copy
// (the two diet.shacl.ttl files are byte-identical). SECURITY-CRITICAL — genetic
// data: a bypassed NPV safety invariant could surface a false "coeliac unlikely".
describe("SHACL — genetic-data defense-in-depth safety invariants", () => {
  // Gap #2 — coverageComplete contradictory-value bypass. Asserting BOTH true AND
  // false used to only WARN (sh:maxCount 1 at sh:Warning), and the `true` value
  // satisfied the GeneticRiskCoverageShape coverage check — letting a
  // risk-haplotype-absent rollup slip past. The cardinality is now sh:Violation.
  it("a GeneticSummary asserting BOTH coverageComplete true AND false violates the MUST (contradictory pair)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:GeneticSummary ;
        diet:geneticInterpretation "Cannot diagnose; negative-predictive only." ;
        diet:consentGiven true ;
        diet:coeliacGeneticRisk diet:riskHaplotypeAbsent ;
        diet:coverageComplete true ;
        diet:coverageComplete false .
    `;
    const v = await violations(new Parser().parse(ttl));
    expect(v.some((m) => m.includes("coverageComplete"))).toBe(true);
  });

  // Gap #3 — rollup↔marker cross-field inconsistency. buildGeneticSummary does NOT
  // guard this (it only enforces risk-absent ⇒ coverageComplete=true), so the app
  // ALLOWS building it (coverage IS complete here) — the SHACL layer is the guard
  // that catches the contradiction. A claimed "no risk haplotype" refuted by a
  // PRESENT DQ2.5 risk marker MUST fail.
  it("a GeneticSummary claiming risk-haplotype-absent alongside a PRESENT DQ2.5 risk marker violates the consistency MUST", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [
        {
          rsid: "rs2187668",
          markerInterpretation: "rs2187668 present → DQ2.5 risk haplotype",
          riskHaplotype: "DQ2.5",
          markerPresence: "present",
        },
      ],
      interpretation: "Cannot diagnose; negative-predictive only; coverage complete.",
      consentGiven: true,
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: true,
    });
    const v = await violations(store);
    expect(v.some((m) => m.includes("risk-haplotype-absent") && m.includes("markerPresence"))).toBe(
      true,
    );
  });

  it("risk-haplotype-absent alongside an ABSENT DQ8 marker (coverage complete) has no violation", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [
        {
          rsid: "rs7454108",
          markerInterpretation: "rs7454108 absent → no DQ8 risk haplotype",
          riskHaplotype: "DQ8",
          markerPresence: "absent",
        },
      ],
      interpretation: "Cannot diagnose; negative-predictive only; coverage complete.",
      consentGiven: true,
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: true,
    });
    expect(await violations(store)).toEqual([]);
  });

  it("risk-haplotype-PRESENT alongside a PRESENT DQ2.5 marker has no violation (rollup is not 'absent')", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [
        {
          rsid: "rs2187668",
          markerInterpretation: "rs2187668 present → DQ2.5 risk haplotype",
          riskHaplotype: "DQ2.5",
          markerPresence: "present",
        },
      ],
      interpretation: "Cannot diagnose; negative-predictive only; DQ2/DQ8 is common.",
      consentGiven: true,
      coeliacGeneticRisk: "risk-haplotype-present",
      coverageComplete: false,
    });
    expect(await violations(store)).toEqual([]);
  });

  it("risk-haplotype-absent alongside a PRESENT DQ7 marker (DQ7 excluded from the risk set) has no violation", async () => {
    const store = buildGeneticSummary(URL_, {
      markers: [
        {
          rsid: "rs-dq7",
          markerInterpretation: "DQ7 present — not coeliac-risk-conferring on its own",
          riskHaplotype: "DQ7",
          markerPresence: "present",
        },
      ],
      interpretation: "Cannot diagnose; negative-predictive only; coverage complete.",
      consentGiven: true,
      coeliacGeneticRisk: "risk-haplotype-absent",
      coverageComplete: true,
    });
    expect(await violations(store)).toEqual([]);
  });
});
