// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildDietPlan,
  buildToleranceConclusion,
  parseDietPlan,
  parseToleranceConclusion,
} from "./conclusion.js";
import { buildGeneticSummary, parseGeneticSummary } from "./genetics.js";
import { buildMeal, FoodItem, Meal, parseMeal } from "./meal.js";
import { buildProtocol, parseProtocol } from "./protocol.js";
import { storeToTurtle } from "./serialize.js";
import { buildSymptom, parseSymptom } from "./symptom.js";
import { buildTriggerScheme, parseTriggerClass } from "./trigger.js";
import {
  CORE,
  DIET,
  HEALTH,
  LEGACY_CORE_NS,
  LEGACY_DIET_NS,
  LEGACY_HEALTH_NS,
  triggerSlugFromIri,
} from "./vocab.js";

const url = "https://alice.example/diary/entry.ttl";
const date = new Date("2026-07-01T08:00:00Z");
const patient = "https://alice.example/profile#me";
const namespaces = [
  [DIET, LEGACY_DIET_NS],
  [HEALTH, LEGACY_HEALTH_NS],
  [CORE, LEGACY_CORE_NS],
] as const;

/** Legacy-read fixtures retain all fields, including nested nodes and coded individuals. */
function legacyFixture(canonical: string): string {
  return namespaces.reduce(
    (body, [current, legacy]) => body.replaceAll(current, legacy),
    canonical,
  );
}

describe("canonical writes and legacy health-diary reads", () => {
  const cases = [
    [
      "meal",
      buildMeal(url, {
        startTime: date,
        context: "restaurant",
        portion: "normal",
        patient,
        items: [
          {
            name: "Toast",
            offBarcode: "123",
            declaredAllergen: ["en:gluten"],
            sourceConfidence: "off",
          },
        ],
        exposures: [
          { trigger: "gluten", exposureLevel: "present", derivedFrom: [`${url}#item-0`] },
        ],
      }),
      parseMeal,
    ],
    [
      "symptom",
      buildSymptom(url, { symptomType: "abdominal-pain", onset: date, severity: 5, patient }),
      parseSymptom,
    ],
    [
      "protocol",
      buildProtocol(url, {
        targetTrigger: "lactose",
        phase: "reintroduce",
        phaseStarted: date,
        patient,
      }),
      parseProtocol,
    ],
    [
      "conclusion",
      buildToleranceConclusion(url, {
        aboutTrigger: "gluten",
        verdict: "dose-dependent",
        confidence: "likely",
        patient,
        reviewAfter: date,
      }),
      parseToleranceConclusion,
    ],
    [
      "plan",
      buildDietPlan(url, { excludes: ["gluten"], restsOn: [`${url}#conclusion`], patient }),
      parseDietPlan,
    ],
    [
      "genetics",
      buildGeneticSummary(url, {
        interpretation: "Not diagnostic",
        consentGiven: true,
        patient,
        sourceType: "consumer-array",
        coeliacGeneticRisk: "partial-coverage",
        coverageComplete: false,
        markers: [
          { rsid: "rs2187668", genotype: "AG", riskHaplotype: "DQ2.5", markerPresence: "present" },
        ],
      }),
      parseGeneticSummary,
    ],
  ] as const;

  for (const [name, store, parse] of cases) {
    it(`reads every ${name} field from legacy vocabulary fixtures`, async () => {
      const turtle = await storeToTurtle(store);
      for (const [, legacy] of namespaces) expect(turtle).not.toContain(legacy);
      const expected = parse(url, store);
      expect(expected).toBeDefined();
      const fixture = legacyFixture(turtle);
      const dataset = await parseRdf(fixture, "text/turtle");
      expect(parse(url, dataset)).toEqual(expected);
    });
  }

  it("reads the legacy trigger subject, type, lag predicates and trigger individuals", async () => {
    const store = buildTriggerScheme({ gluten: { label: "Gluten", lagWindowMax: 80 } });
    const fixture = legacyFixture(await storeToTurtle(store));
    expect(parseTriggerClass("gluten", await parseRdf(fixture, "text/turtle"))).toEqual(
      parseTriggerClass("gluten", store),
    );
    expect(triggerSlugFromIri(`${LEGACY_DIET_NS}gluten`)).toBe("gluten");
  });

  it("rejects conflicting scalar values split across canonical and legacy predicates", async () => {
    const body = await storeToTurtle(cases[0][1]);
    const dataset = await parseRdf(
      `${body}\n<${url}#it> <${LEGACY_DIET_NS}context> <${LEGACY_DIET_NS}home> .`,
      "text/turtle",
    );
    expect(parseMeal(url, dataset)).toBeUndefined();
  });

  it("exposes legacy values through direct typed accessors and writes replacements canonically", async () => {
    const dataset = await parseRdf(legacyFixture(await storeToTurtle(cases[0][1])), "text/turtle");
    const meal = new Meal(`${url}#it`, dataset, DataFactory);
    expect(meal.isMeal).toBe(true);
    expect(meal.context).toBe("restaurant");
    meal.context = "home";
    expect(meal.context).toBe("home");
    expect(
      dataset.match(
        DataFactory.namedNode(meal.id),
        DataFactory.namedNode(`${LEGACY_DIET_NS}context`),
      ).size,
    ).toBe(0);
  });

  it("reads mixed namespaces and keeps set-valued typed accessors live", async () => {
    // Legacy-read fixture with a canonical class and values under both predicate spellings.
    const dataset = await parseRdf(
      `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      <${url}#item-0> a <${DIET}FoodItem> ; schema:name "Toast" ;
        diet:declaredAllergen "en:gluten" ;
        <${DIET}declaredAllergen> "en:nuts" .
    `,
      "text/turtle",
    );
    const item = new FoodItem(`${url}#item-0`, dataset, DataFactory);
    expect(item.isFoodItem).toBe(true);
    const allergens = item.declaredAllergen;
    expect(allergens.size).toBe(2);
    expect([...allergens.keys()]).toEqual(["en:nuts", "en:gluten"]);
    expect([...allergens.entries()]).toEqual([
      ["en:nuts", "en:nuts"],
      ["en:gluten", "en:gluten"],
    ]);
    const visited: string[] = [];
    allergens.forEach((value) => {
      visited.push(value);
    });
    expect(visited).toEqual([...allergens]);
    expect(allergens.has("en:gluten")).toBe(true);
    item.declaredAllergen.add("en:soy");
    expect(allergens.has("en:soy")).toBe(true);
    expect(
      dataset.match(
        DataFactory.namedNode(item.id),
        DataFactory.namedNode(`${LEGACY_DIET_NS}declaredAllergen`),
      ).size,
    ).toBe(1);
    expect(allergens.delete("en:gluten")).toBe(true);
    expect(allergens.delete("absent")).toBe(false);
    allergens.clear();
    expect(item.declaredAllergen.size).toBe(0);
  });
});
