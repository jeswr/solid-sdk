/**
 * `@jeswr/solid-health-diary` — the SHARED multi-intolerance health-diary RDF
 * model for the Solid app suite (coeliac-app Brief 1A).
 *
 * A pod-owned health diary modelled as reusable, dereferenceable RDF: meals +
 * their food items + derived trigger exposures, symptoms, trigger classes (with
 * evidence-prior lag profiles), elimination protocols, tolerance conclusions, a
 * genetics SUMMARY (never raw genotype data), and a diet plan. Built on schema.org
 * + the suite `health` sector + OWL-Time/PROV-O/Dublin Core, with the new
 * nutrition/intolerance terms under `diet:`
 * (`https://w3id.org/jeswr/sectors/health/diet#`) — the vocab authored in parallel
 * in `solid-federation-vocab` (Brief 1B). Typed accessors + SHACL + OFF-tag
 * exposure derivation + an owner-only fail-closed ACL helper.
 *
 * **Browser-safe barrel.** This root entry never imports `node:fs`/`node:url`; the
 * only Node-only piece — the `dietShapeTtl()` / `DIET_SHAPE_PATH` shape loader —
 * lives ONLY behind the `@jeswr/solid-health-diary/shape` subpath. Re-exporting it
 * here would poison every browser consumer of the barrel (a bundler must resolve a
 * module's ENTIRE static import graph). `src/browser-bundle.test.ts` gates this.
 *
 * @packageDocumentation
 */
export { aclUrlFor, buildOwnerOnlyAcl, writeOwnerOnlyAcl } from "./acl.js";
export { type Codec, confidenceCodec, contextCodec, exposureLevelCodec, phaseCodec, portionCodec, sourceConfidenceCodec, symptomTypeCodec, verdictCodec, } from "./concepts.js";
export { buildDietPlan, buildToleranceConclusion, CONFIDENCE_LEVELS, type Confidence, conclusionSubject, DietPlan, type DietPlanData, dietPlanSubject, parseDietPlan, parseDietPlanTtl, parseToleranceConclusion, parseToleranceConclusionTtl, serializeDietPlan, serializeToleranceConclusion, ToleranceConclusion, type ToleranceConclusionData, VERDICTS, type Verdict, } from "./conclusion.js";
export { deriveExposures } from "./derive.js";
export { buildGeneticSummary, GeneticSummary, type GeneticSummaryData, geneticSummarySubject, type HlaMarkerData, markerSubject, parseGeneticSummary, parseGeneticSummaryTtl, serializeGeneticSummary, } from "./genetics.js";
export { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
export { buildMeal, EXPOSURE_LEVELS, Exposure, type ExposureData, type ExposureLevel, exposureSubject, FoodItem, type FoodItemData, foodItemSubject, MEAL_CONTEXTS, Meal, type MealContext, type MealData, mealSubject, PORTIONS, type Portion, parseExposure, parseFoodItem, parseMeal, parseMealTtl, SOURCE_CONFIDENCES, type SourceConfidence, serializeMeal, } from "./meal.js";
export { ACTIVE_CHALLENGE_PHASES, assertSingleActiveChallenge, buildProtocol, countActiveChallenges, EliminationProtocol, hasSingleActiveChallenge, isActiveChallengePhase, PROTOCOL_PHASES, type ProtocolData, type ProtocolPhase, parseProtocol, parseProtocolTtl, protocolSubject, serializeProtocol, } from "./protocol.js";
export { storeToTurtle } from "./serialize.js";
export { buildSymptom, EMERGENCY_SYMPTOM_TYPES, isEmergency, isEmergencySymptomType, isSymptomType, parseSymptom, parseSymptomTtl, SYMPTOM_TYPES, Symptom, type SymptomData, type SymptomType, serializeSymptom, symptomSubject, symptomTypeFromIri, symptomTypeIri, } from "./symptom.js";
export { buildTriggerClass, buildTriggerScheme, defaultTriggerClass, EVIDENCE_PRIOR_LAG, isValidLagProfile, type LagProfile, parseTriggerClass, serializeTriggerClass, TriggerClass, type TriggerClassData, triggerClassSubject, } from "./trigger.js";
export { ACL, acl, CORE, CORE_ABOUT, CORE_PERSON, core, DCT, DIET, DIET_DERIVED_FROM, DIET_DIET_PLAN, DIET_ELIMINATION_PROTOCOL, DIET_EXPOSURE, DIET_FOOD_ITEM, DIET_GENETIC_SUMMARY, DIET_HLA_MARKER, DIET_MEAL, DIET_RESTS_ON, DIET_SYMPTOM, DIET_TOLERANCE_CONCLUSION, DIET_TRIGGER_CLASS, dct, diet, FOAF, HEALTH, HEALTH_OBSERVATION, HEALTH_PATIENT, HEALTH_PATIENT_PROP, health, isTriggerSlug, PREFIXES, PROV, PROV_DERIVED_FROM, PROV_GENERATED_BY, prov, RDF, RDF_TYPE, RDFS, rdf, rdfs, SCHEMA, SCHEMA_FOOD_EVENT, SKOS, SKOS_CONCEPT, schema, skos, TRIGGER_SLUGS, type TriggerSlug, triggerIri, triggerSlugFromIri, XSD, xsd, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map