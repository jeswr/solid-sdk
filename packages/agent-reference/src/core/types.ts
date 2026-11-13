/**
 * The transport-neutral interaction model (framework draft parts A1, A2, A4, A6, A8, A11).
 *
 * Nothing in this module knows about JWS, email, files or ODRL. A binding carries a
 * {@link Message}; a mechanism profile protects it; a storage service persists the
 * records. The distinctions the draft insists on are separate types here:
 *
 *  - a REQUEST (propose / invoke message) is not an AGREEMENT (formed by an accept);
 *  - a GRANT (mandate, data-use grant, access grant) is not a DECISION evaluated under it;
 *  - an ACTIVITY (what the executor attempted) is not an OUTCOME (what was observed and
 *    concluded) — and an outcome can be `uncertain`;
 *  - VERIFICATION, REPRESENTATION, SOURCE AUTHORITY and AUTHORISATION are four records
 *    with four outcomes, never one "trusted" flag.
 */

/** An identifier (IRI or URN). Opaque to the core. */
export type Iri = string;

/** JSON values allowed in bodies (the wire serialisation is chosen by a profile). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/**
 * Who produced a statement (A1). `actor` is the software agent that produced (and, under
 * the signed configurations, signed) the message; `onBehalfOf` is the represented party;
 * `operator` is who runs the software. All three are CLAIMS until assessed. `actor` is
 * absent only under a configuration that permits anonymous requests.
 */
export interface ParticipantRef {
  readonly actor?: Iri;
  readonly onBehalfOf?: Iri;
  readonly operator?: Iri;
}

/** The intended audience of a message. Absent only for public responses. */
export interface AudienceRef {
  readonly actor: Iri;
  readonly party?: Iri;
}

/** A versioned reference to an operation definition. */
export interface OperationRef {
  readonly id: Iri;
  readonly version: string;
}

export const MESSAGE_KINDS = [
  "describe",
  "description",
  "propose",
  "accept",
  "refuse",
  "invoke",
  "deliver",
  "receipt",
  "unsupported",
  "indeterminate",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Stable reason codes for refusals, unsupported and indeterminate outcomes and local
 * rejections. A reason code explains an outcome; it never grants anything.
 */
export const REASON_CODES = [
  // integrity / authentication (local rejections, not replied to)
  "malformed",
  "bounds-exceeded",
  "unsigned-not-allowed",
  "unknown-key",
  "bad-signature",
  "disallowed-header",
  "configuration-mismatch",
  "sender-key-mismatch",
  "wrong-audience",
  "expired",
  "not-yet-valid",
  "lifetime-too-long",
  "replay-conflict",
  "capacity",
  // binding
  "no-structured-content",
  "conflicting-structured-copies",
  "human-parity-mismatch",
  // interaction
  "unsupported-profile",
  "unsupported-configuration",
  "unsupported-operation",
  "unsupported-kind",
  "unsupported-term",
  "protocol-violation",
  "terms-digest-mismatch",
  "round-limit",
  "conversation-closed",
  // representation / authority / authorisation
  "representation-missing",
  "representation-invalid",
  "representation-expired",
  "representation-out-of-scope",
  "source-not-authoritative",
  "evidence-invalid",
  "not-authorised",
  "mandate-invalid",
  "approval-required",
  "approval-denied",
  "missing-context",
  "indeterminate-policy",
  "grant-invalid",
  "grant-expired",
  "grant-revoked",
  "insufficient-scope",
  "purpose-not-permitted",
  "no-agreement",
  // domain
  "invalid-terms",
  "no-acceptable-slot",
  "fee-not-acceptable",
  "excessive-scope",
  "stale-data",
  "credentials-required",
  "execution-failed",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** A protected statement carried alongside a message (A1 relay, A6 evidence). */
export interface EvidenceItem {
  /** What the item is offered as. The receiver decides what it establishes. */
  readonly role:
    | "representation"
    | "approval"
    | "credential"
    | "grant"
    | "membership"
    | "authorisation";
  /** The protection format (a mechanism profile identifier, e.g. `jws-compact`). */
  readonly format: string;
  /** The protected statement itself. */
  readonly value: string;
}

/**
 * Basis on which an invocation or delivery is made. `represented` = the requester asks as
 * the represented party's agent; the responder decides under its own rules (no prior grant).
 */
export type Basis =
  | { readonly kind: "agreement"; readonly agreement: Iri }
  | { readonly kind: "public" }
  | { readonly kind: "represented" }
  | { readonly kind: "grant"; readonly grant: Iri }
  | { readonly kind: "invocation"; readonly invocation: Iri };

export interface DescribeBody {
  readonly want?: readonly string[];
}
export interface DescriptionBody {
  readonly description: JsonObject;
}
export interface ProposeBody {
  readonly operation: OperationRef;
  readonly terms: JsonObject;
  /** Digest of `terms`; must match (content identity of the offer). */
  readonly termsDigest: string;
  /** 1 for an opening offer; incremented by each counter-proposal. */
  readonly round: number;
  /** The proposal this one counters, if any. */
  readonly counters?: Iri;
}
export interface AcceptBody {
  readonly proposal: Iri;
  readonly termsDigest: string;
  /** The option chosen where the offer permitted a choice. */
  readonly selection?: JsonObject;
  /** Deterministic agreement id (both sides compute and compare it). */
  readonly agreement: Iri;
}
export interface RefuseBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}
export interface InvokeBody {
  readonly operation: OperationRef;
  readonly input: JsonObject;
  readonly basis: Basis;
  readonly purpose?: Iri;
}
export interface DeliverBody {
  readonly ref: Iri;
  readonly basis: Basis;
  readonly operation: OperationRef;
  readonly output: JsonObject;
}
/** A report of an executed activity and the reporter's conclusion about it (A11). */
export interface ReceiptBody {
  readonly ref: Iri;
  readonly activity: Iri;
  readonly outcome: OutcomeConclusion;
  readonly observed?: JsonObject;
  /** True if this is the reporter's final receipt for `ref`. */
  readonly final?: boolean;
}
export interface UnsupportedBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}
export interface IndeterminateBody {
  readonly ref: Iri;
  readonly reason: ReasonCode;
  readonly detail?: string;
}

