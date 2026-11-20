// AUTHORED-BY Codex GPT-6.1-Sol
/** Browser-safe, immutable inventory used by the memory special-category policy. */
const DPV = "https://w3id.org/dpv#";
const PD = "https://w3id.org/dpv/pd#";
export const SPECIAL_CATEGORIES: readonly string[] = Object.freeze([
  `${DPV}SpecialCategoryPersonalData`,
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
  ].map((name) => PD + name),
]);
