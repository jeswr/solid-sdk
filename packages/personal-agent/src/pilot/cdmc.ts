/**
 * CDMC key-control register for the pilot: engineering gap notes pinned to a published
 * baseline (corrected per reports/CDMC-SOURCE-REVIEW.md).
 *
 * NOT an assessment and NO compliance claim. Controls are identified by a project-owned stable
 * id plus baseline, capability reference, pinned name and source anchor — never by a bare
 * number, because EDM Association sources order the last four controls differently. No text of
 * the licensed framework is reproduced; each entry records what the pilot has
 * (`observedArtifacts`), what is missing (`implementationGaps`) and why it applies.
 */

/** Pinned engineering baseline (see reports/CDMC-SOURCE-REVIEW.md). */
export const CDMC_BASELINE = {
  framework: "CDMC Framework v1.1.1, September 2021",
  publisher: "EDM Council / EDM Association",
  structure: "6 components, 14 capabilities, 37 sub-capabilities; 14 Key Controls",
  sourceAnchor: "v1.1.1 section 7 (detailed key-control register)",
  sources: [
    "https://edmcouncil.org/frameworks/cdmc/",
    "https://edmcouncil.org/wp-content/uploads/2023/06/CDMC_Framework_V1.1.1.pdf",
    "https://edmcouncil.org/frameworks/cdmc/14-key-controls/",
  ],
  licensing:
    "The framework text is proprietary (CDMC Terms of Use); only control names and numbers are pinned here. The MIT-licensed EDM Council CDMC ontology does not license the framework or confer an assessment result.",
  numberingNote:
    "Numbers follow the v1.1.1 section 7 detailed register (11 retention, 12 quality, 13 cost, 14 lineage). Sections 5.3/6.3 of the same PDF and the current 14-controls web page order the last four as 11 quality, 12 retention, 13 lineage, 14 cost. Join evidence on the stable id plus capability and name, never on the bare number; confirm identifiers against current assessment materials before any formal assessment.",
} as const;

/** Evidence layers that must stay separate: policy is not entitlement, use or assessment. */
export const EVIDENCE_LAYERS = {
  normativePolicy:
    "owner mandates (ODRL pilot subset) and agreed data-use grant policies — what is permitted",
  effectiveEntitlement:
    "what the pilot actually enforces: executor authorisation of agent actions and provider transmissions; OS file permissions for stored files. There is NO stored-data entitlement layer (an agent-action mandate is not a data entitlement).",
  observedUse:
    "evidence-ledger activity, outcome, transmission and decision records — what happened, as recorded by the agent (completeness not proven)",
  assessment: "none — no CDMC readiness assessment, audit or certification has been performed",
} as const;

export interface KeyControlMapping {
  /** Project-owned stable identifier (the join key). */
  readonly id: `AW-CDMC-${string}`;
  /** Number in the v1.1.1 section 7 detailed register (NOT a join key; see numberingNote). */
  readonly section7Number: number;
  readonly capability: string;
  /** Control name as pinned for the v1.1.1 PDF baseline. */
  readonly name: string;
  readonly assessmentStatus: "not-assessed";
  readonly applicabilityRationale: string;
  readonly observedArtifacts: readonly string[];
  readonly implementationGaps: readonly string[];
}

const MANAGED =
  "Applicable to any managed deployment holding personal data; no documented applicability exclusion exists.";