export interface BodyByKind {
  describe: DescribeBody;
  description: DescriptionBody;
  propose: ProposeBody;
  accept: AcceptBody;
  refuse: RefuseBody;
  invoke: InvokeBody;
  deliver: DeliverBody;
  receipt: ReceiptBody;
  unsupported: UnsupportedBody;
  indeterminate: IndeterminateBody;
}

/**
 * One logical interaction message. Every field here is consequential and therefore
 * protected by the selected integrity mechanism: profile, configuration, identity, kind,
 * audience, conversation, times, reply linkage, body and evidence.
 */
export interface Message<K extends MessageKind = MessageKind> {
  readonly profile: string;
  readonly configuration: string;
  readonly id: Iri;
  readonly conversation: Iri;
  readonly kind: K;
  readonly from: ParticipantRef;
  readonly to?: AudienceRef;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly inReplyTo?: Iri;
  readonly body: BodyByKind[K];
  readonly evidence?: readonly EvidenceItem[];
}

export type AnyMessage = { [K in MessageKind]: Message<K> }[MessageKind];

// ---------------------------------------------------------------------------------------
// Local records (A6, A7, A4, A8, A11). These are what the evidence ledger stores.
// ---------------------------------------------------------------------------------------

/** Outcome of an integrity/attribution check on one protected object. */
export type VerificationOutcome =
  | "valid"
  | "invalid"
  | "unsupported"
  | "unknown-key"
  | "not-applicable";

export interface VerificationResult {
  readonly type: "verification";
  /** Digest of the exact protected bytes examined. */
  readonly protectedObject: string;
  /** What was tested — never "truth" or "authority". */
  readonly property: "integrity-and-key-attribution" | "none-unsigned";
  readonly mechanism: string;
  /** Pinned verification material used (key thumbprint), if any. */
  readonly verificationMaterial?: string;
  /** The identifier the pinned material is bound to in the local trust store. */
  readonly attributedTo?: Iri;
  readonly verifier: Iri;
  readonly at: string;
  readonly outcome: VerificationOutcome;
  readonly limitations: readonly string[];
}

