// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// CHARACTERIZATION / GOLDEN-MASTER — pins the package's OBSERVABLE contract so a
// structural change is proven not to alter it. Two axes:
//   1. The exact RUNTIME named-export set of each entry point (`.`, `./shape`) —
//      an added/removed/renamed runtime export fails here; a deliberate change is
//      a reviewed CONTRACT diff. (Type-only exports are erased at runtime; the
//      compile-time assertions below pin the presence + shape of each named type.)
//   2. The EMITTED RDF for a representative build of a core entity, normalised for
//      the non-deterministic `dcterms:created` timestamp — so the exact predicates
//      / concept IRIs the on-pod data binds to are pinned (not `--update`d to make
//      a red test green: an unexpected diff is stop-the-line).

import type { Store } from "n3";
import { describe, expect, it } from "vitest";
import type { Codec } from "./concepts.js";
import type { Confidence, DietPlanData, ToleranceConclusionData, Verdict } from "./conclusion.js";
import type { GeneticSummaryData, GeneticSummaryInput, HlaMarkerData } from "./genetics.js";
import * as mainEntry from "./index.js";
// Compile-time type-export contract (type-erased, so not in the runtime set).
import type { ExposureData, FoodItemData, MealData } from "./meal.js";
import { buildMeal, foodItemSubject, mealSubject } from "./meal.js";
import type { ProtocolData, ProtocolPhase } from "./protocol.js";
import * as shapeEntry from "./shape.js";
import type { SymptomData, SymptomType } from "./symptom.js";
import type { LagProfile, TriggerClassData } from "./trigger.js";

// --- 0. Type-only export contract (compile-time) ------------------------------
const _meal: MealData = { startTime: new Date(0), items: [] };
const _item: FoodItemData = { name: "n" };
const _exposure: ExposureData = { trigger: "gluten", exposureLevel: "present" };
const _plan: DietPlanData = { excludes: [] };
const _symptom: SymptomData = { symptomType: "bloating", onset: new Date(0) };
const _symptomType: SymptomType = "abdominal-pain";
const _protocol: ProtocolData = { targetTrigger: "gluten", phase: "baseline" };
const _phase: ProtocolPhase = "washout";
const _conclusion: ToleranceConclusionData = { aboutTrigger: "gluten", verdict: "reacts" };
const _verdict: Verdict = "dose-dependent";
const _confidence: Confidence = "confirmed";
const _lag: LagProfile = { lagWindowMin: 0, lagWindowMax: 1, lagMode: 0 };
const _trigger: TriggerClassData = { slug: "gluten", lagWindowMin: 0, lagWindowMax: 1, lagMode: 0 };
const _genetics: GeneticSummaryData = { markers: [], interpretation: "i" };
const _geneticsInput: GeneticSummaryInput = {
  markers: [],
  interpretation: "i",
  consentGiven: true,
};
const _marker: HlaMarkerData = { rsid: "rs1" };
const _codec: Codec<"a"> = {
  toIri: () => "x",
  fromIri: () => undefined,
  isToken: (s): s is "a" => s === "a",
  tokens: ["a"],
};
void [
  _meal,
  _item,
  _exposure,
  _plan,
  _symptom,
  _symptomType,
  _protocol,
  _phase,
  _conclusion,
  _verdict,
  _confidence,
  _lag,
  _trigger,
  _genetics,
  _geneticsInput,
  _marker,
  _codec,
];

// --- 1. Runtime export sets ---------------------------------------------------

