/**
 * Resource-governance metadata for a MANAGED deployment phase (requirements R16–R18).
 *
 * This module establishes what a managed deployment needs to know about every resource the
 * pilot retains — owner role, source, classification, purpose, location, retention and
 * disposal, lineage, access path, copies — and audits an agent directory against that
 * register, failing when a retained file has no governance entry (R17: fail safely when
 * required information is missing).
 *
 * It is NOT a CDMC assessment and makes NO CDMC compliance claim. The key-control register
 * (`cdmc.ts`) is pinned to CDMC Framework v1.1.1 (September 2021) per
 * reports/CDMC-SOURCE-REVIEW.md, and keeps normative policy, effective entitlement, observed
 * use and assessment as separate evidence layers. Accountable owners are resolved to the
 * identifiers in local agent configuration; organisational governance decisions (approval
 * authority, applicability, assessment subject) are not made here.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ASSESSMENT_TARGET, CDMC_BASELINE, CDMC_KEY_CONTROLS, EVIDENCE_LAYERS } from "./cdmc.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { DEFAULT_RETENTION } from "./runtime/retention.js";
import { DEFAULT_LEDGER_BOUNDS } from "./store/ledger.js";

export type Classification =
  | "secret-key-material"
  | "personal-data"
  | "personal-data-derived"
  | "operational-evidence"
  | "configuration"
  | "public";

export interface GovernedResource {
  readonly id: string;
  /** Paths relative to the agent directory (glob-like: `*` matches within one segment). */
  readonly paths: readonly string[];
  readonly description: string;
  /** Accountable role (a deployment assigns the person/organisation). */
  readonly ownerRole: "owner" | "operator";
  /** Where the content comes from. */
  readonly source: string;
  readonly classification: Classification;
  readonly personalData: boolean;
  readonly purposes: readonly string[];
  /** Storage location as implemented (jurisdiction is a deployment decision). */
  readonly location: string;
  readonly retention: string;
  readonly disposal: string;
  /** Other register ids (or external inputs) this resource is derived from. */
  readonly derivedFrom: readonly string[];
  readonly access: string;
  /** Copies outside this resource that governance must also cover. */
  readonly copies: readonly string[];
  readonly qualityChecks: readonly string[];
}

const LOCAL = "local filesystem of the host running the agent (single directory per agent)";
const PROCESS_ACCESS =
  "any OS principal able to read the agent directory; no per-record entitlement enforcement in the pilot";

