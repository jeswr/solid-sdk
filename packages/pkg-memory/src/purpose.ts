// AUTHORED-BY Codex GPT-6.1-Sol
import { evaluate, type OdrlPolicy } from "@jeswr/solid-odrl";
import type { Nanopublication } from "./model.js";
import { iri, NS } from "./rdf.js";

/** Closed purposes named by MCP DESIGN §4. */
export const MEMORY_PURPOSES = {
  ServiceProvision: `${NS.dpv}ServiceProvision`,
  Personalisation: `${NS.dpv}Personalisation`,
} as const;
/** A supported purpose token. */
export type MemoryPurpose = keyof typeof MEMORY_PURPOSES;
const special = new Set([
  `${NS.dpv}SpecialCategoryPersonalData`,
  // DPV-PD 2.0 §4: https://w3c-cg.github.io/dpv/2.0/pd/#vocab-special
  ...[
    "MedicalHealth",
    "BloodType",
    "Disability",
    "DNACode",
    "DrugTestResult",
    "Health",
    "PhysicalHealth",
    "HealthHistory",
    "FamilyHealthHistory",
    "IndividualHealthHistory",
    "HealthRecord",
    "Prescription",
    "Genetic",
    "MentalHealth",
    "Biometric",
    "FacialPrint",
    "Fingerprint",
    "Retina",
    "EthnicOrigin",
    "PoliticalAffiliation",
    "Religion",
    "Fetish",
    "Proclivity",
    "SexualPreference",
    "Ethnicity",
    "Race",
    "PoliticalOpinion",
    "ReligiousBelief",
    "PhilosophicalBelief",
    "Sexual",
    "SexualHistory",
    "SexualOrientation",
    "TradeUnionMembership",
  ].map((name) => NS.pd + name),
]);
function categoryIri(category: string): string {
  return iri(category.startsWith("pd:") ? NS.pd + category.slice(3) : category);
}
/** Detect the explicitly supported DPV special categories without fetching a vocabulary. */
export function isSpecialCategory(category: string): boolean {
  return special.has(categoryIri(category));
}
/** Build a per-call predicate: all categories need an explicit, duty-free ODRL permit. */
export function purposeFilter(
  policy: OdrlPolicy,
  purpose: MemoryPurpose,
  clientId: string,
): (fact: Pick<Nanopublication, "categories">) => boolean {
  if (!Object.hasOwn(MEMORY_PURPOSES, purpose)) throw new Error("Unsupported memory purpose");
  const agent = iri(clientId);
  return (fact) =>
    fact.categories.length > 0 &&
    fact.categories.every(
      (category) =>
        evaluate(
          policy,
          {
            agent,
            action: "read",
            target: categoryIri(category),
            attributes: { purpose: MEMORY_PURPOSES[purpose] },
          },
          { requireDuties: true },
        ).decision === "permit",
    );
}
/** Owner-editable default policy; deny health/finance for every client and purpose. */
export function createDefaultPolicy(id: string, owner: string): OdrlPolicy {
  return {
    id: iri(id),
    type: "Set",
    assigner: iri(owner),
    conflict: "prohibit",
    permissions: [
      "Contact",
      "EmailAddress",
      "TelephoneNumber",
      "PhysicalAddress",
      "HomeLocation",
      "Preference",
    ].map((category) => ({
      type: "permission",
      action: "read",
      target: NS.pd + category,
      constraints: [
        {
          leftOperand: "purpose",
          operator: "isAnyOf",
          rightOperand: Object.values(MEMORY_PURPOSES),
        },
      ],
    })),
    prohibitions: ["MedicalHealth", "Genetic", "MentalHealth", "Financial"].map((category) => ({
      type: "prohibition",
      action: "read",
      target: NS.pd + category,
    })),
  };
}