const MAIN_EXPORTS = [
  "ACL",
  "ACTIVE_CHALLENGE_PHASES",
  "COELIAC_GENETIC_RISKS",
  "CONFIDENCE_LEVELS",
  "CORE",
  "CORE_ABOUT",
  "CORE_PERSON",
  "DCT",
  "DIET",
  "DIET_DERIVED_FROM",
  "DIET_DIET_PLAN",
  "DIET_ELIMINATION_PROTOCOL",
  "DIET_EXPOSURE",
  "DIET_FOOD_ITEM",
  "DIET_GENETIC_SUMMARY",
  "DIET_HLA_MARKER",
  "DIET_MEAL",
  "DIET_RESTS_ON",
  "DIET_SYMPTOM",
  "DIET_TOLERANCE_CONCLUSION",
  "DIET_TRIGGER_CLASS",
  "DietPlan",
  "EMERGENCY_SYMPTOM_TYPES",
  "EVIDENCE_PRIOR_LAG",
  "EXPOSURE_LEVELS",
  "EliminationProtocol",
  "Exposure",
  "FOAF",
  "FoodItem",
  "GENETIC_SOURCE_TYPES",
  "GeneticSummary",
  "HEALTH",
  "HEALTH_OBSERVATION",
  "HEALTH_PATIENT",
  "HEALTH_PATIENT_PROP",
  "MARKER_PRESENCES",
  "MEAL_CONTEXTS",
  "Meal",
  "PORTIONS",
  "PREFIXES",
  "PROTOCOL_PHASES",
  "PROV",
  "PROV_DERIVED_FROM",
  "PROV_GENERATED_BY",
  "RDF",
  "RDFS",
  "RDF_TYPE",
  "RISK_HAPLOTYPES",
  "SCHEMA",
  "SCHEMA_FOOD_EVENT",
  "SCHEMA_MEAL",
  "SKOS",
  "SKOS_CONCEPT",
  "SOURCE_CONFIDENCES",
  "SYMPTOM_TYPES",
  "Symptom",
  "TRIGGER_SLUGS",
  "ToleranceConclusion",
  "TriggerClass",
  "VERDICTS",
  "XSD",
  "acl",
  "aclUrlFor",
  "assertSingleActiveChallenge",
  "buildDietPlan",
  "buildGeneticSummary",
  "buildMeal",
  "buildOwnerOnlyAcl",
  "buildProtocol",
  "buildSymptom",
  "buildToleranceConclusion",
  "buildTriggerClass",
  "buildTriggerScheme",
  "coeliacGeneticRiskCodec",
  "conclusionSubject",
  "confidenceCodec",
  "contextCodec",
  "core",
  "countActiveChallenges",
  "dct",
  "defaultTriggerClass",
  "deriveExposures",
  "diet",
  "dietPlanSubject",
  "docOf",
  "exposureLevelCodec",
  "exposureSubject",
  "foodItemSubject",
  "geneticSummarySubject",
  "hasSingleActiveChallenge",
  "health",
  "httpIriOrUndefined",
  "isActiveChallengePhase",
  "isEmergency",
  "isEmergencySymptomType",
  "isHttpIri",
  "isSymptomType",
  "isTriggerSlug",
  "isValidLagProfile",
  "markerPresenceCodec",
  "markerSubject",
  "mealSubject",
  "parseDietPlan",
  "parseDietPlanTtl",
  "parseExposure",
  "parseFoodItem",
  "parseGeneticSummary",
  "parseGeneticSummaryTtl",
  "parseMeal",
  "parseMealTtl",
  "parseProtocol",
  "parseProtocolTtl",
  "parseSymptom",
  "parseSymptomTtl",
  "parseToleranceConclusion",
  "parseToleranceConclusionTtl",
  "parseTriggerClass",
  "phaseCodec",
  "portionCodec",
  "protocolSubject",
  "prov",
  "rdf",
  "rdfs",
  "riskHaplotypeCodec",
  "schema",
  "serializeDietPlan",
  "serializeGeneticSummary",
  "serializeMeal",
  "serializeProtocol",
  "serializeSymptom",
  "serializeToleranceConclusion",
  "serializeTriggerClass",
  "skos",
  "sourceConfidenceCodec",
  "sourceTypeCodec",
  "storeToTurtle",
  "symptomSubject",
  "symptomTypeCodec",
  "symptomTypeFromIri",
  "symptomTypeIri",
  "triggerClassSubject",
  "triggerIri",
  "triggerSlugFromIri",
  "verdictCodec",
  "writeOwnerOnlyAcl",
  "xsd",
].sort();