export const RESOURCE_REGISTER: readonly GovernedResource[] = [
  {
    id: "keys",
    paths: ["keys/owner.private.jwk.json", "keys/actor.private.jwk.json"],
    description:
      "Synthetic actor private signing key (JWK), and — ONLY in the colocated compatibility layout (`init` without --owner-dir, or directories from before phase 7) — the owner's private key.",
    ownerRole: "owner",
    source: "generated locally at `init`",
    classification: "secret-key-material",
    personalData: false,
    purposes: [
      "sign protocol messages (actor key); owner approvals / mandates (owner key, colocated layout only)",
    ],
    location: `${LOCAL}; directory mode 0700, files 0600`,
    retention: "until the agent is removed or keys are rotated (rotation not implemented)",
    disposal: "file deletion; no secure erase, no key-destruction attestation",
    derivedFrom: [],
    access:
      "file mode restricts to the OS user; the running service never reads the owner key (explicit owner-signing commands only); with --owner-dir the owner key is not here at all",
    copies: ["backups of the host (not managed)"],
    qualityChecks: ["public thumbprints (RFC 7638) printed at init for out-of-band comparison"],
  },
  {
    id: "identity-and-grants",
    paths: ["identity.json", "mandate.jws", "representation.jws", "card.json"],
    description:
      "Agent identity (IRIs, e-mail address), owner mandate, representation statement, public card.",
    ownerRole: "owner",
    source: "created at `init` (owner-signed statements)",
    classification: "personal-data",
    personalData: true,
    purposes: ["identify the agent and its bounded authority to peers"],
    location: LOCAL,
    retention: "until superseded; revocations persist in state.json",
    disposal: "file deletion; revocation is recorded, not the deletion",
    derivedFrom: ["keys"],
    access: PROCESS_ACCESS,
    copies: ["card.json is shared with peers at introduction (peer copies not controlled)"],
    qualityChecks: ["JWS verification on load; mandate validity window"],
  },
  {
    id: "trust-store",
    paths: ["trust.json"],
    description: "Pinned peer verification material and scoped source-authority rules.",
    ownerRole: "owner",
    source: "reviewed introductions (`pin` after thumbprint comparison)",
    classification: "configuration",
    personalData: true,
    purposes: ["verify peer statements; decide source authority"],
    location: LOCAL,
    retention: "until the pin is removed (no expiry of pins in the pilot)",
    disposal: "file edit/deletion",
    derivedFrom: ["peer cards"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["rule dates validated (ISO instants, validFrom < validUntil)"],
  },
  {
    id: "runtime-state",
    paths: ["state.json", "state.json.tmp", "state.json.lock", "state.json.lock.recovering"],
    description:
      "Conversations, replay window, effects, outbox (with the authorised intent per message), provider-transmission records, approvals, tasks, revocations (plus the write temp file and the single-writer lock).",
    ownerRole: "operator",
    source: "runtime",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.scheduling],
    location: LOCAL,
    retention:
      `closed conversations ${DEFAULT_RETENTION.closedRetentionMs / 86_400_000} d / max ${DEFAULT_RETENTION.maxClosedConversations}; ` +
      `tasks ${DEFAULT_RETENTION.taskRetentionMs / 86_400_000} d / max ${DEFAULT_RETENTION.maxTasks}; ` +
      `retained conversations+tasks max ${DEFAULT_RETENTION.maxRetainedConversations}; ` +
      "never compacted: open conversations, unresolved/uncertain effects, owed receipts, pending approvals, live replay entries, undelivered outbox",
    disposal:
      "compaction removes entries from the snapshot; prior bytes may persist in filesystem/backups",
    derivedFrom: ["inbound messages", "identity-and-grants"],
    access: PROCESS_ACCESS,
    copies: ["outbound spool files", "host backups (not managed)"],
    qualityChecks: ["schema normalisation on load; atomic write + fsync; lock ownership token"],
  },
  {
    id: "evidence-ledger",
    paths: ["ledger.jsonl", "ledger.jsonl.seg-*"],
    description:
      "Hash-chained evidence records (verification, assessments, decisions, agreements, activities, outcomes).",
    ownerRole: "operator",
    source: "runtime enforcement components",
    classification: "operational-evidence",
    personalData: true,
    purposes: ["accountability and audit of the agent's actions"],
    location: LOCAL,
    retention: `segments of ${DEFAULT_LEDGER_BOUNDS.segmentMaxEntries} entries; at most ${DEFAULT_LEDGER_BOUNDS.maxSegments} archived segments; pruning writes a checkpoint first`,
    disposal:
      "oldest segment deleted after a checkpoint; the chain proves order of retained entries, not completeness",
    derivedFrom: ["runtime-state", "inbound messages"],
    access: PROCESS_ACCESS,
    copies: ["RDF/JSON exports (reports/pilot-rdf-evidence.*) are derived copies"],
    qualityChecks: ["verify-ledger (hash chain, sequence, checkpoint attestation)"],
  },
  {
    id: "calendar",
    paths: ["calendar.json"],
    description: "SYNTHETIC calendar (working hours, busy periods, holds).",
    ownerRole: "owner",
    source: "synthetic defaults + runtime holds",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.scheduling],
    location: LOCAL,
    retention: "unbounded in the pilot (synthetic)",
    disposal: "file deletion",
    derivedFrom: ["runtime-state"],
    access: PROCESS_ACCESS,
    copies: ["peer calendars hold the agreed slot (not controlled)"],
    qualityChecks: ["hold idempotency by effect key"],
  },
  {
    id: "availability-settings",
    paths: ["availability.json", "availability.json.tmp"],
    description:
      "Availability the owner chose in the dashboard (time zone, working hours, busy periods of the chosen synthetic calendars, or a fail-closed block). Read at agent start; written only by the owner's dashboard.",
    ownerRole: "owner",
    source: "owner dashboard (explicit apply)",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.scheduling],
    location: LOCAL,
    retention: "until the owner applies new settings",
    disposal: "file deletion (without it the agent uses its own calendar only)",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: ["the dashboard's own settings file (source of truth)"],
    qualityChecks: ["schema validation at start; an invalid file blocks scheduling"],
  },
  {
    id: "email-threads",
    paths: ["threads.json"],
    description: "Mapping of conversation ids to e-mail thread ids / Message-IDs for replies.",
    ownerRole: "operator",
    source: "email binding",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.scheduling],
    location: LOCAL,
    retention: "unbounded in the pilot (GAP: should follow runtime-state compaction)",
    disposal: "file deletion",
    derivedFrom: ["inbound messages"],
    access: PROCESS_ACCESS,
    copies: ["the provider mailbox (outside the pilot)"],
    qualityChecks: [],
  },
  {
    id: "service-associations",
    paths: ["associations.json"],
    description:
      "UC-02 contact→scheduling-link associations with provenance (sender, message id, forwarded flag), status and validity.",
    ownerRole: "owner",
    source: "extracted from inbound e-mail; promoted only by an owner-signed approval",
    classification: "personal-data-derived",
    personalData: true,
    purposes: [PURPOSE.scheduling],
    location: LOCAL,
    retention:
      "max 500 associations, 5 candidates per contact; accepted entries valid 90 d; expired/superseded pruned",
    disposal:
      "entry removal; deleting the source e-mail does not delete the association, and provider-side copies are not controlled",
    derivedFrom: ["inbound messages"],
    access: PROCESS_ACCESS,
    copies: ["the provider's booking record (reference service only in the pilot)"],
    qualityChecks: [
      "registry classification (host/path/port/query/canonical form); re-check before use",
    ],
  },
  {
    id: "service-configuration",
    paths: ["services.json"],
    description:
      "Operator-configured API base per supported scheduling service (the only request targets).",
    ownerRole: "operator",
    source: "`configure-service` (reviewed operator input)",
    classification: "configuration",
    personalData: false,
    purposes: ["route bookings to reviewed endpoints"],
    location: LOCAL,
    retention: "until changed",
    disposal: "file edit/deletion",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["validateApiBase: loopback http or https origin only"],
  },
  {
    id: "policy-module",
    paths: ["policy-engine.json"],
    description:
      "The recorded policy module (SPARQ by default): engine, absolute path and SHA-256 of the probed sparq-policy-decide binary, reported evaluator identity, and the replaced record.",
    ownerRole: "operator",
    source: "`init` / `policy-engine` (reviewed operator input, after a probe of the binary)",
    classification: "configuration",
    personalData: false,
    purposes: ["decide mandate and grant policies with a pinned evaluator"],
    location: LOCAL,
    retention: "until changed",
    disposal:
      "file edit/deletion; a directory initialised with a record then fails closed (every decision indeterminate) until re-pinned",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: [
      "probe: permit for a broad permission, indeterminate when a prohibition may apply",
      "binary digest re-checked at every open; mismatch or absence makes every decision indeterminate",
    ],
  },
  {
    id: "mortgage-wallet",
    paths: ["wallet.json"],
    description:
      "SYNTHETIC mortgage consumer wallet: issuer-signed evidence statements (payroll, deposit) the consumer may relay under agreed terms (role mortgage-consumer).",
    ownerRole: "owner",
    source: "`init --role mortgage-consumer --wallet FILE` (synthetic issuance; validated subject)",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.creditChecking],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed (synthetic)",
    disposal: "file deletion; disclosed copies at the lender are governed by the lender's grant",
    derivedFrom: ["synthetic issuers"],
    access: PROCESS_ACCESS,
    copies: ["the lender's purpose-bound store (under the agreed data-use grant)"],
    qualityChecks: ["schema validation at init and open; issuer signatures verified by the lender"],
  },
  {
    id: "purpose-bound-store",
    paths: [
      "data-store.json",
      "data-store.json.tmp",
      "data-store-ledger.jsonl",
      "data-store-ledger.jsonl.seg-*",
    ],
    description:
      "SYNTHETIC lender enforcement point (role mortgage-lender): evidence stored under the data-use grant derived from the agreed terms, and the enforcement point's own hash-chained decision ledger (payload-free).",
    ownerRole: "operator",
    source: "verified, source-authorised evidence received under an agreement",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.creditChecking],
    location: `${LOCAL}; data file 0600`,
    retention:
      "grant validUntil (agreed retention); access after expiry is denied; the explicit, bounded `purge_expired` operation (≤100 items per call, operator-run, not scheduled) erases expired payloads",
    disposal:
      "purge rewrites the store file without the payload and keeps a payload-free tombstone (id, claim type, source, grant id + policy digest, dates); logs payload-free `data-erased`. Not a secure erase: prior bytes may persist in the filesystem and backups; runtime state/ledger, the consumer's wallet and the underwriter's copy are not reached",
    derivedFrom: ["mortgage-wallet (the consumer's disclosure)", "evidence-ledger"],
    access:
      "internal access only through the enforcement point (internal delegation AND the consumer's grant); the file itself: " +
      PROCESS_ACCESS,
    copies: ["attenuated fields disclosed to the underwriter under the onward rule"],
    qualityChecks: [
      "idempotent put (same digest) / refusal of a different item under an existing id",
      "every access decision logged without payloads",
    ],
  },
  {
    id: "mortgage-workflow",
    paths: ["mortgage-workflow.json", "mortgage-workflow.json.tmp"],
    description:
      "Per-application once-only markers of the lender's operator steps (underwriting requested, decision receipt sent).",
    ownerRole: "operator",
    source: "lender operator operations",
    classification: "operational-evidence",
    personalData: false,
    purposes: [PURPOSE.creditChecking],
    location: LOCAL,
    retention: "until the agent is removed (synthetic)",
    disposal: "file deletion",
    derivedFrom: ["runtime-state"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["atomic write; operations refuse a repeated step"],
  },
  {
    id: "a2a-listener",
    paths: ["a2a.json", "a2a.json.tmp"],
    description:
      "Optional loopback A2A listener configuration: address (127.0.0.1/::1), port and the local API access token (not authority).",
    ownerRole: "operator",
    source: "`a2a-config` (reviewed operator input; token generated locally)",
    classification: "secret-key-material",
    personalData: false,
    purposes: ["admit pinned local peers to the A2A carrier"],
    location: `${LOCAL}; file 0600`,
    retention: "until changed or rotated (`a2a-config --rotate`)",
    disposal: "file deletion; rotation invalidates copies held by peers",
    derivedFrom: [],
    access: "file mode restricts to the OS user",
    copies: ["the connection card handed to the peer operator (out of band)"],
    qualityChecks: ["schema: loopback literal host, port range, 256-bit token"],
  },
  {
    id: "a2a-peers",
    paths: ["a2a-peers.json", "a2a-peers.json.tmp"],
    description:
      "Pinned A2A peer endpoints: actor → loopback URL + that peer's access token (no discovery).",
    ownerRole: "operator",
    source: "`a2a-pin` from a peer's connection card; the actor's keys must already be pinned",
    classification: "secret-key-material",
    personalData: false,
    purposes: ["deliver signed envelopes to pinned peers"],
    location: `${LOCAL}; file 0600`,
    retention: "until changed",
    disposal: "file edit/deletion",
    derivedFrom: ["trust-store"],
    access: "file mode restricts to the OS user",
    copies: [],
    qualityChecks: [
      "loopback literal URL, fixed path, no credentials/query; checked at every open",
    ],
  },
  {
    id: "public-carriage",
    paths: [
      "public-http.json",
      "public-http.json.tmp",
      "public-peers.json",
      "public-peers.json.tmp",
    ],
    description:
      "Anonymous public carriage: this service's loopback listener (address, port — no token) and/or the pinned public services this agent may ask (actor → loopback URL).",
    ownerRole: "operator",
    source: "`public-config` / `public-pin` (the service's keys must already be pinned)",
    classification: "configuration",
    personalData: false,
    purposes: ["carry anonymous public requests and signed public responses"],
    location: `${LOCAL}; file 0600`,
    retention: "until changed",
    disposal: "file edit/deletion",
    derivedFrom: ["trust-store"],
    access: PROCESS_ACCESS,
    copies: ["the endpoint card handed to requesters (public information)"],
    qualityChecks: ["loopback literal URL, fixed path; checked at every open"],
  },
  {
    id: "public-replies",
    paths: ["public-replies.json", "public-replies.json.tmp"],
    description:
      "Requester's durable spool of RECEIVED public replies (signed public responses, e.g. retailer plan lists) not yet processed: written before the request counts as sent; removed once every response was processed by the runtime and the request retired.",
    ownerRole: "operator",
    source: "public dispatcher (anonymous public carriage)",
    classification: "operational-evidence",
    personalData: false,
    purposes: ["recover received public replies after an interruption"],
    location: `${LOCAL}; file 0600`,
    retention:
      "until processed (normally the same dispatch); at most 64 reply sets of ≤ 256 KiB each; new requests are held while it is full",
    disposal: "entry removed after processing (file rewrite); not a secure erase",
    derivedFrom: ["signed public responses of pinned public services"],
    access: PROCESS_ACCESS,
    copies: ["processed responses live on in the runtime state (conversation, domain state)"],
    qualityChecks: [
      "schema-validated at every read (fails closed); responses verified by the runtime",
    ],
  },
  {
    id: "issuer-key",
    paths: ["keys/issuer.private.jwk.json"],
    description:
      "A role's own ISSUING key (e.g. an access-grant issuer, a data-authority issuer): separate from the owner key and the actor key.",
    ownerRole: "operator",
    source: "generated at `init` for roles that issue statements",
    classification: "secret-key-material",
    personalData: false,
    purposes: ["sign statements the role issues (verified by peers that pinned its public card)"],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed (no rotation)",
    disposal: "file deletion; no secure erase",
    derivedFrom: [],
    access: "file mode restricts to the OS user; read by the running service",
    copies: ["public card (`issuer-card`) pinned by peers"],
    qualityChecks: ["peers pin the public card at THEIR provisioning, never from a message"],
  },
  {
    id: "health-revocations",
    paths: ["revocations.json", "revocations.json.tmp"],
    description:
      "Grant revocations a health service accepted (version 2: grant id, patient principal, compartment, grant expiry, time) after verifying the patient's signature AND that the issuer-signed grant it carries belongs to that patient. Also the basis of send-time refusal of queued searchsets.",
    ownerRole: "operator",
    source: "operator operation accept_revocation (patient-signed statement carrying the grant)",
    classification: "operational-evidence",
    personalData: true,
    purposes: [PURPOSE.personalHealthSummary],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed (a revocation must outlive its grant)",
    disposal: "file deletion (would re-enable a revoked, unexpired grant — do not delete early)",
    derivedFrom: ["patient-signed GrantRevocation", "issuer-signed AccessGrant"],
    access: PROCESS_ACCESS,
    copies: ["each enforcing server keeps its own copy (no propagation protocol)"],
    qualityChecks: [
      "revocation verified against the pinned patient key; grant verified against the pinned issuer key; grant.patient = revoking patient",
    ],
  },
  {
    id: "patient-enrollments",
    paths: ["patient-enrollments.json", "patient-enrollments.json.tmp"],
    description:
      "The CLINIC's enrollment register at the authorisation service: which authenticated patient principal owns which compartment (principal → patientId). Issuance fails closed without a matching entry.",
    ownerRole: "operator",
    source:
      "clinic operator at init (`--role-input enrollments=FILE`; `synthetic-health` writes a synthetic one)",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.personalHealthSummary],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed or re-provisioned",
    disposal: "file deletion (then nothing is issued)",
    derivedFrom: ["clinic registration (synthetic)"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: [
      "schema-validated; a register binding one principal or compartment twice is refused",
    ],
  },
  {
    id: "health-patient-config",
    paths: ["health-patient.json", "health-patient.json.tmp"],
    description:
      "The compartment id a patient agent ASKS for by default (a claim; the clinic's enrollment register decides).",
    ownerRole: "owner",
    source: "init `--role-input patient-id=VALUE`",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.personalHealthSummary],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed",
    disposal: "file deletion",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: ["sent in each authorisation request and read"],
    qualityChecks: ["schema-validated"],
  },
  {
    id: "fhir-resources",
    paths: ["fhir-resources.json"],
    description: "SYNTHETIC FHIR R4 resources a resource service holds for one synthetic patient.",
    ownerRole: "operator",
    source: "`init --role health-resource --role-input resources=FILE` (hand-authored fixtures)",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.personalHealthSummary],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed (synthetic)",
    disposal: "file deletion",
    derivedFrom: [],
    access: "released only under a valid, unrevoked, client-bound grant with the matching scope",
    copies: ["the patient agent's validated copy (runtime domain state)"],
    qualityChecks: ["shape bounded at init; the patient agent validates each resource"],
  },
  {
    id: "health-summaries",
    paths: ["health-summaries.json", "health-summaries.json.tmp"],
    description:
      "Patient agent's minimised summaries: statements citing resource id/version/source, unresolved contradictions, validation results.",
    ownerRole: "owner",
    source: "patient agent operation summarise",
    classification: "personal-data-derived",
    personalData: true,
    purposes: [PURPOSE.personalHealthSummary],
    location: `${LOCAL}; file 0600`,
    retention: "unbounded in the pilot (GAP)",
    disposal: "file deletion",
    derivedFrom: ["runtime-state (validated resources)"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["every statement cites Type/id/_history/version @ source"],
  },
  {
    id: "energy-retailer-plans",
    paths: ["energy-plans.json"],
    description: "SYNTHETIC public plan list a retailer serves to anyone (model version, access).",
    ownerRole: "operator",
    source: "`init --role energy-retailer --role-input plans=FILE`",
    classification: "public",
    personalData: false,
    purposes: [PURPOSE.priceComparison],
    location: LOCAL,
    retention: "until changed",
    disposal: "file deletion",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: ["every requester receives the signed list"],
    qualityChecks: ["shape bounded at init; comparators validate each plan against their model"],
  },
  {
    id: "energy-household",
    paths: ["energy-household.json"],
    description:
      "SYNTHETIC household profile held LOCALLY by the comparator (household marker, distributor zone, usage curve); never sent to retailers.",
    ownerRole: "owner",
    source: "`init --role energy-comparator --role-input profile=FILE`",
    classification: "personal-data",
    personalData: true,
    purposes: [PURPOSE.priceComparison],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed (synthetic)",
    disposal: "file deletion",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: ["comparison outputs derived from it (energy-comparisons)"],
    qualityChecks: ["schema at init (48 usage points, zone, days)"],
  },
  {
    id: "energy-comparisons",
    paths: [
      "energy-rounds.json",
      "energy-rounds.json.tmp",
      "energy-comparisons.json",
      "energy-comparisons.json.tmp",
    ],
    description:
      "Comparator request rounds (retailer → conversation) and comparison outputs with provenance (source message ids and digests, retailer-asserted vs derived figures, exclusions).",
    ownerRole: "owner",
    source: "comparator operations request_plans / compare_plans",
    classification: "personal-data-derived",
    personalData: true,
    purposes: [PURPOSE.priceComparison],
    location: `${LOCAL}; files 0600`,
    retention: "unbounded in the pilot (GAP)",
    disposal: "file deletion",
    derivedFrom: ["energy-household", "runtime-state (signed plan lists)"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["deterministic re-computation recorded with each comparison"],
  },
  {
    id: "industrial-provider-config",
    paths: ["industrial-provider.json", "industrial-provider.json.tmp"],
    description:
      "SYNTHETIC telemetry provider (role industrial-provider): which EquipmentHealth model version this endpoint offers. Agreements and deliveries live in the runtime state.",
    ownerRole: "operator",
    source: "init --role-input model=",
    classification: "configuration",
    personalData: false,
    purposes: [PURPOSE.maintenance],
    location: `${LOCAL}; file 0600`,
    retention: "until the agent is removed",
    disposal: "file deletion",
    derivedFrom: [],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: ["schema-validated at init and at every start"],
  },
  {
    id: "industrial-membership",
    paths: ["industrial-membership.json", "industrial-membership.json.tmp"],
    description:
      "SYNTHETIC programme participant credential NordWerk's contracting agent presents (eligibility only; says nothing about which internal agent may bind NordWerk).",
    ownerRole: "operator",
    source: "init --role-input membership= (`synthetic-industrial`)",
    classification: "configuration",
    personalData: false,
    purposes: [PURPOSE.maintenance],
    location: `${LOCAL}; file 0600`,
    retention: "credential validUntil; replaced at re-provisioning",
    disposal: "file deletion",
    derivedFrom: ["synthetic test-programme issuer (private key discarded)"],
    access: PROCESS_ACCESS,
    copies: [
      "sent as evidence with each offer negotiation (the provider's runtime state keeps it)",
    ],
    qualityChecks: ["subject must be NordWerk; the provider verifies it against the pinned issuer"],
  },
  {
    id: "nordwerk-purpose-store",
    paths: [
      "nordwerk-data-store.json",
      "nordwerk-data-store.json.tmp",
      "nordwerk-data-store-ledger.jsonl",
      "nordwerk-data-store-ledger.jsonl.seg-*",
    ],
    description:
      "SYNTHETIC recipient enforcement point (role industrial-contracting): telemetry stored under the usage policy derived from the agreement, and the enforcement point's own payload-free decision ledger. Internal reads are decided for the VERIFIED requesting agent.",
    ownerRole: "operator",
    source: "telemetry received under an agreement (source-authority assessed)",
    classification: "operational-evidence",
    personalData: false,
    purposes: [PURPOSE.maintenance],
    location: `${LOCAL}; data file 0600`,
    retention:
      "grant validUntil (agreed retentionDays); access after expiry is denied; no purge operation is exposed for this role (GAP)",
    disposal: "file deletion; not a secure erase",
    derivedFrom: ["runtime-state (agreement + transfer)"],
    access:
      "internal access only through the enforcement point (NordWerk internal roles AND the agreed usage policy); the file itself: " +
      PROCESS_ACCESS,
    copies: [
      "released samples reach the requesting internal agent, which keeps only its derived assertion; copies outside the enforcement point are not controlled",
    ],
    qualityChecks: [
      "model version must equal the agreement's; source-authority recorded per dataset",
    ],
  },
  {
    id: "industrial-work-orders",
    paths: ["industrial-work-orders.json", "industrial-work-orders.json.tmp"],
    description:
      "SYNTHETIC work orders the planner created after ACCEPTING a recommendation (effect key → id, status). Creation is not performance: performance is a separate simulated observation.",
    ownerRole: "operator",
    source:
      "effect workorder.create (runtime effect record) and operator operation record_performance",
    classification: "operational-evidence",
    personalData: false,
    purposes: [PURPOSE.maintenance],
    location: `${LOCAL}; file 0600`,
    retention: "unbounded in the pilot (GAP)",
    disposal: "file deletion",
    derivedFrom: ["runtime-state (agreement, effect records)"],
    access: PROCESS_ACCESS,
    copies: [],
    qualityChecks: [
      "saved before the effect reports completion; effect keys prevent a second order",
    ],
  },
];

/** Resources outside the agent directory that a managed deployment must also register. */
export const EXTERNAL_RESOURCES: readonly { id: string; description: string; gap: string }[] = [
  {
    id: "owner-key-directory",
    description:
      "separate owner custody (`init --owner-dir DIR`): DIR/<name>/owner.private.jwk.json (dir 0700, file 0600), read only by owner-signing commands (sign-approval, approve, confirm-association) given --owner-dir",
    gap: "same OS user and host as the service: a filesystem boundary, not hardware custody or OS isolation; no rotation, no backup policy",
  },
  {
    id: "spool",
    description:
      "serve spool in/out/done/rejected files (inbound MIME, reviewed outbound payloads, reports)",
    gap: "no retention policy; operator-managed directory",
  },
  {
    id: "provider-mailbox",
    description: "the e-mail provider's copies of sent/received messages",
    gap: "outside the pilot; no live provider used",
  },
  {
    id: "domain-purpose-stores",
    description:
      "purpose stores of the in-process fixture scenarios (energy, FHIR, industrial, mortgage demo)",
    gap: "in-memory only; the durable stores are registered: mortgage lender (purpose-bound-store), NordWerk recipient (nordwerk-purpose-store)",
  },
  {
    id: "reports",
    description: "demo/integration/RDF reports under reports/",
    gap: "synthetic only; contain synthetic identifiers, no private keys (checked)",
  },
  {
    id: "backups",
    description: "host backups and filesystem snapshots",
    gap: "not managed; compaction/pruning does not reach them",
  },
];

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`,
  );
  return re.test(path);
}

const REQUIRED: readonly (keyof GovernedResource)[] = [
  "ownerRole",
  "source",
  "classification",
  "purposes",
  "location",
  "retention",
  "disposal",
  "access",
];

/** Required metadata missing from a register entry (R17). */
export function missingMetadata(r: GovernedResource): string[] {
  return REQUIRED.filter((k) => {
    const v = r[k];
    return v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

/** Accountable identifiers from local agent configuration (never inferred from files). */
export interface AccountableParties {
  /** The represented party (owner) IRI. */
  readonly owner?: string;
  /** The operator IRI, if configured (`init --operator`). */
  readonly operator?: string;
}

export interface GovernanceAudit {
  readonly directory: string;
  readonly files: readonly { path: string; resource?: string; bytes: number }[];
  readonly unregistered: readonly string[];
  readonly incompleteEntries: readonly { id: string; missing: string[] }[];
  /** Per register entry: the accountable identifier and how it was assigned. */
  readonly ownership: readonly { resource: string; accountable?: string; basis: string }[];
  /** Register entries with no accountable identifier (an exception, fails the audit). */
  readonly ownerless: readonly string[];
  readonly ok: boolean;
}

function accountableFor(
  r: GovernedResource,
  parties: AccountableParties,
): { accountable?: string; basis: string } {
  if (r.ownerRole === "owner")
    return parties.owner
      ? { accountable: parties.owner, basis: "owner role: represented party in agent identity" }
      : { basis: "owner role: no party configured" };
  if (parties.operator)
    return { accountable: parties.operator, basis: "operator role: configured operator" };
  return parties.owner
    ? {
        accountable: parties.owner,
        basis: "operator role: no operator configured, so the owner operates the agent",
      }
    : { basis: "operator role: neither operator nor party configured" };
}

/**
 * Audit an agent directory: every retained file must match a complete register entry, and
 * (when `parties` is given) every entry must resolve to an accountable identifier.
 */
export function auditAgentDirectory(
  dir: string,
  parties?: AccountableParties,
  register: readonly GovernedResource[] = RESOURCE_REGISTER,
): GovernanceAudit {
  const files: { path: string; resource?: string; bytes: number }[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const rel = relative(dir, p).split("\\").join("/");
        const resource = register.find((r) => r.paths.some((pat) => matches(pat, rel)))?.id;
        files.push({ path: rel, ...(resource ? { resource } : {}), bytes: st.size });
      }
    }
  };
  walk(dir);
  const unregistered = files.filter((f) => !f.resource).map((f) => f.path);
  const incompleteEntries = register
    .map((r) => ({ id: r.id, missing: missingMetadata(r) }))
    .filter((x) => x.missing.length > 0);
  const ownership = parties
    ? register.map((r) => ({ resource: r.id, ...accountableFor(r, parties) }))
    : [];
  const ownerless = ownership.filter((o) => !o.accountable).map((o) => o.resource);
  return {
    directory: dir,
    files,
    unregistered,
    incompleteEntries,
    ownership,
    ownerless,
    ok: unregistered.length === 0 && incompleteEntries.length === 0 && ownerless.length === 0,
  };
}

/** R18: events that invalidate the governance evidence and require reassessment. */
export const REASSESSMENT_TRIGGERS: readonly string[] = [
  "a change to any register entry, retention constant or ledger bound",
  "a new retained file type in the agent directory (audit fails until registered)",
  "a new provider, binding or live endpoint (none are live in the pilot)",
  "a policy/mandate model or evaluator version change",
  "a storage or key-management change",
  "a change of accountable owner or operator identifier",
];

export function governanceManifest(audit?: GovernanceAudit) {
  return {
    manifest: "Agentic Web pilot — resource governance metadata",
    notice:
      "Metadata and engineering gap notes for a managed deployment phase. NOT a CDMC assessment: the pilot is not CDMC compliant, assessed or certified, and no CDMC compliance is claimed.",
    cdmcBaseline: CDMC_BASELINE,
    evidenceLayers: EVIDENCE_LAYERS,
    resources: RESOURCE_REGISTER,
    externalResources: EXTERNAL_RESOURCES,
    cdmcKeyControls: CDMC_KEY_CONTROLS,
    assessmentTarget: ASSESSMENT_TARGET,
    reassessmentTriggers: REASSESSMENT_TRIGGERS,
    ...(audit ? { audit } : {}),
  };
}
