// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Term register for the pilot profile (framework part B).
 *
 * Reused terms are cited with the exact relation this profile uses; minted terms live in
 * the canonical agent namespace and carry a definition and the reason no reused term fits.
 * `relation` is never "equivalent" unless the meanings actually coincide: the register
 * records mappings as `uses` (we use the term with its published meaning), `narrower`
 * (our usage is a subset), or `related` (informative only, no entailment).
 *
 * Minted terms use the namespace fixed by DESIGN §2.4. The JSON wire serialisation (`awp-json`) is a local
 * instantiation of these terms; it is not JSON-LD and does not promote its field names
 * into the abstract model.
 */

/** Compatibility symbol for the canonical agent namespace. */
export { AGENT as AWP } from "../vocab.js";

import { AGENT as AWP } from "../vocab.js";
/** The profile identifier and version implemented here. */
export const PILOT_PROFILE = "https://jeswr.org/ns/agent/profile/pilot/0.1";
/**
 * 0.1.1: identifiers minted by the pilot are valid IRIs (scoped URNs); statements carrying
 * the 0.1.0 `<iri#frag>#x` form are refused and the agent must be re-initialised.
 * 0.1.2: protected deliveries carry disclosure conditions re-checked at every transmission
 * (`condition-failed` refusal); the health operations are version 0.2 (enrollment-bound,
 * consent-bounded grants naming their patient; revocations carry the grant); the public
 * carriage retains received replies durably and retries public reads identically. 0.1.1 agents
 * interoperate on every other operation; health-role directories must be re-initialised.
 */
export const PILOT_PROFILE_VERSION = "0.1.2";

export const PROV = "http://www.w3.org/ns/prov#";
export const ODRL = "http://www.w3.org/ns/odrl/2/";
export const PROF = "http://www.w3.org/ns/dx/prof/";
export const SCHEMA = "https://schema.org/";
export const DPV = "https://w3id.org/dpv#";
export const DCT = "http://purl.org/dc/terms/";
export const DCAT = "http://www.w3.org/ns/dcat#";

/**
 * Reserved example namespace for fixture-only identifiers (purposes, roles, statuses)
 * that have no reviewed public term. They are NOT a proposed public ontology.
 */
export const FIXTURE = "https://example.org/awp-fixture#";

/**
 * Purpose identifiers. DPV terms are reused by IRI (compared by identity; no DPV
 * hierarchy reasoning is performed). Where no DPV term was verified to fit, a fixture
 * identifier is used and labelled as such.
 *
 * Checked against DPV 2.1 (Final CG Report, 16 March 2025; `dpv/modules/purposes.ttl`):
 * see {@link DPV_VALIDATION}. `dpv:CreditChecking` does NOT exist in DPV 2.1, so credit
 * checking is a fixture identifier; the nearest DPV concept, `dpv:CustomerSolvencyMonitoring`
 * (broader `dpv:CustomerManagement`), concerns existing customers and is recorded only as
 * related, not reused.
 */
export const PURPOSE = {
  scheduling: `${DPV}CommunicationManagement`,
  creditChecking: `${FIXTURE}CreditChecking`,
  marketing: `${DPV}Marketing`,
  serviceProvision: `${DPV}ServiceProvision`,
  productDevelopment: `${DPV}ResearchAndDevelopment`,
  maintenance: `${FIXTURE}PredictiveMaintenance`,
  personalHealthSummary: `${FIXTURE}PatientRequestedSummary`,
  priceComparison: `${FIXTURE}PublicPlanComparison`,
  mortgagePrequalification: `${FIXTURE}MortgagePrequalification`,
} as const;

/**
 * Record of the DPV check. Each reused IRI was looked up in the published DPV 2.1 purposes
 * module (retrieved 2026-09-26 via https://w3c-cg.github.io/dpv/2.1/dpv/modules/purposes.ttl
 * and the 2.1 specification page); all are `dpv:Purpose` concepts with term status
 * "accepted" and `skos:broader dpv:Purpose`. `dpv:hasPurpose` is listed as a DPV 2.1 core
 * relation. A newer DPV release may change these; re-check before relying on them.
 */
export const DPV_VALIDATION = {
  release: "DPV 2.1 (W3C DPVCG Final Community Group Report, 2025-03-16)",
  namespace: DPV,
  source: "https://w3c-cg.github.io/dpv/2.1/dpv/modules/purposes.ttl",
  checkedAt: "2026-09-26",
  present: [
    `${DPV}CommunicationManagement`,
    `${DPV}Marketing`,
    `${DPV}ServiceProvision`,
    `${DPV}ResearchAndDevelopment`,
    `${DPV}hasPurpose`,
  ],
  absent: [`${DPV}CreditChecking`],
  replaced: { [`${DPV}CreditChecking`]: `${FIXTURE}CreditChecking` },
} as const;