const SHAPE_EXPORTS = ["DIET_SHACL_PATH", "DIET_VOCAB_PATH", "dietShaclTtl", "dietVocabTtl"].sort();

describe("public API contract (runtime named-export set)", () => {
  it("the `.` barrel exports exactly the pinned set", () => {
    expect(Object.keys(mainEntry).sort()).toEqual(MAIN_EXPORTS);
  });

  it("the `./shape` subpath exports exactly the pinned set", () => {
    expect(Object.keys(shapeEntry).sort()).toEqual(SHAPE_EXPORTS);
  });
});

describe("emitted RDF is pinned (concept-IRI encoding + predicates)", () => {
  it("a representative Meal serialises to the exact predicate/concept-IRI shape", () => {
    const url = "https://alice.pod.example/health/diary/meals/x.ttl";
    const item0 = foodItemSubject(url, 0);
    const store = buildMeal(url, {
      startTime: new Date("2026-07-01T08:00:00.000Z"),
      created: new Date("2026-07-01T08:00:00.000Z"),
      context: "restaurant",
      portion: "large",
      items: [{ id: item0, name: "Wine", offCategory: ["en:wines"], sourceConfidence: "off" }],
      exposures: [
        {
          id: `${url}#exposure-0`,
          trigger: "sulphites",
          exposureLevel: "possible-undeclared",
          derivedFrom: [item0],
        },
      ],
    });
    const nquads = canonicalQuads(store, url);
    expect(nquads).toEqual([
      `<${url}#exposure-0> <https://w3id.org/jeswr/sectors/health/diet#derivedFrom> <${item0}>`,
      `<${url}#exposure-0> <https://w3id.org/jeswr/sectors/health/diet#exposureLevel> <https://w3id.org/jeswr/sectors/health/diet#possibleUndeclared>`,
      `<${url}#exposure-0> <https://w3id.org/jeswr/sectors/health/diet#trigger> <https://w3id.org/jeswr/sectors/health/diet#sulphites>`,
      `<${url}#exposure-0> a <https://w3id.org/jeswr/sectors/health/diet#Exposure>`,
      `<${mealSubject(url)}> <http://schema.org/startTime> "2026-07-01T08:00:00.000Z"`,
      `<${mealSubject(url)}> <https://w3id.org/jeswr/sectors/health/diet#context> <https://w3id.org/jeswr/sectors/health/diet#restaurant>`,
      `<${mealSubject(url)}> <https://w3id.org/jeswr/sectors/health/diet#hasItem> <${item0}>`,
      `<${mealSubject(url)}> <https://w3id.org/jeswr/sectors/health/diet#portion> <https://w3id.org/jeswr/sectors/health/diet#large>`,
      `<${mealSubject(url)}> a <https://w3id.org/jeswr/sectors/health/diet#Meal>`,
      `<${item0}> <http://schema.org/name> "Wine"`,
      `<${item0}> <https://w3id.org/jeswr/sectors/health/diet#offCategory> "en:wines"`,
      `<${item0}> <https://w3id.org/jeswr/sectors/health/diet#sourceConfidence> <https://w3id.org/jeswr/sectors/health/diet#off>`,
      `<${item0}> a <https://w3id.org/jeswr/sectors/health/diet#FoodItem>`,
    ]);
  });
});

/** Canonical, sorted, timestamp-stripped triples — subject/predicate/object only. */
function canonicalQuads(store: Store, _url: string): string[] {
  const Created = "http://purl.org/dc/terms/created";
  const Type = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const out: string[] = [];
  for (const q of store) {
    if (q.predicate.value === Created) continue; // non-deterministic
    const s = `<${q.subject.value}>`;
    if (q.predicate.value === Type) {
      out.push(`${s} a <${q.object.value}>`);
    } else if (q.object.termType === "NamedNode") {
      out.push(`${s} <${q.predicate.value}> <${q.object.value}>`);
    } else {
      out.push(`${s} <${q.predicate.value}> "${q.object.value}"`);
    }
  }
  return out.sort();
}