/** The 14 Key Controls, pinned by stable id, section 7 number, capability and name. */
export const CDMC_KEY_CONTROLS: readonly KeyControlMapping[] = [
  {
    id: "AW-CDMC-01",
    section7Number: 1,
    capability: "1.1",
    name: "Data Control Compliance",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "resource register + auditAgentDirectory (unregistered files and ownerless resources fail)",
      "reassessment-trigger list",
    ],
    implementationGaps: [
      "no versioned control register with a denominator of in-scope assets",
      "no scheduled or change-driven evidence checks, freshness tracking, alerts or remediation state",
    ],
  },
  {
    id: "AW-CDMC-02",
    section7Number: 2,
    capability: "1.2",
    name: "Ownership Field",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "per-agent audit resolves each resource's accountable owner IRI from local configuration (the party; the operator, or the owner when no operator is configured)",
    ],
    implementationGaps: [
      "identifiers only for the owner/operator in agent configuration; no approval authority, ownerless-asset exception workflow or versioned ownership transfer",
    ],
  },
  {
    id: "AW-CDMC-03",
    section7Number: 3,
    capability: "1.3",
    name: "Authoritative Data Sources and Provisioning Points",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "source text per resource",
      "versioned source-authority rules (CT-03)",
      "UC-02 association provenance",
    ],
    implementationGaps: [
      "no register of authoritative sources AND provisioning points per data/claim class",
      "no detection or exception routing for ingestion through unapproved paths",
    ],
  },
  {
    id: "AW-CDMC-04",
    section7Number: 4,
    capability: "1.4",
    name: "Data Sovereignty and Cross-Border Movement",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: ["host-local storage description", "inventory of some external copies"],
    implementationGaps: [
      "no jurisdiction or actual storage/processing/transit location per copy (mailbox, spool, logs, exports, backups)",
      "no movement rules enforced before disclosure; no provider attestations",
    ],
  },
  {
    id: "AW-CDMC-05",
    section7Number: 5,
    capability: "2.1",
    name: "Cataloging",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: ["static TypeScript register + JSON manifest", "directory audit"],
    implementationGaps: [
      "catalog records are not created at each creation/ingestion path",
      "external and derived stores are not reconciled; no stale/missing reporting across environments",
    ],
  },
  {
    id: "AW-CDMC-06",
    section7Number: 6,
    capability: "2.2",
    name: "Classification",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: ["coarse resource-level class and personalData flag"],
    implementationGaps: [
      "no always-on ingress/creation classification, per-element granularity, classifier evidence or propagation rules",
    ],
  },
  {
    id: "AW-CDMC-07",
    section7Number: 7,
    capability: "3.1",
    name: "Entitlements and Access for Sensitive Data",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "file modes 0600/0700 for keys",
      "owner-mandate evaluation of agent actions and transmissions (normative policy + executor enforcement)",
    ],
    implementationGaps: [
      "no stored-data entitlements at the resource/service boundary; sensitive-data access attempts are not all recorded",
      "no revocation, bypass or entitlement-drift tests for stored-data access",
    ],
  },
  {
    id: "AW-CDMC-08",
    section7Number: 8,
    capability: "3.2",
    name: "Data Consumption Purpose",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "DPV 2.1 purposes on actions and resources",
      "purpose-bound grants in selected domain scenarios",
    ],
    implementationGaps: [
      "purpose is not required on every sensitive-data request, nor enforced on reads of stored files or downstream uses",
    ],
  },
  {
    id: "AW-CDMC-09",
    section7Number: 9,
    capability: "4.1",
    name: "Security Controls",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "JWS integrity with pinned keys",
      "strict outbound byte validation and transmission re-authorisation",
      "local file permissions",
    ],
    implementationGaps: [
      "no approved deployment security baseline; owner and agent keys colocated; no rotation, protected storage, monitoring or recovery evidence",
    ],
  },
  {
    id: "AW-CDMC-10",
    section7Number: 10,
    capability: "4.2",
    name: "Data Protection Impact Assessments",
    assessmentStatus: "not-assessed",
    applicabilityRationale:
      "Open gap for a managed deployment processing personal data; no documented applicability decision excludes it.",
    observedArtifacts: [],
    implementationGaps: [
      "no DPIA trigger or tracking by jurisdiction and on material data-flow, provider or purpose change",
    ],
  },
  {
    id: "AW-CDMC-11",
    section7Number: 11,
    capability: "5.1",
    name: "Data Retention, Archiving and Purging",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "bounded runtime compaction and checkpointed ledger pruning (tested at capacity)",
      "retention text per resource",
      "synthetic lender purpose store: operator-run, bounded purge of expired payloads with payload-free tombstones and data-erased evidence (tested, incl. restart)",
    ],
    implementationGaps: [
      "capacity limits are not approved schedules; no archive, legal hold or deletion evidence across state, calendar, threads, spool, provider copies, reports and backups",
      "the purpose-store purge erases one store's copy only (no secure erase; runtime transcripts, wallets, peer copies and backups are not reached) and is not scheduled — expiry of a grant is not proof of full-system deletion",
    ],
  },
  {
    id: "AW-CDMC-12",
    section7Number: 12,
    capability: "5.2",
    name: "Data Quality Measurement",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: ["schema, digest and key validation checks"],
    implementationGaps: [
      "no quality dimensions, rules, thresholds, owners, time-stamped measurements or alerts",
    ],
  },
  {
    id: "AW-CDMC-13",
    section7Number: 13,
    capability: "6.1",
    name: "Cost Metrics",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: ["file byte counts (not cost evidence)"],
    implementationGaps: ["no metered, attributed cost with source, period and allocation method"],
  },
  {
    id: "AW-CDMC-14",
    section7Number: 14,
    capability: "6.2",
    name: "Data Lineage",
    assessmentStatus: "not-assessed",
    applicabilityRationale: MANAGED,
    observedArtifacts: [
      "coarse derivedFrom per resource",
      "PROV activities/derivations in selected runtime evidence (RDF export)",
    ],
    implementationGaps: [
      "no versioned, cross-copy, cross-boundary lineage with coverage/freshness reporting or point-in-time reconstruction",
    ],
  },
];

/** The full-framework assessment target: an explicit gap, not fourteen feature flags. */
export const ASSESSMENT_TARGET = {
  baseline: CDMC_BASELINE.framework,
  scope:
    "all 6 components / 14 capabilities / 37 sub-capabilities for a defined assessment subject",
  status: "not-started",
  subject: "undefined: pilot software, hosted agent solution or operated deployment must be chosen",
  prerequisites: [
    "define the assessment subject and inventory every store, provider and responsible party",
    "a 37-sub-capability crosswalk with applicability decisions, responsibilities and evidence (the licensed text is not reproduced here)",
    "dated evidence bundles from an operated, non-synthetic reference deployment",
    "current EDM Association assessment materials; a readiness assessment before any compliance wording",
  ],
  claimLadder: [
    "'designed to support CDMC v1.1.1' only after the complete requirement/evidence mapping exists",
    "'readiness assessed' only for a dated, scoped assessment",
    "'CDMC certified' only after an Authorized Partner assessment and EDM Association award",
  ],
} as const;