export interface TermEntry {
  readonly term: string;
  readonly iri: string;
  readonly source: string;
  readonly relation: "uses" | "narrower" | "related" | "minted";
  readonly usage: string;
  readonly notEquivalentTo?: readonly string[];
}

/** The register. Kept small on purpose: only terms the runtime actually acts on. */
export const TERM_REGISTER: readonly TermEntry[] = [
  {
    term: "Agent (party or software)",
    iri: `${PROV}Agent`,
    source: "PROV-O (W3C Rec 2013)",
    relation: "uses",
    usage: "Parties, software actors and operators are all prov:Agent; roles are qualified.",
  },
  {
    term: "actedOnBehalfOf",
    iri: `${PROV}actedOnBehalfOf`,
    source: "PROV-O",
    relation: "uses",
    usage: "Records representation (actor → party) as provenance only.",
    notEquivalentTo: ["authorisation", "odrl:Permission"],
  },
  {
    term: "Activity",
    iri: `${PROV}Activity`,
    source: "PROV-O",
    relation: "uses",
    usage: "ActivityRecord = an attempted effect; its outcome is a separate record.",
  },
  {
    term: "wasDerivedFrom",
    iri: `${PROV}wasDerivedFrom`,
    source: "PROV-O",
    relation: "uses",
    usage: "Derived values (annualised income, cost estimates, summaries) cite inputs.",
  },
  {
    term: "Policy / Permission / Prohibition",
    iri: `${ODRL}Policy`,
    source: "ODRL 2.2 (W3C Rec 2018)",
    relation: "narrower",
    usage:
      "Owner mandates and data-use grants are ODRL policies restricted to the pilot subset " +
      "(actions use/read/distribute/compensate/transfer; operands dateTime/purpose/recipient).",
  },
  {
    term: "Agreement",
    iri: `${ODRL}Agreement`,
    source: "ODRL 2.2",
    relation: "related",
    usage: "Data-use agreements are expressed as ODRL policies; the agreement RECORD is ours.",
    notEquivalentTo: ["legal contract", "agent:AgreementRecord"],
  },
  {
    term: "Profile",
    iri: `${PROF}Profile`,
    source: "PROF (W3C WD revision)",
    relation: "uses",
    usage: "The pilot profile description uses prof:Profile / hasResource / hasRole.",
  },
  {
    term: "Action / potentialAction",
    iri: `${SCHEMA}Action`,
    source: "schema.org",
    relation: "related",
    usage: "Operation descriptions are informally aligned with schema:Action types.",
  },
  {
    term: "Event (meeting)",
    iri: `${SCHEMA}Event`,
    source: "schema.org",
    relation: "uses",
    usage: "The agreed meeting slot is a schema:Event (startDate/endDate).",
  },
  {
    term: "hasPurpose",
    iri: `${DPV}hasPurpose`,
    source: "DPV 2.x (W3C CG)",
    relation: "uses",
    usage: "Purposes are DPV concept IRIs compared by identity (no hierarchy reasoning).",
  },
  {
    term: "DataService",
    iri: `${DCAT}DataService`,
    source: "DCAT 3",
    relation: "related",
    usage: "Reference services (energy retailers, FHIR, telemetry) are described informally.",
  },
  {
    term: "ImplementationDescription",
    iri: `${AWP}ImplementationDescription`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage:
      "What one agent implements vs accepts: configurations, operations, vocabularies. " +
      "No reused term separates 'implemented' from 'accepted for interaction' (A3).",
  },
  {
    term: "Configuration",
    iri: `${AWP}Configuration`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage:
      "One coherent mechanism combination (integrity + authentication + representation + " +
      "authorisation + binding). Selection is per conversation; lists never imply products.",
  },
  {
    term: "OwnerMandate",
    iri: `${AWP}OwnerMandate`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage:
      "Owner-signed bound on what a software actor may do (autonomous vs with-approval " +
      "ODRL policies + validity). Not a representation assertion.",
  },
  {
    term: "RepresentationStatement",
    iri: `${AWP}RepresentationStatement`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage:
      "Party-signed statement that an actor key speaks for the party for listed operations. " +
      "Establishes representation only; it authorises nothing at the receiver.",
  },
  {
    term: "AgreementRecord",
    iri: `${AWP}AgreementRecord`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage: "Documentary record relating offer, acceptance and exact terms digest (A8).",
  },
  {
    term: "OutcomeConclusion",
    iri: `${AWP}OutcomeConclusion`,
    source: "minted (pilot 0.1)",
    relation: "minted",
    usage: "completed | not-executed | uncertain — an evaluator's conclusion about an activity.",
  },
];