export type AssessmentOutcome = "accepted" | "not-accepted" | "unresolved";

/** Does the evaluator accept that `actor` speaks for `party` for this operation (A1/A3)? */
export interface RepresentationAssessment {
  readonly type: "representation-assessment";
  readonly evaluator: Iri;
  readonly actor: Iri;
  readonly party: Iri;
  readonly operation?: Iri;
  readonly statement?: Iri;
  readonly outcome: AssessmentOutcome;
  readonly reason?: ReasonCode;
  readonly at: string;
}

/** Does the evaluator accept `source` for this claim type about this subject (A7)? */
export interface SourceAuthorityAssessment {
  readonly type: "source-authority";
  readonly evaluator: Iri;
  readonly source: Iri;
  readonly claimType: string;
  readonly subject?: Iri;
  readonly rule?: { readonly id: Iri; readonly version: string };
  readonly outcome: AssessmentOutcome;
  readonly reason?: string;
  readonly at: string;
}

/** An action the local executor is about to perform, as evaluated against a mandate. */
export interface ActionIntent {
  /** Identity of the concrete action: digest over everything below. */
  readonly operation: Iri;
  /** The ODRL-level action class (e.g. `use`, `distribute`, `compensate`, `read`). */
  readonly action: string;
  /** Target asset/operation/resource. */
  readonly target: Iri;
  readonly purpose?: Iri;
  /** The party that receives the effect or data. */
  readonly recipient?: Iri;
  /** Consequential parameters (exact terms digest, amounts, fields). */
  readonly parameters: JsonObject;
  readonly conversation: Iri;
}

export type AuthorisationOutcome = "permit" | "deny" | "approval-required" | "indeterminate";

export interface AuthorisationDecision {
  readonly type: "authorisation-decision";
  readonly decider: Iri;
  readonly actionDigest: string;
  readonly action: ActionIntent;
  /** The grant/policy evaluated (id + digest), e.g. the owner mandate. */
  readonly policy: { readonly id: Iri; readonly digest: string; readonly evaluator: string };
  readonly outcome: AuthorisationOutcome;
  readonly basis?: "autonomous" | "owner-approval";
  readonly approval?: Iri;
  readonly matchedRule?: string;
  readonly reason: string;
  readonly at: string;
}

/** An agreement formed by an accept referring to an identified offer (A8). */
export interface Agreement {
  readonly type: "agreement";
  readonly id: Iri;
  readonly conversation: Iri;
  readonly operation: OperationRef;
  readonly offer: Iri;
  readonly acceptance: Iri;
  readonly termsDigest: string;
  readonly terms: JsonObject;
  readonly selection?: JsonObject;
  readonly offeror: ParticipantRef;
  readonly acceptor: ParticipantRef;
  readonly formedAt: string;
}

/** A grant: an authorisation artefact (mandate, data-use grant, access grant) (A4). */
export interface GrantRecord {
  readonly type: "grant";
  readonly id: Iri;
  readonly kind: "owner-mandate" | "data-use" | "access" | "onward-use" | "delegation";
  readonly grantor: Iri;
  readonly grantee: Iri;
  readonly digest: string;
  readonly validUntil?: string;
  readonly derivedFrom?: Iri;
  readonly at: string;
}

/** Conclusion about an attempted effect (A11). Never upgraded from uncertain to success. */
export type OutcomeConclusion = "completed" | "not-executed" | "uncertain";

export interface ActivityRecord {
  readonly type: "activity";
  readonly id: Iri;
  readonly activityType: string;
  readonly basis: Iri;
  readonly effectKey: string;
  readonly actor: Iri;
  readonly onBehalfOf?: Iri;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: "intended" | "attempting" | "concluded";
}

export interface OutcomeRecord {
  readonly type: "outcome";
  readonly activity: Iri;
  readonly conclusion: OutcomeConclusion;
  readonly observed?: JsonObject;
  readonly reason?: string;
  /** `recovery`: concluded by `recover()` after a restart (e.g. owed receipt re-derived). */
  readonly method: "direct-response" | "reconciliation" | "recovery" | "timeout";
  readonly at: string;
}
