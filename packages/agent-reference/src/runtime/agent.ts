// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
/**
 * The pilot agent runtime: one deterministic engine shared by every scenario.
 *
 * Inbound pipeline (each step has an explicit outcome and a ledger record):
 *   bounds → integrity + pinned-key attribution → schema → sender/key binding →
 *   configuration/alg match → audience → time window → replay → profile/configuration
 *   acceptance → conversation state machine → operation + terms validation →
 *   representation assessment → domain handler (proposer) → owner-mandate authorisation
 *   (executor) → effects (write-ahead, idempotent, reconcilable) → signed outbound.
 *
 * Integrity success, representation acceptance, source authority and authorisation are
 * four different records; none implies another.
 */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { AsyncLocalStorage } from "async_hooks";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomBytes } from "crypto";
import type { JWK } from "jose";
import { emailEnvelopeSchema, emailPinSchema } from "../bindings/email.js";
import {
  canonicalJson,
  derivedUrn,
  digestBytes,
  digestContent,
  digestOf,
  newUrn,
} from "../core/canonical.js";
import {
  type ConversationEvent,
  type ConversationState,
  isTerminal,
  openConversation,
  transition,
} from "../core/conversation.js";
import { type PilotLimits, resolveLimits } from "../core/limits.js";
import { validateMessage } from "../core/schema.js";
import type {
  ActionIntent,
  Agreement,
  AnyMessage,
  AuthorisationDecision,
  BodyByKind,
  EvidenceItem,
  Iri,
  Json,
  JsonObject,
  Message,
  MessageKind,
  OperationRef,
  ReasonCode,
  RepresentationAssessment,
} from "../core/types.js";
import { SPARQ_ZK_QUERY } from "../derive/adapters/sparq-zk-query.js";
import { resultSupportsSubject, SPARQ_ZK_RESULT } from "../derive/adapters/sparq-zk-result.js";
import { evaluateRule, isBooleanRule, queryFor } from "../derive/rules.js";
import { contributorUpperBound, proofPolicy } from "../derive/verification.js";
import type { DerivedRequest, FixedJointSession, ProofBinds } from "../derive/verifiers.js";
import { checkApprovalRelease } from "../gates/approval-release.js";
import { checkOrganisationApprovals, organisationApprovalSchema } from "../gates/approvals.js";
import { alternativeInstalled, type GateContext, GateMemory } from "../gates/common.js";
import { type Admission, claimSchema, InboundGate } from "../gates/inbound.js";
import { OutboundGate, type ProposalOrigin } from "../gates/outbound.js";
import { paymentDigest, periodKey, sameAmount } from "../gates/payment.js";
import { evaluateItemTerms, fitnessOf } from "../gates/quality.js";
import { type AccessPointer, isAccessPointer } from "../mechanisms/access-pointer.js";
import {
  anchorReceiptSchema,
  forumAnswerSchema,
  forumClaimSchema,
  RECORD_LIMITS,
  RECORD_PROOF_GRANT_TYP,
  rangeEntrySchema,
  recordProofGrantSchema,
  recordRequestSchema,
  recordSegmentSchema,
} from "../mechanisms/forum.js";
import { jointPayloadSchema } from "../mechanisms/joint.js";
import { jointLogView } from "../mechanisms/joint-privacy.js";
import { type KeyAlg, type SigningKey, signCompact, verifyCompact } from "../mechanisms/jws.js";
import {
  actionDigest,
  evaluateIntent,
  type LoadedMandate,
  loadMandate,
  verifyApproval,
} from "../mechanisms/mandate.js";
import { type PolicyEngine, solidOdrlEngine } from "../mechanisms/policy-engine.js";
import { auditReleases } from "../mechanisms/record-audit.js";
import {
  originalEnvelopeSchema,
  type ResourceReader,
  type ResourceReference,
  referencesIn,
  verifyResourceGrant,
} from "../mechanisms/references.js";
import {
  isClaimEvidence,
  unverifiedEvidenceClaim,
  verifySelectivePresentation,
} from "../mechanisms/selective.js";
import { singleUseStatusSchema } from "../mechanisms/single-use.js";
import { representationSchema, TYP, verifyStatement } from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import { copyData } from "../model/copy.js";
import { ActionIntentNode, MessageNode } from "../model/message-nodes.js";
import type { NamedValuesNode } from "../model/named-values.js";
import { PaymentAgreementNode, PaymentFacts, type PaymentOfferNode } from "../model/payment.js";
import { StatementQualityNode } from "../model/quality.js";
import {
  alternativeWireId,
  CONFIGURATIONS,
  configurationById,
  POLICY_PROFILE,
} from "../profile/configurations.js";
import {
  CORE_CONTENT_VOCABULARY,
  type ContentProfile,
  type ContentVocabulary,
  dataClaims,
  freeMessageStrings,
  freeStrings,
  identifiersIn,
  readingValueAllowed,
} from "../profile/content.js";
import {
  buildDescription,
  type ConformanceClaim,
  type DescribedPolicyModule,
  type ImplementationDescription,
  readPeerDescription,
  selectConfiguration,
} from "../profile/description.js";
import { PILOT_PROFILE } from "../profile/vocabulary.js";
import { SettlementError } from "../settlement/adapter.js";
import { readCarried } from "../settlement/carried.js";
import { POD_ACCESS_ADAPTER, type PodGrant, WITHDRAW_ACCESS } from "../standins/pod-access.js";
import {
  type EvidenceLedger,
  LEDGER_GENESIS,
  type LedgerEntry,
  type LedgerHead,
  type LedgerRangeEntry,
  type LedgerRecord,
  legacyApprovalRedaction,
  verifyLedger,
  verifyLedgerAtHead,
  verifyLedgerRange,
} from "../store/ledger.js";
import type {
  EffectState,
  EmailChallenge,
  OutboxEntry,
  PendingAction,
  RuntimeState,
  StateStore,
  TaskState,
  WireMessage,
} from "../store/state.js";
import { domainValue } from "../store/state.js";
import { peekWire } from "../trace/packet.js";
import { AgreementCredentialError, agreementMessageNode } from "../wire/agreement-credential.js";
import { snapshotApprovalRelease } from "../wire/approval-release.js";
import { readAttachmentDocument, writeAttachmentDocument } from "../wire/attachments.js";
import { digest as documentDigest, sign as signDocument } from "../wire/authenticity.js";
import { decodeAdapterJson, decodeCompactPayload } from "../wire/inspect.js";
import {
  documentConfiguration,
  inspectMessagePacket,
  isMessagePacket,
  type MessagePacket,
  nativeDocumentLimits,
  packetDocumentDigest,
  readHeldMessagePacket,
  rememberMessagePacket,
  verifyMessagePacket,
} from "../wire/message-packet.js";
import {
  liftPaymentObjects,
  readPaymentObjects,
  readPaymentOffer,
  verifyPaymentProofs,
  withPaymentOffer,
} from "../wire/payment.js";
import { encodeMessageProof, verifyRecordedMessage } from "../wire/recorded-message.js";
import { receiveCarriage } from "./carriage-gate.js";

import { DutyExecutor, type DutyRule, deadlineMissed, dutyRuleSchema } from "./duties.js";
import {
  type AgreementPlan,
  type DisclosureCheck,
  type DisclosureCondition,
  type EffectAdapter,
  type EffectPlan,
  type EffectResult,
  type HandlerContext,
  type HandlerReply,
  type OperationHandler,
  type OutboundPlan,
  operationKey,
  type RefusedEvidence,
} from "./operations.js";
import {
  type CompactionReport,
  compactState,
  DEFAULT_RETENTION,
  type RetentionPolicy,
} from "./retention.js";
import {
  MAX_TRANSMISSION_ATTEMPTS,
  type ProviderLookupResult,
  type ProviderSendResult,
  providerLookupResultOf,
  providerSendResultOf,
  type TransmissionIo,
  type TransmissionRecord,
  type TransmissionRefusal,
  type TransmitRequest,
  type TransmitResult,
  wireDigest,
} from "./transmission.js";

export interface AgentIdentity {
  readonly actor: Iri;
  readonly party?: Iri;
  readonly operator?: Iri;
}

export interface AgentRuntimeOptions {
  readonly settlement?: import("../settlement/types.js").SettlementSuite;
  readonly settlementReceiptSource?: string;
  readonly identity: AgentIdentity;
  /** Actor signing keys (one per algorithm). Absent for an anonymous public client. */
  readonly actorKeys?: readonly SigningKey[];
  /** Optional source record signer, installed only by the host of an issuing source. */
  readonly sourceKey?: SigningKey;
  readonly trust: TrustStore;
  /** Owner-signed mandate (JWS). Absent → every consequential action is denied. */
  readonly mandateJws?: string;
  /** Owner-signed representation statement presented to peers (JWS). */
  readonly representationJws?: string;
  readonly organizationMandateJws?: string;
  readonly authorityChainJws?: string;
  /** Accepted configuration ids, in preference order. */
  readonly accepted: readonly string[];
  readonly handlers: readonly OperationHandler[];
  readonly core?: {
    readonly id: Iri;
    readonly version: string;
    readonly kind: "scripted" | "model";
  };
  readonly effects?: readonly EffectAdapter[];
  readonly store: StateStore;
  readonly ledger: EvidenceLedger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Deterministic entropy injection for scripted runs. */
  readonly emailChallengeNonce?: () => string;
  readonly limits?: Partial<PilotLimits>;
  readonly messageLifetimeMs?: number;
  readonly bindings?: readonly { id: string; endpoint?: string }[];
  readonly conformance?: readonly ConformanceClaim[];
  /** Max execute attempts per effect key (reconciliation bounds retries). */
  readonly maxEffectAttempts?: number;
  /** An adapter call that takes longer is concluded `uncertain` (then reconciled). */
  readonly effectTimeoutMs?: number;
  /**
   * Bindings that confirm hand-off (file/spool/email service) set this: outbox entries
   * are then retained until handed off, and `undeliveredOutbound()` lists them.
   */
  readonly trackHandOff?: boolean;
  readonly retention?: Partial<RetentionPolicy>;
  /**
   * The declared policy module deciding each mandate policy (default `@jeswr/solid-odrl`;
   * `sparqPolicyEngine` for the Rust sparq-policy evaluator). Explicitly selected; a failing
   * engine yields `indeterminate`, never a fallback to another engine.
   */
  readonly policyEngine?: PolicyEngine;
  /**
   * Checkers for the disclosure conditions this agent's handlers attach to protected
   * deliveries, by condition kind (registered by the hosting role). A condition whose kind has
   * no checker fails closed.
   */
  readonly disclosureChecks?: Readonly<Record<string, DisclosureCheck>>;
  /**
   * What the inbound and outbound gates need beyond the runtime itself: the trace sink, the
   * configuration (for references), display names, the trust resolver and the principal's
   * limits. Absent: the gates still run, emit nothing, and apply no extra limits.
   */
  readonly gates?: GateContext;
}

export interface OutboundMessage {
  readonly id: Iri;
  readonly conversation: Iri;
  readonly kind: MessageKind;
  readonly toActor?: Iri;
  /** Endpoints pinned locally for the recipient actor (never taken from inbound headers). */
  readonly endpoints: readonly string[];
  readonly wire: WireMessage;
  /** The logical message (for bindings that render human fallbacks). */
  readonly message: AnyMessage;
}

export type Disposition = "accepted" | "duplicate" | "rejected" | "pending-approval" | "local";

export interface StepResult {
  readonly disposition: Disposition;
  readonly reason?: ReasonCode | string;
  readonly detail?: string;
  readonly messageId?: Iri;
  readonly kind?: MessageKind;
  readonly conversation?: Iri;
  readonly phase?: string;
  readonly outbound: readonly OutboundMessage[];
  readonly pendingApproval?: { readonly actionDigest: string; readonly intent: ActionIntent };
  readonly decisions: readonly AuthorisationDecision[];
}

type Continuation =
  | { type: "reply"; inReplyTo: Iri; reply: HandlerReply; operation?: OperationRef }
  | { type: "propose"; operation: OperationRef; terms: JsonObject }
  | { type: "invoke"; operation: OperationRef; input: JsonObject; basis: JsonObject; purpose?: Iri }
  | { type: "message"; plan: OutboundPlan }
  | { type: "effect"; plan: EffectPlan; basis?: Iri }
  | {
      type: "release-message";
      /** Brief 31 §2.1: held because no mandate rule decides a use of the principal's own data. */
      undecidedUse?: boolean;
      message: AnyMessage;
      document?: MessagePacket;
      intent?: ActionIntent;
      force?: boolean;
      conditions?: readonly DisclosureCondition[];
      after?: { plan: AgreementPlan; agreement: Agreement };
    };

interface StartPlan {
  readonly conditions?: readonly DisclosureCondition[];
  readonly content?: readonly import("../core/types.js").ContentPart[];
  readonly type: "propose" | "invoke";
  readonly operation: OperationRef;
  readonly terms?: JsonObject;
  readonly input?: JsonObject;
  readonly basis?: JsonObject;
  readonly purpose?: Iri;
  readonly models: readonly { id: string; version: string }[];
  /** Extra protected statements for the opening messages (e.g. a membership credential). */
  readonly evidence?: readonly EvidenceItem[];
}

const DEFAULT_LIFETIME_MS = 6 * 3_600_000;
const DEFAULT_EFFECT_TIMEOUT_MS = 30_000;

/** Outcome of a serial transmission phase: done, look up first, or send (outside the lock). */
type TransmitStep =
  | { readonly result: TransmitResult }
  | { readonly lookup: true }
  | { readonly send: number; readonly resend: boolean };

/** Thrown by `exclusive` when a handler/adapter calls back into its own runtime. */
export class ReentrantCallError extends Error {
  constructor() {
    super("re-entrant runtime call from inside a handler or adapter is not allowed");
    this.name = "ReentrantCallError";
  }
}
/** Idle limit for conversations with an anonymous peer (public-readonly configuration). */
const ANONYMOUS_IDLE_MS = 15 * 60_000;

export class RejectError extends Error {
  constructor(
    readonly reason: ReasonCode,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "RejectError";
  }
}

/** Internal non-local return: no caller may continue after an emission was held. */
class MessageReleaseError extends Error {
  constructor(readonly result: StepResult) {
    super(result.reason);
  }
}

/** Brief 32: what `auditRecord` found, for step templates and the fault claim. */
export interface RecordAuditResult {
  readonly ok: boolean;
  readonly judged: number;
  readonly inside: number;
  readonly unjudged: number;
  readonly outside: readonly {
    readonly actionDigest: string;
    readonly decision: { readonly seq: number; readonly hash: string };
    readonly release: { readonly seq: number; readonly hash: string };
  }[];
  /** Every judged release in record order, with its verdict. */
  readonly released: readonly { readonly actionDigest: string; readonly verdict: string }[];
  readonly statement?: string;
  readonly mandate?: { readonly id: string; readonly digest: string };
  /** The `record-audit` entry's position and chain hash. */
  readonly entry?: { readonly seq: number; readonly hash: string };
}

export class AgentRuntime {
  private readonly verifiedEmailPins = new Map<
    string,
    { purposes: readonly string[]; validUntil: string }
  >();
  readonly identity: AgentIdentity;
  readonly limits: PilotLimits;
  private readonly trust: TrustStore;
  private readonly store: StateStore;
  private readonly ledger: EvidenceLedger;
  private readonly clock: () => Date;
  private readonly ledgerAuditTrusted: boolean;
  private readonly newId: () => string;
  private readonly handlers = new Map<string, OperationHandler>();
  private readonly effectAdapters = new Map<string, EffectAdapter>();
  private readonly keysByAlg = new Map<KeyAlg, SigningKey>();
  private state: RuntimeState;
  private mandate: LoadedMandate | undefined;
  private mandateFailure: string | undefined;
  private decisions: AuthorisationDecision[] = [];
  private auditGateRun = 0;
  private readonly retention: RetentionPolicy;
  /** Serial executor: every state-changing entrypoint runs one at a time, in call order. */
  private queue: Promise<void> = Promise.resolve();
  private readonly inside = new AsyncLocalStorage<true>();
  /** Provider sends from this process that timed out but have not settled (not cancelled). */
  private readonly inFlight = new Set<Iri>();
  private closed = false;
  private readonly inbound: InboundGate;
  private readonly outbound: OutboundGate;
  private recordReleaseDigest?: string;
  private readonly retainedMessageViews = new Map<string, AnyMessage>();
  private readonly paymentOffers = new Map<string, PaymentOfferNode>();
  /** The admission of the inbound message being processed now (serial executor). */
  private admission: Admission | undefined;
  /** Set while an approved action resumes, so the core is not shown proposing it twice. */
  private settlementIngress: Promise<void> = Promise.resolve();
  private resuming = false;
  private resumingDigest: string | undefined;
  private reauthorising = false;
  private notificationWork: Promise<StepResult> | undefined;
  /** The pilot configuration of the exchange the gates are checking now. */
  private carriage: string | undefined;
  /** Set while a task the core took from a received message is being proposed. */
  private proposalOrigin: ProposalOrigin | undefined;
  private readonly gateMemory: GateMemory;
  private readonly contentProfiles = new Map<string, ContentProfile>();
  private readonly protocolVocabulary: ContentVocabulary;

  private constructor(private readonly options: AgentRuntimeOptions) {
    options = {
      ...options,
      gates: {
        ...options.gates,
        vocabulary: copyData(options.gates?.vocabulary),
        identifiers: copyData(options.gates?.identifiers),
        purposes: copyData(options.gates?.purposes),
        claimSources: copyData(options.gates?.claimSources),
        recordBackedClaims: copyData(options.gates?.recordBackedClaims ?? []),
        ...(options.gates?.reliance ? { reliance: copyData(options.gates.reliance) } : {}),
        principalLimits: copyData(options.gates?.principalLimits),
        rules: copyData(options.gates?.rules ?? []),
        sourceAliases: copyData(options.gates?.sourceAliases ?? {}),
        assessments: copyData(options.gates?.assessments ?? []),
        personDecisions: copyData(options.gates?.personDecisions ?? []),
        readings: copyData(options.gates?.readings ?? []),
        actionClaims: copyData(options.gates?.actionClaims ?? []),
        notificationRecipients: copyData(options.gates?.notificationRecipients ?? {}),
        ...(options.gates?.singleUse
          ? {
              singleUse: {
                actions: copyData(options.gates.singleUse.actions),
                registers: { ...options.gates.singleUse.registers },
                evidence: [...options.gates.singleUse.evidence],
                acceptances: [...options.gates.singleUse.acceptances],
              },
            }
          : {}),
        ...(options.gates?.authorityChains
          ? {
              authorityChains: {
                policy: copyData(options.gates.authorityChains.policy),
                resolver: options.gates.authorityChains.resolver,
              },
            }
          : {}),
        ...(options.gates?.organizations
          ? {
              organizations: {
                policy: copyData(options.gates.organizations.policy),
                resolver: options.gates.organizations.resolver,
              },
            }
          : {}),
        trust: copyData(options.gates?.trust),
        pins: copyData(options.gates?.pins ?? []),
      },
    };
    this.options = options;
    this.retention = { ...DEFAULT_RETENTION, ...(options.retention ?? {}) };
    this.identity = options.identity;
    this.limits = resolveLimits(options.limits);
    this.trust = options.trust;
    this.store = options.store;
    this.ledger = options.ledger;
    this.clock = options.now ?? (() => new Date());
    const idSource = options.newId ?? newUrn;
    this.newId = () => this.registerIdentifier(idSource());
    for (const h of options.handlers) {
      const key = operationKey(h.description);
      this.handlers.set(key, h);
      const profile = h.contentProfile;
      if (profile)
        this.contentProfiles.set(key, {
          vocabulary: copyData(profile.vocabulary),
          ...(profile.identifiers ? { identifiers: [...profile.identifiers] } : {}),
          ...(profile.purposes ? { purposes: copyData(profile.purposes) } : {}),
          ...(profile.reliance ? { reliance: copyData(profile.reliance) } : {}),
          ...(profile.protectedTerms
            ? {
                protectedTerms: Object.fromEntries(
                  Object.entries(profile.protectedTerms).map(([path, term]) => [
                    path,
                    {
                      ...term,
                      vocabulary: copyData(term.vocabulary),
                      schema: term.schema.clone(),
                    },
                  ]),
                ),
              }
            : {}),
        });
    }
    for (const e of options.effects ?? []) this.effectAdapters.set(e.id, e);
    if (options.gates?.accessPod?.actor === options.identity.actor)
      this.effectAdapters.set(POD_ACCESS_ADAPTER, {
        id: POD_ACCESS_ADAPTER,
        bindsParameters: true,
        execute: (_key, params) => this.executeWithdrawal(params),
        reconcile: (_key, params) => this.executeWithdrawal(params ?? {}),
      });
    for (const k of options.actorKeys ?? []) this.keysByAlg.set(k.alg, k);
    this.state = this.store.load();
    this.state.auditApprovalProofs ??= {};
    this.state.emailChallenges ??= {};
    const head = this.ledger.head?.();
    const checkpoint = this.state.ledgerAuditHead;
    this.ledgerAuditTrusted =
      !!head &&
      (!this.ledger.requiresTrustedCheckpoint ||
        (head.seq === LEDGER_GENESIS.seq && head.hash === LEDGER_GENESIS.hash && !checkpoint) ||
        (head.seq === checkpoint?.seq && head.hash === checkpoint.hash));
    this.state.domain.derivedRequests ??= {};
    this.state.domain.fixedJointSessions ??= {};
    const originalSink = options.gates?.sink;
    const recordChecks: Record<string, string[]> = {};
    const gateRuns = { "inbound-gate": 1, "outbound-gate": 1 };
    const auditSink = {
      agent: originalSink?.agent ?? this.identity.actor,
      emit: (event: import("../trace/types.js").TraceEventInput) => {
        if (event.kind === "record" && event.fact?.claimType === "usage-model.opinion")
          this.record({ type: "usage-model-opinion", ...copyData(event.fact), at: this.now() });
        if (event.kind === "check") {
          const record = {
            type: "gate-check",
            agent: this.identity.actor,
            gate: event.part,
            check: event.check,
            verdict: event.verdict,
            reason: event.reason,
            at: this.now(),
          };
          this.record(record);
          recordChecks[event.part] ??= [];
          recordChecks[event.part]?.push(digestOf(record));
        }
        if (event.kind === "decision") {
          this.record({
            type: "gate-decision",
            agent: this.identity.actor,
            gate: event.part,
            outcome: event.outcome,
            reason: event.reason,
            checks: recordChecks[event.part] ?? [],
            at: this.now(),
          });
          recordChecks[event.part] = [];
        }
        const gate =
          event.kind === "message-in"
            ? "inbound-gate"
            : event.kind === "message-out"
              ? "outbound-gate"
              : event.part === "inbound-gate" || event.part === "outbound-gate"
                ? event.part
                : undefined;
        const gateRun = gate ? gateRuns[gate] - (event.kind === "message-out" ? 1 : 0) : undefined;
        if (gate && event.kind === "decision") gateRuns[gate]++;
        originalSink?.emit(gateRun === undefined ? event : { ...event, gateRun });
      },
    };
    this.options = { ...options, gates: { ...options.gates, sink: auditSink } };
    const gate: GateContext = {
      reliance: {
        id: "urn:awp:installed-domain-reliance",
        rules: [...this.contentProfiles.values()].flatMap((p) => p.reliance?.rules ?? []),
      },
      ...(options.gates ?? {}),
      derivedRequests: this.state.domain.derivedRequests as unknown as Record<
        string,
        DerivedRequest
      >,
      fixedJointSessions: this.state.domain.fixedJointSessions as unknown as Record<
        string,
        FixedJointSession
      >,
      saveDerivationState: () => this.persist(),
      carriage: () => this.carriage,
      sink: auditSink,
    };
    if (
      gate.actionClaims?.some(
        (rule) =>
          ["pay", "distribute"].includes(rule.action) &&
          rule.claims.some((kind) => gate.personMayRelyOn?.includes(kind)),
      )
    )
      throw new Error(
        "personMayRelyOn cannot support payment or unrestricted personal-data disclosure",
      );
    const memory = new GateMemory(
      this.state.contextItems,
      this.state.knownIdentifiers,
      this.state.statementRefusals,
      this.state.relianceHolds,
      this.state.relianceBindings,
      this.state.precedenceHolds,
    );
    this.gateMemory = memory;
    memory.rememberIdentifiers("*", {
      identity: this.identity,
      trust: this.trust.data,
      descriptions: options.handlers.map((h) => h.description),
      core: options.core,
      accepted: options.accepted,
    });
    // Snapshots predating this registry still retain verified message IDs and outgoing bytes.
    for (const [id, seen] of Object.entries(this.state.seen))
      if (seen.conversation) memory.rememberIdentifiers(seen.conversation, [id, seen.conversation]);
    for (const conv of Object.values(this.state.conversations))
      if (conv.history.length > 0)
        memory.rememberIdentifiers(conv.id, {
          id: conv.id,
          peer: conv.peer,
          history: conv.history,
          challenge: conv.challenge,
          agreement: conv.agreement ? this.state.agreements[conv.agreement] : undefined,
        });
    for (const entry of Object.values(this.state.outbox)) {
      const message = peekWire(entry.wire);
      if (message) memory.rememberIdentifiers(entry.conversation, message);
    }
    for (const items of Object.values(memory.contexts))
      for (const item of items) {
        if (
          (item.kind === "statement" && item.accepted !== false) ||
          (item.kind === "reading" && item.accepted === true)
        )
          memory.facts.set(item.id, item);
      }
    // Brief 31 §2.2: a register this agent reads from signed answers sees only the entries
    // of answers its own inbound gate admitted (never a local table).
    gate.resolver?.bindAnswers(() =>
      registerAnswers(
        Object.values(memory.contexts)
          .flat()
          .filter((item) => item.kind === "statement" && item.accepted === true),
      ),
    );
    this.inbound = new InboundGate({
      identity: this.identity,
      trust: this.trust,
      limits: this.limits,
      now: () => this.now(),
      record: (r) => this.record(r),
      gate,
      memory,
      requestPurpose: (ref) => {
        const sent = peekWire(this.state.outbox[ref]?.wire);
        const purpose = (sent?.body as { purpose?: unknown } | undefined)?.purpose;
        return typeof purpose === "string" ? purpose : undefined;
      },
      settlement: this.options.settlement,
      receiptOrder: (receipt) => {
        const sent = this.state.paymentOrders[receipt.order ?? ""];
        if (sent) return { order: PaymentFacts.create(sent.data), provider: sent.provider };
        // A payee holds the same agreement and verifies the provider-signed forwarded order.
        const agreement = this.heldPaymentAgreement(receipt.agreement ?? "");
        if (!agreement || receipt.payee !== this.identity.party || !receipt.order) return undefined;
        const order = new PaymentFacts(receipt.order, receipt.dataset);
        if (
          order.agreement !== agreement.digest ||
          order.payee !== agreement.duty?.payee ||
          !sameAmount(order.amount, agreement.duty?.constraint?.amount) ||
          order.currency !== agreement.duty?.constraint?.currency
        )
          return undefined;
        return { order, provider: this.options.settlementReceiptSource ?? receipt.provider ?? "" };
      },
      recordReceipt: (receipt, document) => {
        this.state.paymentReceipts[receipt.id] = { document, order: receipt.order ?? "" };
        this.record({
          type: "payment-receipt-recorded",
          agreement: receipt.agreement,
          receipt: receipt.id,
          order: receipt.order,
          ledgerReference: receipt.ledgerReference,
          at: this.now(),
        });
        this.persist();
      },
      agreementTerms: (id) => {
        const agreement = this.state.conversations[id]?.agreement;
        return agreement ? this.state.agreements[agreement]?.terms : undefined;
      },
    });
    this.outbound = new OutboundGate({
      identity: this.identity,
      now: () => this.now(),
      referencePeer: (id) => {
        const conv = this.state.conversations[id];
        const actor = readPeerDescription(this.getDomain(`_peerDescription:${id}`))?.describes;
        return actor && conv?.peer.actor === actor && conv.peer.party
          ? { actor, party: conv.peer.party }
          : undefined;
      },
      referenceAgreementId: (intent) => {
        const conv = this.state.conversations[intent.conversation];
        if (!conv) return undefined;
        const digest = intent.parameters.termsDigest;
        if (conv.agreement) {
          const agreement = this.state.agreements[conv.agreement];
          return agreement && agreement.termsDigest === digest ? agreement.id : undefined;
        }
        const offer = conv.openProposal;
        if (offer && offer.termsDigest === digest)
          return this.agreementId(offer.id, offer.termsDigest);
        return undefined;
      },
      recordRelease: (intent) => this.recordReleaseDigest === actionDigest(intent),
      authoredProofSupports: (intent, item, claimType) =>
        this.authoredProofSupports(intent, item, claimType),
      recordBacks: (claim, recipient) => this.recordBacks(claim, recipient),
      mandate: () =>
        this.mandate && !this.isRevoked(this.mandate) ? this.mandate.mandate : undefined,
      policyEngine: options.policyEngine,
      gate,
      memory,
      isReplyTo: (id, party) => {
        const conv = this.state.conversations[id];
        return conv?.role === "responder" && conv.peer.party === party;
      },
      conversationPurpose: (id) => this.purposeOf(id),
      conversationRetentionDays: (id) => {
        const agreement = this.state.conversations[id]?.agreement;
        const days = agreement ? this.state.agreements[agreement]?.terms.retentionDays : undefined;
        return typeof days === "number" ? days : undefined;
      },
      offerTerms: (termsDigest) => {
        for (const [key, entry] of Object.entries(this.state.domain)) {
          if (!key.startsWith("_offer:")) continue;
          const terms = domainValue(entry);
          if (terms && typeof terms === "object" && digestOf(terms) === termsDigest)
            return terms as JsonObject;
        }
        return undefined;
      },
      anonymousConversation: (id) => this.state.generatedConversations[id] === true,
      recipientBound: (actor, party) =>
        this.trust.data.keys.some(
          (key) => key.role === "actor" && key.subject === actor && (!party || key.party === party),
        ),
      ...(gate.trust
        ? {
            recipientPinned: (party: string, purpose: string | undefined, actor?: string) => {
              const kid = actor
                ? this.trust.data.keys.find((key) => key.role === "actor" && key.subject === actor)
                    ?.kid
                : undefined;
              const email = this.verifiedEmailPins.get(party);
              if (
                !actor &&
                email &&
                purpose &&
                email.purposes.includes(purpose) &&
                Date.parse(email.validUntil) > Date.parse(this.now())
              )
                return true;
              return (!actor || !!kid) && this.hasTrustPin(party, purpose, kid);
            },
          }
        : {}),
      settlement: this.options.settlement,
      paymentApprovalMatches: (facts, intent) => {
        const binding = this.state.approvals[actionDigest(intent)]?.payment;
        return (
          binding?.termsDigest === facts.agreement && binding?.orderDigest === paymentDigest(facts)
        );
      },
      paymentRecord: (facts, intent) => {
        const agreement = Object.values(this.state.agreements).find(
          (a) => a.termsDigest === facts.agreement,
        );
        const offer = agreement && this.state.recordMessages[agreement.offer];
        const acceptance = agreement && this.state.recordMessages[agreement.acceptance];
        const sourceOffer = agreement && this.paymentOffers.get(agreement.termsDigest);
        const node =
          agreement && offer && acceptance && sourceOffer
            ? PaymentAgreementNode.fromRecord(agreement, {
                offer: offer.jws,
                acceptance: acceptance.jws,
                offerNode: sourceOffer,
              })
            : undefined;
        const confirmed =
          !!agreement &&
          agreement.acceptor.onBehalfOf === this.identity.party &&
          !["refused", "indeterminate", "unsupported"].includes(
            this.state.conversations[agreement.conversation]?.phase ?? "",
          ) &&
          (agreement.offeror.actor === this.identity.actor ||
            Object.values(this.state.recordMessages).some((r) => {
              if (r.direction !== "in" || r.conversation !== agreement.conversation) return false;
              const m =
                this.retainedMessageViews.get(
                  Object.entries(this.state.recordMessages).find(([, value]) => value === r)?.[0] ??
                    "",
                ) ?? peekWire({ format: "awp-jws-compact/0.1", jws: r.jws });
              return (
                m?.kind === "receipt" &&
                m.from.onBehalfOf === agreement.offeror.onBehalfOf &&
                [agreement.acceptance, agreement.id].includes(m.body.ref)
              );
            }));
        return {
          agreement: node,
          proofsVerified:
            !!offer &&
            !!acceptance &&
            (this.options.gates?.configuration?.layers.commitments !== "agreement-credential" ||
              this.options.gates.agreementCredential?.current(facts.agreement ?? "") === true),
          inEffect: confirmed,
          ordered: (key) =>
            !!this.state.paymentOrderKeys[key] &&
            !(this.reauthorising && this.state.paymentOrderKeys[key] === actionDigest(intent)),
        };
      },
      paymentSpent: (rule, currency, intent) => {
        const key = periodKey(rule, currency, this.now());
        const reservation = this.reauthorising
          ? Object.values(this.state.paymentReservations).find(
              (r) => r.digest === actionDigest(intent) && r.period === key,
            )
          : undefined;
        return (this.state.paymentTotals[key] ?? 0) - (reservation?.amountMinor ?? 0);
      },
      consumeApproval: (intent) => this.markApprovalConsumed(intent)?.(),
      reservePayment: (intent, releaseId) => {
        if (intent.action !== "pay" || this.state.paymentReleases[releaseId]) return;
        const decision = this.authorise(intent);
        if (decision.outcome !== "permit")
          throw new Error("Payment no longer authorised before reservation");
        const mandate = this.mandate?.mandate;
        const rule = [
          ...(mandate?.autonomous.permissions ?? []),
          ...(mandate?.withApproval.permissions ?? []),
        ].find((r) => r.id === decision.matchedRule);
        if (!rule?.id) throw new Error("Payment mandate needs an identified rule");
        const key = periodKey(rule.id, String(intent.parameters.currency), this.now());
        this.state.paymentTotals[key] =
          (this.state.paymentTotals[key] ?? 0) + Math.round(Number(intent.parameters.amount) * 100);
        const facts = PaymentFacts.fromIntent(
          intent,
          this.identity.party ?? this.identity.actor,
          this.now(),
        );
        if (facts.onceKey) {
          const used = this.state.paymentOrderKeys[facts.onceKey];
          if (used && used !== actionDigest(intent))
            throw new Error("Payment instalment already ordered");
          this.state.paymentOrderKeys[facts.onceKey] = actionDigest(intent);
        }
        this.state.paymentOrders[facts.id] = {
          data: facts.data(),
          provider: this.options.settlementReceiptSource ?? intent.recipient ?? "",
          intentDigest: actionDigest(intent),
        };
        this.state.paymentReleases[releaseId] = true;
        this.state.paymentReservations[releaseId] = {
          digest: actionDigest(intent),
          period: key,
          amountMinor: Math.round(Number(intent.parameters.amount) * 100),
        };
        this.record({
          type: "payment-reserved",
          releaseId,
          rule: rule.id,
          period: key,
          amountMinor: Math.round(Number(intent.parameters.amount) * 100),
          totalMinor: this.state.paymentTotals[key],
          at: this.now(),
        });
        this.persist();
      },
      organisationApprovals: (intent, rule) =>
        checkOrganisationApprovals({
          intent,
          rule,
          approvals: (this.state.organisationApprovals[actionDigest(intent)] ?? []).filter(
            (a) => this.reauthorising || !this.state.usedApprovals[a.id],
          ),
          memory,
          task: gate.taskId ?? intent.conversation,
          organization: this.identity.party ?? "",
          requester:
            gate.requester ?? this.state.conversations[intent.conversation]?.peer.party ?? "",
          at: this.now(),
        }),
      personApproved: (intent, role) => {
        if (role)
          return (
            checkOrganisationApprovals({
              intent,
              rule: { count: 1, roles: [role], distinctFromRequester: false },
              approvals: (this.state.organisationApprovals[actionDigest(intent)] ?? []).filter(
                (a) => this.reauthorising || !this.state.usedApprovals[a.id],
              ),
              memory,
              task: gate.taskId ?? intent.conversation,
              organization: this.identity.party ?? "",
              requester: gate.requester ?? "",
              at: this.now(),
            }) === "pass"
          );
        const approval = this.state.approvals[actionDigest(intent)];
        return (
          approval?.decision === "approve" &&
          Date.parse(approval.validUntil) > Date.parse(this.now()) &&
          (this.reauthorising || !this.state.usedApprovals[approval.id])
        );
      },
      demandedApproval: (intent) => {
        if (!intent.recipient) return undefined;
        const needs = this.getDomain(`_challenge:${intent.conversation}`);
        if (
          !needs ||
          typeof needs !== "object" ||
          Array.isArray(needs) ||
          typeof needs.approval !== "string"
        )
          return undefined;
        const given = this.state.approvals[actionDigest(intent)];
        const approved =
          given?.decision === "approve" && Date.parse(given.validUntil) > Date.parse(this.now());
        return {
          approval: String(needs.approval),
          label: String(needs.label),
          ...(approved ? { approvedBy: given.id } : {}),
        };
      },
    });
    const metadata: Record<string, import("../profile/content.js").ContentType> = {};
    const declare = (value: unknown, path: string) => {
      if (typeof value === "string") metadata[path] = { type: "term", values: [value] };
      else if (typeof value === "number") metadata[path] = { type: "number" };
      else if (typeof value === "boolean") metadata[path] = { type: "code", values: [value] };
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value))
          declare(
            child,
            `${path}.${key.replaceAll("~", "~0").replaceAll(".", "~1").replaceAll("*", "~2")}`,
          );
    };
    declare(this.description(), "description");
    this.protocolVocabulary = metadata;
  }

  static async create(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    const selfKeys = (options.actorKeys ?? [])
      .filter((key) => !options.trust.data.keys.some((known) => known.kid === key.kid))
      .map((key) => ({
        kid: key.kid,
        alg: key.alg,
        publicJwk: key.publicJwk,
        role: "actor" as const,
        subject: options.identity.actor,
        ...(options.identity.party ? { party: options.identity.party } : {}),
      }));
    const trust = selfKeys.length
      ? await TrustStore.load({
          ...options.trust.data,
          keys: [...options.trust.data.keys, ...selfKeys],
        })
      : options.trust;
    const rt = new AgentRuntime({ ...options, trust });
    await rt.loadMandateInto();
    for (const entry of Object.values(rt.state.outbox))
      if (isMessagePacket(entry.wire)) {
        const message = await inspectMessagePacket(entry.wire);
        if (message) rt.inbound.rememberCredentials(message);
      }
    for (const agreement of Object.values(rt.state.agreements)) {
      if (!agreement.terms.compensation) continue;
      try {
        rt.paymentOffers.set(agreement.termsDigest, await readPaymentOffer(agreement.terms));
      } catch {
        /* Without its admitted RDF offer this record cannot authorize a payment. */
      }
    }
    for (const [id, record] of Object.entries(rt.state.recordMessages)) {
      const read = await verifyRecordedMessage(record.jws, rt.trust);
      if (read) {
        rt.retainedMessageViews.set(id, read.message);
        rt.inbound.rememberCredentials(read.message);
      }
    }
    rt.notificationDuties();
    if (rt.ledger.requiresTrustedCheckpoint && rt.ledgerAuditTrusted) rt.persist();
    return rt;
  }

  /**
   * Run `fn` after every previously started state-changing call has finished. Calls made
   * from inside a handler or adapter of this runtime are refused rather than deadlocking.
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inside.getStore()) return Promise.reject(new ReentrantCallError());
    const run = () =>
      this.inside.run(true, () => {
        this.decisions = [];
        this.current = undefined;
        this.carriage = undefined;
        const outboxBefore = new Set(Object.keys(this.state.outbox));
        return fn().catch((error: unknown) => {
          if (!(error instanceof MessageReleaseError)) throw error;
          if (this.current) {
            const seen = this.state.seen[this.current.id];
            if (seen)
              this.state.seen[this.current.id] = { ...seen, disposition: error.result.disposition };
          }
          this.persist();
          const emitted = Object.values(this.state.outbox)
            .filter((entry) => !outboxBefore.has(entry.id))
            .map((entry) => this.outboundFromEntry(entry));
          const ids = new Set(emitted.map((message) => message.id));
          return {
            ...error.result,
            outbound: [
              ...emitted,
              ...error.result.outbound.filter((message) => !ids.has(message.id)),
            ],
          } as T;
        });
      });
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // ---------------------------------------------------------------- public surface

  private now(): string {
    return this.clock().toISOString();
  }

  /** Reload (or replace) the owner mandate. Persisted revocations still apply to it. */
  reloadMandate(jws?: string): Promise<void> {
    return this.exclusive(() => this.loadMandateInto(jws));
  }

  private async loadMandateInto(jws?: string): Promise<void> {
    const source = jws ?? this.options.mandateJws;
    if (!source) {
      this.mandate = undefined;
      this.mandateFailure = "no mandate configured";
      return;
    }
    const result = this.options.gates?.authorizationGrant?.load
      ? await this.options.gates.authorizationGrant.load(source)
      : await loadMandate(source, {
          trust: this.trust,
          actor: this.identity.actor,
          limits: this.limits,
          at: this.now(),
        });
    this.record(result.ok ? result.loaded.verification : result.verification);
    if (result.ok) {
      this.mandate = result.loaded;
      this.gateMemory.rememberIdentifiers("*", result.loaded.mandate);
      this.mandateFailure = undefined;
      this.record({
        type: "grant",
        id: result.loaded.mandate.id,
        kind: "owner-mandate",
        grantor: result.loaded.mandate.issuer,
        grantee: result.loaded.mandate.subject,
        digest: result.loaded.digest,
        validUntil: result.loaded.mandate.validUntil,
        at: this.now(),
      });
    } else {
      this.mandate = undefined;
      this.mandateFailure = result.reason;
    }
  }

  /**
   * Local owner action: stop honouring the current mandate. The revocation is persisted
   * (mandate id + version, and digest), so reopening the state or reloading the same — or
   * an older — mandate cannot silently restore it. A re-issued mandate with a higher version
   * is required to act again.
   */
  revokeMandate(): Promise<{ revoked: boolean; id?: Iri; version?: number }> {
    return this.exclusive(async () => {
      const m = this.mandate;
      if (!m) return { revoked: false };
      if (!this.isRevoked(m)) {
        this.state.revokedMandates = [
          ...this.state.revokedMandates,
          { id: m.mandate.id, version: m.mandate.version, digest: m.digest, at: this.now() },
        ];
      }
      this.record({
        type: "mandate-revoked",
        mandate: m.mandate.id,
        version: m.mandate.version,
        digest: m.digest,
        at: this.now(),
      });
      this.persist();
      return { revoked: true, id: m.mandate.id, version: m.mandate.version };
    });
  }

  /** Whether a mandate is loaded, revoked, or why it failed to load. */
  mandateStatus(): { loaded: boolean; revoked: boolean; failure?: string } {
    return {
      loaded: this.mandate !== undefined,
      revoked: this.mandate ? this.isRevoked(this.mandate) : false,
      ...(this.mandateFailure ? { failure: this.mandateFailure } : {}),
    };
  }

  private isRevoked(m: LoadedMandate): boolean {
    return this.state.revokedMandates.some(
      (r) => r.digest === m.digest || (r.id === m.mandate.id && m.mandate.version <= r.version),
    );
  }

  description(extensions?: JsonObject): ImplementationDescription {
    const implemented = Object.values(CONFIGURATIONS)
      .filter((c) => alternativeInstalled(this.options.gates ?? {}, c.id))
      .filter(
        (c) =>
          !c.id.includes("#config/settlement-") ||
          (this.options.accepted.includes(c.id) &&
            c.id.includes(`/settlement-${this.options.settlement?.id}/`)),
      )
      .filter(
        (c) =>
          this.options.accepted.includes(c.id) ||
          (c.status === "executable" &&
            c.integrity.status === "selected" &&
            this.keysByAlg.has(c.integrity.alg)),
      )
      .map((c) => c.id);
    return buildDescription({
      actor: this.identity.actor,
      ...(this.identity.party ? { party: this.identity.party } : {}),
      ...(this.identity.operator ? { operator: this.identity.operator } : {}),
      implemented,
      accepted: this.options.accepted,
      operations: [...this.handlers.values()].map((h) => h.description),
      bindings: this.options.bindings ?? [{ id: "direct-local/0.1" }],
      // Shared with peers: profile, evaluator and status only — never the local reason/path.
      policyModule: (({ policyProfile, evaluator, status }) => ({
        policyProfile,
        evaluator,
        status,
      }))(this.policyModule()),
      conformance: this.options.conformance ?? [],
      ...(extensions ? { extensions } : {}),
    });
  }

  /**
   * The selected policy module as described to peers and operators: the shared policy
   * profile, the evaluator (name/version/interface) and its CURRENT availability (re-checked
   * now; a long-running agent reports a replaced or removed evaluator as unavailable).
   */
  policyModule(): DescribedPolicyModule & { reason?: string } {
    const engine = this.options.policyEngine ?? solidOdrlEngine;
    const a = engine.availability?.() ?? { status: "ready" as const };
    return {
      policyProfile: POLICY_PROFILE,
      evaluator: engine.module ?? { name: engine.id, version: "unknown", interface: "unknown" },
      status: a.status,
      ...(a.status === "unavailable" ? { reason: a.reason } : {}),
    };
  }

  conversation(id: Iri): ConversationState | undefined {
    return this.state.conversations[id];
  }

  conversations(): readonly ConversationState[] {
    return Object.values(this.state.conversations);
  }

  reportPrice(statement: string): Promise<string> {
    return this.exclusive(async () => {
      const fact = this.gateMemory.facts.get(statement);
      if (!fact?.statement?.payment || fact.claimType !== "invoice")
        throw new TypeError("No admitted price to report");
      const facts = liftPaymentObjects(await readPaymentObjects(fact.statement.payment));
      const text = `The cheapest available price is ${facts.amount} ${facts.currency}.`;
      this.options.gates?.sink?.emit({
        part: "core",
        kind: "propose",
        caption: "The agent answers the price question from the admitted quote.",
        chat: { who: "agent", text },
        settlementFacts: facts,
      });
      return text;
    });
  }

  paymentApprovalBinding(
    digest: string,
  ): import("../settlement/types.js").PaymentApprovalBinding | undefined {
    const pending = this.state.pending[digest];
    if (pending?.intent.action !== "pay") return undefined;
    const facts = PaymentFacts.fromIntent(
      pending.intent,
      this.identity.party ?? this.identity.actor,
      this.now(),
    );
    if (!facts.agreement) return undefined;
    return { termsDigest: facts.agreement, orderDigest: paymentDigest(facts) };
  }

  heldPaymentAgreement(digest: string): PaymentAgreementNode | undefined {
    const agreement = Object.values(this.state.agreements).find((a) => a.termsDigest === digest);
    const offer = agreement && this.state.recordMessages[agreement.offer];
    const acceptance = agreement && this.state.recordMessages[agreement.acceptance];
    const sourceOffer = agreement && this.paymentOffers.get(agreement.termsDigest);
    return agreement && offer && acceptance && sourceOffer
      ? PaymentAgreementNode.fromRecord(agreement, {
          offer: offer.jws,
          acceptance: acceptance.jws,
          offerNode: sourceOffer,
        })
      : undefined;
  }

  /** In-process protocol carriage still admits a complete signed RDF message through all five checks.
   * This host-only ingress has no core dispatch and cannot execute an effect.
   */
  admitSettlementMessage(wire: WireMessage): Promise<AnyMessage> {
    const admitted = this.settlementIngress.then(() => this.admitSettlementMessageInner(wire));
    this.settlementIngress = admitted.then(
      () => undefined,
      () => undefined,
    );
    return admitted;
  }

  private async admitSettlementMessageInner(wire: WireMessage): Promise<AnyMessage> {
    const gate = new InboundGate({
      identity: this.identity,
      trust: this.trust,
      limits: this.limits,
      now: () => this.now(),
      record: (r) => this.record(r),
      gate: this.options.gates ?? {},
      memory: this.gateMemory,
      agreementTerms: () => ({ purpose: "urn:purpose:valuation" }),
    });
    const checked = await gate.verifyIntegrity(wire, { binding: "direct-local/0.1" }, () => false);
    const admission = gate.arrive(wire, "direct-local/0.1", checked.message);
    if (!checked.ok) {
      admission.failIntegrity(checked.reason, checked.detail);
      throw new Error(checked.reason);
    }
    admission.passIntegrity(checked);
    const message = checked.message;
    if (this.state.seen[message.id]) {
      admission.failIntegrity(
        "replay-conflict",
        "The protocol message identifier has already been admitted.",
      );
      admission.refuse("replay-conflict");
      throw new RejectError("replay-conflict", "The protocol message was already admitted.");
    }
    if (
      message.kind !== "receipt" ||
      !this.options.accepted.includes(message.configuration) ||
      message.body.observed?.suite !== this.options.settlement?.id
    )
      throw new SettlementError("evidence-invalid");
    const conv = openConversation({
      id: message.conversation,
      role: "responder",
      peer: { actor: message.from.actor, party: message.from.onBehalfOf },
      configuration: message.configuration,
      at: this.now(),
    });
    await admission.source(message);
    const evidence = (message.evidence ?? []).find((e) => {
      if (!isClaimEvidence(e)) return false;
      const c = unverifiedEvidenceClaim(e);
      return c.claimType === "settlement-object" || c.claimType === "settlement-key";
    });
    const assessed = evidence
      ? await gate.assessClaim(evidence, message.from.onBehalfOf)
      : undefined;
    if (!assessed || assessed.verdict !== "pass") {
      const reason =
        assessed?.reason === "evidence-invalid" || assessed?.reason === "unknown-key"
          ? "evidence-invalid"
          : "source-not-authoritative";
      admission.refuse(reason, "The protocol source statement is not authoritative.");
      throw new SettlementError(reason);
    }
    const result = await admission.complete(conv, message);
    if (!result.ok) throw new Error(result.reason);
    const claim = assessed.claim;
    if (
      !claim ||
      claim.issuer !== message.from.onBehalfOf ||
      claim.subject !== message.from.onBehalfOf ||
      !this.gateMemory.facts.has(String(claim.id)) ||
      claim.objectDigest !== digestOf(message.body.observed)
    )
      throw new SettlementError("source-not-authoritative");
    this.record({
      type: "settlement-message-admitted",
      message: message.id,
      objectDigest: claim.objectDigest,
      at: this.now(),
    });
    this.state.seen[message.id] = {
      digest: digestOf(message),
      conversation: message.conversation,
      disposition: "accepted",
      responses: [],
      expiresAt: message.expiresAt,
    };
    this.persist();
    return message;
  }

  async receivedPaymentOrder(id: string): Promise<{
    facts: PaymentFacts;
    payer: string;
    objects: import("../settlement/types.js").ProtocolObjects;
  }> {
    const retained = this.state.recordMessages[id];
    if (!retained || retained.direction !== "in" || this.state.seen[id]?.disposition !== "accepted")
      throw new TypeError("No admitted provider order");
    const message = (await verifyRecordedMessage(retained.jws, this.trust))?.message;
    if (
      message?.kind !== "invoke" ||
      message.body.operation.id !== "urn:op:payment" ||
      message.to?.party !== this.identity.party
    )
      throw new TypeError("Order is not addressed to this provider");
    const suite = this.options.settlement;
    const objects =
      suite && suite.id !== "rdf-order"
        ? readCarried(message.body.input, suite)
        : await readPaymentObjects(message.body.input);
    const facts = suite ? suite.lift(objects) : liftPaymentObjects(objects);
    if (!facts.payer || facts.payer !== message.from.onBehalfOf)
      throw new TypeError("Order payer is not the authenticated principal");
    if (
      !(await verifyPaymentProofs(
        facts,
        this.trust,
        this.now(),
        this.options.gates?.agreementCredential,
        message.configuration === alternativeWireId("commitments-agreement-credential"),
      ))
    )
      throw new TypeError("Payment agreement proofs or acceptance authority do not verify");
    this.record({
      type: "payment-agreement-proofs-verified",
      agreement: facts.agreement,
      order: facts.id,
      at: this.now(),
    });
    return { facts, payer: facts.payer, objects };
  }

  agreements(): readonly Agreement[] {
    return Object.values(this.state.agreements);
  }

  effectStates(): readonly EffectState[] {
    return Object.values(this.state.effects);
  }

  pendingApprovals(): ReadonlyArray<{
    actionDigest: string;
    intent: ActionIntent;
    conversation: Iri;
  }> {
    return Object.values(this.state.pending).map((p) => ({
      actionDigest: p.actionDigest,
      intent: copyData(p.intent),
      conversation: p.conversation,
    }));
  }

  domainState(key: string): Json | undefined {
    const value = this.getDomain(key);
    if (value !== undefined) {
      this.gateMemory.enter(this.options.gates?.taskId ?? "*", {
        id: derivedUrn("memory", { key, digest: digestOf(value) }),
        digest: digestOf(value),
        identifiers: identifiersIn(value),
        kind: "memory",
        label: `Memory entry ${key}`,
        claimType: `memory:${key}`,
        source: this.identity.actor,
        subject: this.identity.party ?? "unknown",
      });
      this.persist();
    }
    return copyData(value);
  }

  /** Receive a signed compound term through a verifier installed by this operation's profile.
   * This records context, not accepted factual support or authority to act.
   */
  readProtectedTerm(operation: OperationRef, path: string, jws: string): Promise<Json> {
    return this.exclusive(async () => {
      const declaration = this.contentProfiles.get(operationKey(operation))?.protectedTerms?.[path];
      if (!declaration)
        throw new RejectError("unsupported-term", "no installed verifier for this compound term");
      const check = await verifyStatement(jws, {
        ...declaration,
        trust: this.trust,
        limits: this.limits,
        verifier: this.identity.actor,
        at: this.now(),
      });
      this.record(check.verification);
      if (!check.payload) throw new RejectError("evidence-invalid", "compound term did not verify");
      this.gateMemory.enter(this.options.gates?.taskId ?? "*", {
        id: digestOf(check.payload),
        digest: digestOf(check.payload),
        identifiers: identifiersIn(check.payload),
        kind: "statement",
        accepted: false,
        label: "Received protected term",
        claimType: "protected-term",
        source: check.signer?.subject ?? "unknown",
        subject: this.identity.party ?? "unknown",
      });
      this.persist();
      return copyData(check.payload) as Json;
    });
  }

  /**
   * Application-level observation (e.g. a performance event reported by an operator
   * system). Recorded as an observation with its source; it is not treated as verified.
   */
  recordObservation(record: {
    readonly type: string;
    readonly observedBy: string;
    readonly [key: string]: unknown;
  }): void {
    this.record({ ...record, at: this.now() });
  }

  /** Bindings record their own rejections/observations in this agent's evidence ledger. */
  recordBindingEvent(record: {
    readonly type: string;
    readonly binding: string;
    readonly [key: string]: unknown;
  }): void {
    this.record({ ...record, at: this.now() });
  }

  /** Verify one of this agent's own outbound envelopes (pre-send self-check). */
  async selfCheck(wire: WireMessage): Promise<{ ok: boolean; detail: string }> {
    if (isMessagePacket(wire)) {
      const declared = documentConfiguration(wire);
      const cfg = configurationById(declared.configuration);
      const suite =
        cfg?.integrity.status === "selected" && cfg.integrity.mechanism === "data-integrity"
          ? "data-integrity"
          : "jws";
      const checked = await verifyMessagePacket(wire, {
        suite,
        unsigned: !declared.signed,
        resolve: (id) =>
          [...this.keysByAlg.values()].find((key) => key.kid === id.replace(/^urn:awp:key:/, "")),
      });
      return checked.ok
        ? { ok: true, detail: "complete document checked with own key" }
        : { ok: false, detail: checked.detail };
    }
    if (wire.format !== "awp-jws-compact/0.1")
      return { ok: true, detail: "unsigned anonymous request" };
    const own = [...this.keysByAlg.values()];
    const v = await verifyCompact(wire.jws, {
      resolve: (kid) => {
        const k = own.find((x) => x.kid === kid);
        return k ? { kid: k.kid, alg: k.alg, publicJwk: k.publicJwk } : undefined;
      },
      typ: TYP.message,
      allowedAlgs: ["EdDSA", "ES256"],
      limits: this.limits,
    });
    return v.outcome === "valid"
      ? { ok: true, detail: `signed by own key ${v.kid}` }
      : { ok: false, detail: v.detail };
  }

  /**
   * For provider adapters: verify an envelope was signed by THIS agent's own key and return
   * the audience actor from the verified payload, plus pinned-endpoint lookup.
   */
  outboundVerifier(): {
    verifyOwnEnvelope(
      jws: string | WireMessage,
    ): Promise<{ ok: boolean; audienceActor?: Iri; messageId?: Iri; detail: string }>;
    endpointsFor(actor: Iri): readonly string[];
    transmit(req: TransmitRequest, io: TransmissionIo): Promise<TransmitResult>;
    checkTransmission(req: TransmitRequest): Promise<{ ok: true } | TransmitResult>;
  } {
    const own = [...this.keysByAlg.values()];
    return {
      verifyOwnEnvelope: async (jws) => {
        if (isMessagePacket(jws)) {
          const cfg = configurationById(documentConfiguration(jws).configuration);
          const suite =
            cfg?.integrity.status === "selected" && cfg.integrity.mechanism === "data-integrity"
              ? "data-integrity"
              : "jws";
          const checked = await verifyMessagePacket(jws, {
            suite,
            resolve: (id) => own.find((key) => key.kid === id.replace(/^urn:awp:key:/, "")),
          });
          if (!checked.ok) return { ok: false, detail: checked.detail };
          const message = new MessageNode(checked.root, checked.dataset);
          return message.to?.actor
            ? {
                ok: true,
                audienceActor: message.to.actor,
                messageId: message.id,
                detail: "complete document signed by own key",
              }
            : { ok: false, detail: "message has no audience actor" };
        }
        if (typeof jws !== "string") return { ok: false, detail: "unsupported envelope" };
        const v = await verifyCompact(jws, {
          resolve: (kid) => {
            const k = own.find((x) => x.kid === kid);
            return k ? { kid: k.kid, alg: k.alg, publicJwk: k.publicJwk } : undefined;
          },
          typ: TYP.message,
          allowedAlgs: ["EdDSA", "ES256"],
          limits: this.limits,
        });
        if (v.outcome !== "valid")
          return { ok: false, detail: `not signed by this agent: ${v.detail}` };
        const checked = validateMessage(v.payload);
        if (!checked.ok) return { ok: false, detail: "payload is not a valid message" };
        const audience = checked.message.to?.actor;
        return audience
          ? {
              ok: true,
              audienceActor: audience,
              messageId: checked.message.id,
              detail: `signed by own key ${v.kid}`,
            }
          : { ok: false, detail: "message has no audience actor" };
      },
      endpointsFor: (actor) => this.trust.actorEndpoints(actor),
      transmit: (req, io) => this.transmit(req, io),
      checkTransmission: (req) => this.checkTransmission(req),
    };
  }

  /**
   * Dry-run of `transmit`'s authorisation: would a send be allowed now? Nothing is recorded
   * as a transmission (the authorisation decision itself is recorded as usual).
   */
  checkTransmission(req: TransmitRequest): Promise<{ ok: true } | TransmitResult> {
    return this.exclusive(async () => {
      const rec = this.state.transmissions[req.messageId];
      if (rec?.status === "sent")
        return {
          status: "duplicate",
          ...(rec.providerRef ? { providerRef: rec.providerRef } : {}),
        };
      if (rec && (rec.status === "attempting" || rec.status === "uncertain"))
        return { status: "uncertain", detail: "an earlier send is unresolved" };
      const refusal = this.transmissionRefusal(req);
      this.persist();
      return refusal ? { status: "refused", reason: refusal[0], detail: refusal[1] } : { ok: true };
    });
  }

  /**
   * Outbound messages of one conversation still held in this runtime's outbox (handed off or
   * not) — the durable record of what this agent emitted, for correlation after interruption.
   */
  outboxMessages(conversationId: Iri): readonly OutboundMessage[] {
    return Object.values(this.state.outbox)
      .filter((e) => e.conversation === conversationId)
      .map((e) => this.outboundFromEntry(e));
  }

  /** Pinned endpoints for an actor (from the local trust store only). */
  endpointsFor(actor: Iri): readonly string[] {
    return this.trust.actorEndpoints(actor);
  }

  isPinnedActor(actor: Iri): boolean {
    return this.trust.keysFor(actor, "actor").length > 0;
  }

  /** The principal tells the agent something (shown in a trace's chat column). */
  /** Show the loaded, verified mandate in the trace (worked-example step 1). */
  showMandate(): void {
    this.outbound.mandateLoaded();
  }

  instruct(text: string, data?: Json): void {
    this.gateMemory.enter(this.options.gates?.taskId ?? "*", {
      id: derivedUrn("instruction", data === undefined ? { text } : { text, data }),
      digest: digestOf(data === undefined ? text : { text, data }),
      kind: "message",
      label: "Principal instruction",
      ...(data === undefined ? {} : { identifiers: identifiersIn(data) }),
      source: this.identity.party ?? this.identity.actor,
      subject: this.identity.party ?? "unknown",
      claimType: "principal-instruction",
    });
    this.outbound.instruction(text);
    this.persist();
  }

  private emailFooter(): string {
    const email = this.options.gates?.email;
    if (!email || !this.identity.party) throw new Error("email profile is not installed");
    return `Written by an agent (model-generated) for ${this.options.gates?.name?.(this.identity.party) ?? this.identity.party} (${this.identity.party}).\nReply in structured form: ${email.structuredReply}`;
  }
  private async checkEmailPin(endpoint: string, purpose: string): Promise<boolean> {
    this.verifiedEmailPins.clear();
    for (const jws of this.options.gates?.email?.pins ?? []) {
      const checked = await verifyStatement(jws, {
        trust: this.trust,
        typ: "awp-email-endpoint-pin+jws",
        schema: emailPinSchema,
        role: "party",
        limits: this.limits,
        at: this.now(),
        verifier: this.identity.actor,
      });
      this.record(checked.verification);
      const p = checked.payload;
      if (
        p &&
        checked.signer?.subject === this.identity.party &&
        p.issuer === this.identity.party &&
        Date.parse(p.validUntil) > Date.parse(this.now())
      )
        this.verifiedEmailPins.set(p.endpoint, { purposes: p.purposes, validUntil: p.validUntil });
    }
    const pin = this.verifiedEmailPins.get(endpoint);
    return !!pin && pin.purposes.includes(purpose);
  }
  /** Plain prose is sent only as an approved effect to a principal-pinned mailbox. */
  sendEmail(input: {
    taskId: Iri;
    adapter: string;
    to: string;
    text: string;
    purpose: Iri;
    challenge?: boolean;
  }) {
    const nonce = input.challenge
      ? (this.options.emailChallengeNonce?.() ?? randomBytes(24).toString("hex"))
      : undefined;
    const params = {
      id: input.taskId,
      from: this.options.gates?.email?.from ?? "",
      to: input.to,
      text: `${input.text}${nonce ? `\n\nChallenge: ${nonce}` : ""}\n\n${this.emailFooter()}`,
      purpose: input.purpose,
    };
    return this.runLocalTask(
      {
        taskId: input.taskId,
        kind: "email",
        plan: {
          adapter: input.adapter,
          key: input.taskId,
          params,
          activityType: "urn:activity:email-send",
          intent: {
            action: "distribute",
            target: "urn:op:email",
            operation: "urn:op:email",
            recipient: input.to,
            purpose: input.purpose,
            conversation: input.taskId,
            parameters: params,
          },
        },
      },
      nonce ? { nonce, to: input.to, purpose: input.purpose } : undefined,
    );
  }

  private namedMailbox(from: string, purpose: string): boolean {
    return [...this.gateMemory.facts.values()].some(
      (fact) =>
        fact.claimType === "contact.mailbox" &&
        fact.statement?.mailbox === from &&
        (!fact.admittedPurpose || fact.admittedPurpose === purpose),
    );
  }

  private challengeAnswered(from: string, purpose: string, text: string, nonce?: string): boolean {
    const scope = canonicalJson([from, purpose]);
    if (
      !nonce ||
      !this.namedMailbox(from, purpose) ||
      this.state.emailChallenges[scope] !== nonce ||
      !text.split(/[^A-Za-z0-9-]+/).includes(nonce)
    )
      return false;
    delete this.state.emailChallenges[scope];
    return true;
  }

  /**
   * Brief 31 §2.5: whether an admitted signed description (the configured claim kind) names
   * this mailbox. The mark is this agent's own memory, so it lasts for the whole journey.
   */
  private structuredOnly(mailbox: string): boolean {
    const kind = this.options.gates?.email?.structuredOnly;
    if (!kind) return false;
    return [...this.gateMemory.facts.values()].some(
      (fact) => fact.claimType === kind && fact.statement?.mailbox === mailbox,
    );
  }

  /** Address-only prose never enters facts or instruction channels, whatever it says. */
  receiveEmail(input: { from: string; text: string; purpose: Iri; challenge?: string }) {
    return this.exclusive(async () => {
      const sink = this.options.gates?.sink;
      const fail = (reason: ReasonCode) => {
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "source",
          verdict: "fail",
          reason,
          caption: "The prose is from an unpinned email endpoint.",
        });
        sink?.emit({
          part: "inbound-gate",
          kind: "decision",
          outcome: "refuse",
          reason,
          caption: "The email is refused before core context.",
        });
        return { ok: false as const, reason };
      };
      if (!this.options.gates?.email || !(await this.checkEmailPin(input.from, input.purpose)))
        return fail("source-unknown");
      if (typeof input.text !== "string" || !input.text || Buffer.byteLength(input.text) > 32768)
        return fail("bounds-exceeded");
      if (this.structuredOnly(input.from)) {
        // Brief 31 §2.5: once a correspondent's signed description is admitted, it is marked
        // structured only for the rest of the journey; prose from it never steps back down.
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "source",
          verdict: "fail",
          reason: "unsigned-not-allowed",
          caption:
            "This correspondent is marked structured only: its signed description was admitted, so unsigned prose from its mailbox is refused.",
        });
        sink?.emit({
          part: "inbound-gate",
          kind: "decision",
          outcome: "refuse",
          reason: "unsigned-not-allowed",
          caption: "The email is refused before core context.",
        });
        return { ok: false as const, reason: "unsigned-not-allowed" as ReasonCode };
      }
      if (
        (input.challenge || this.namedMailbox(input.from, input.purpose)) &&
        !this.challengeAnswered(input.from, input.purpose, input.text, input.challenge)
      ) {
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "source",
          verdict: "fail",
          reason: "source-unknown",
          caption:
            "The reply does not carry the challenge sent to the mailbox the signed contact statement names.",
        });
        sink?.emit({
          part: "inbound-gate",
          kind: "decision",
          outcome: "refuse",
          reason: "source-unknown",
          caption: "The email is refused before core context.",
        });
        return { ok: false as const, reason: "source-unknown" as ReasonCode };
      }
      const digest = digestContent(input.text),
        id = this.newId(),
        task = this.options.gates.taskId ?? "*";
      sink?.emit({
        part: "inbound-gate",
        kind: "check",
        check: "integrity",
        verdict: "pass",
        reason: "intact",
        caption:
          "Unsigned email bytes are digested; no signature or person identity is established.",
      });
      sink?.emit({
        part: "inbound-gate",
        kind: "check",
        check: "source",
        verdict: "pass",
        reason: "source-accepted",
        caption: input.challenge
          ? "The reply carries the challenge and comes from the mailbox the signed contact statement names: control of the mailbox, nothing about the content."
          : "Only the pinned email address is recognized; no factual claims are admitted.",
      });
      if (input.challenge) {
        // While a challenge is active the inbound run records every check (brief 31 §2.4).
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "authority",
          verdict: "not-applicable",
          reason: "no-action",
          caption: "Prose asks for nothing the agent would act on.",
        });
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "terms",
          verdict: "not-applicable",
          reason: "no-data",
          caption: "No data with terms is admitted from prose.",
        });
        sink?.emit({
          part: "inbound-gate",
          kind: "check",
          check: "fitness",
          verdict: "pass",
          reason: "fit-for-use",
          caption: "Fit only as labelled unverified content.",
        });
      }
      const part = { id, mediaType: "text/plain", bytes: input.text, digest };
      this.gateMemory.enter(task, {
        id,
        digest,
        kind: "content",
        accepted: false,
        label: "Unsigned email prose; address-only identity; never instructions or commitments",
        source: input.from,
        claimType: "unstructured-content",
        method: "unsigned-prose",
        subject: input.from,
        admittedPurpose: input.purpose,
        statement: part,
      });
      this.record({
        type: "email-content",
        id,
        digest,
        source: input.from,
        method: "unsigned-prose",
        acceptedClaims: [],
        commitment: false,
        at: this.now(),
      });
      sink?.emit({
        part: "memory",
        kind: "store",
        caption:
          "Unsigned address-only prose enters the unstructured-content channel; never facts or instructions.",
      });
      sink?.emit({
        part: "inbound-gate",
        kind: "decision",
        outcome: "admit",
        reason: "fit-for-use",
        caption: "Admit labelled unstructured content only.",
      });
      this.persist();
      return { ok: true as const, id, digest };
    });
  }

  /**
   * Statements the agent fetched or holds pass its inbound gate like any message (integrity
   * and source per statement); admitted ones are shown entering memory with their labels.
   */
  admitStatements(
    items: readonly { readonly jws: string; readonly format?: string }[],
    opts: {
      readonly subject?: Iri;
      readonly task: string;
      readonly purpose?: Iri;
      readonly taskId?: Iri;
      readonly operation?: Iri;
      readonly policyMetadata?: boolean;
    },
  ) {
    return this.exclusive(async () => {
      const result = await this.inbound.admitStatements(items, opts);
      this.persist();
      return result;
    });
  }

  storeInEvidencePod(itemId: string): Promise<void> {
    return this.exclusive(async () => {
      const pod = this.options.gates?.accessPod;
      const fact = this.gateMemory.facts.get(itemId);
      if (
        !pod ||
        pod.actor !== this.identity.actor ||
        !fact?.statement ||
        fact.subject !== pod.owner
      )
        throw new Error("No admitted statement for this pod owner");
      const original = [...this.retainedMessageViews.values()]
        .filter(
          (msg) =>
            this.state.recordMessages[msg.id]?.direction === "in" &&
            this.state.seen[msg.id]?.disposition === "accepted",
        )
        .flatMap((msg) => msg.evidence ?? [])
        .find(
          (item) =>
            isClaimEvidence(item) && digestOf(unverifiedEvidenceClaim(item)) === fact.digest,
        );
      if (!original) throw new Error("The admitted signed statement is unavailable");
      await pod.store(
        { id: itemId, claimType: fact.claimType, issuer: fact.source },
        original.value,
        (event) => this.record(event),
      );
      this.persist();
    });
  }

  readByReference(item: string, purpose: string): Promise<StepResult> {
    return this.exclusive(async () => {
      const pod = this.options.gates?.accessPod;
      const admitted = this.getDomain(`_reference:${item}`) as unknown as
        | { pointer: AccessPointer; conversation: string; delivery: string }
        | undefined;
      const key = this.keysByAlg.get("EdDSA");
      if (
        !pod ||
        !key ||
        !admitted ||
        this.state.recordMessages[admitted.delivery]?.direction !== "in"
      )
        throw new Error("No admitted pod reference for this item");
      const { pointer, conversation, delivery } = admitted;
      const conv = this.mustConversation(conversation);
      const operation = conv.operation;
      const handler = operation && this.handlers.get(operationKey(operation));
      const at = this.now();
      if (!operation || !handler?.eraseReferenceCopy) {
        this.record({
          type: "reference-read-refused",
          pointer: pointer.id,
          at,
          reason: "terms-not-acceptable",
        });
        return this.result("rejected", { reason: "terms-not-acceptable", outbound: [] });
      }
      const expired = !(
        Math.min(Date.parse(pointer.validUntil), Date.parse(pointer.copy.deleteBy)) > Date.parse(at)
      );
      const response = expired
        ? undefined
        : await pod.read(pointer, this.identity.actor, key).catch(() => undefined);
      this.record({
        type: "reference-read",
        pointer: pointer.id,
        resource: pointer.resource,
        at,
        status: response?.status ?? null,
        receipt: response?.receipt ?? null,
        digestMatches: response?.digestMatches ?? null,
      });
      const result = await this.inbound.admitStatements(
        response?.status === 200 ? [{ jws: response.body }] : [],
        {
          task: "a mortgage application",
          taskId: conversation,
          subject: pointer.owner,
          purpose,
          reference: {
            pointer,
            conversation,
            expired,
            status: response?.status ?? 0,
            receiptValid: response?.receiptValid ?? false,
            digestMatches: response?.digestMatches ?? false,
            readOnly: response?.readOnly ?? false,
            evidenceSchema: handler.referenceEvidenceSchema,
          },
        },
      );
      if (!result.admitted) {
        this.record({
          type: "reference-read-refused",
          pointer: pointer.id,
          at,
          reason: result.reason,
          status: response?.status ?? null,
          receipt: response?.receipt ?? null,
        });
        this.persist();
        return this.result("rejected", { reason: result.reason, outbound: [] });
      }
      this.scheduleReferenceErasure(pointer, operation);
      this.persist(); // The admitted statement and its grant's deadline are saved together.
      const fact = this.gateMemory.facts.get(item);
      const reply =
        fact?.statement && handler.onReferenceRead
          ? await handler.onReferenceRead(this.context(conv), pointer, copyData(fact))
          : undefined;
      const outbound =
        reply && !isTerminal(conv.phase)
          ? [
              await this.replyReceipt(
                conv,
                delivery,
                reply,
                derivedUrn("reference-read-receipt", {
                  pointer: pointer.id,
                  delivery,
                }),
              ),
            ]
          : [];
      this.persist();
      return this.result("accepted", { conversation, outbound });
    });
  }

  private scheduleReferenceErasure(pointer: AccessPointer, operation: OperationRef): void {
    this.dutyExecutor().add({
      kind: "delete",
      source: pointer.id,
      items: [pointer.item.id],
      due: pointer.copy.deleteBy,
      referenceCopy: {
        operation: { id: operation.id, version: operation.version },
        grant: pointer.terms.grant.id,
      },
    });
  }

  private withdrawalPlan(
    duty: import("./duties.js").DutyWork,
    reason: "principal" | "expiry",
  ): EffectPlan {
    const key = derivedUrn("withdraw-access", { duty: duty.id, reason });
    const parameters = { duty: duty.id, reason };
    return {
      adapter: POD_ACCESS_ADAPTER,
      key,
      params: parameters,
      activityType: WITHDRAW_ACCESS,
      intent: {
        action: "use",
        operation: WITHDRAW_ACCESS,
        target: WITHDRAW_ACCESS,
        purpose: "urn:purpose:pod-access-withdraw",
        conversation: key,
        parameters,
      },
    };
  }

  async withdrawAccess(item: string) {
    const duties = Object.values(this.state.duties.work).filter(
      (duty) =>
        duty.kind === "withdraw-access" && duty.status === "pending" && duty.items.includes(item),
    );
    for (const duty of duties) {
      const plan = this.withdrawalPlan(duty, "principal");
      await this.runTask({ taskId: plan.key, kind: "withdraw-access", plan });
    }
  }

  private ownsPodGrant(grant: PodGrant): boolean {
    const pod = this.options.gates?.accessPod;
    const { pointer, fragment } = grant;
    return (
      !!pod &&
      pod.actor === this.identity.actor &&
      pointer.issuer === pod.actor &&
      pointer.owner === pod.owner &&
      pointer.resource.startsWith(pod.folder) &&
      pointer.id === `${pointer.resource}.acl#${fragment}`
    );
  }

  private withdrawalEffectDuty(plan: EffectPlan) {
    const duty = this.state.duties.work[String(plan.params.duty)];
    const reason = plan.params.reason;
    if (
      duty?.kind !== "withdraw-access" ||
      duty.status !== "pending" ||
      !duty.grant ||
      !this.ownsPodGrant(duty.grant) ||
      (reason !== "principal" && reason !== "expiry") ||
      (reason === "expiry" &&
        !(Date.parse(this.now()) >= Date.parse(duty.grant.pointer.validUntil)))
    )
      return undefined;
    const checked = this.withdrawalPlan(duty, reason);
    return plan.key === checked.key &&
      plan.activityType === checked.activityType &&
      digestOf(plan.params) === digestOf(checked.params) &&
      actionDigest(plan.intent) === actionDigest(checked.intent)
      ? duty
      : undefined;
  }

  private async reconcilePodGrants() {
    const pod = this.options.gates?.accessPod;
    if (!pod) return;
    for (const [id, attempt] of Object.entries(this.state.pendingPodGrants)) {
      if (!this.ownsPodGrant(attempt.grant)) continue;
      try {
        await pod.withdraw(attempt.grant, "release-failed", (event) => this.record(event), attempt);
      } catch {
        this.record({
          type: "access-withdrawal-failed",
          pointer: id,
          actionDigest: attempt.actionDigest,
        });
        continue;
      }
      delete this.state.pendingPodGrants[id];
      this.persist();
    }
  }

  private async executeWithdrawal(
    params: Readonly<Record<string, unknown>>,
  ): ReturnType<EffectAdapter["execute"]> {
    const duty = this.state.duties.work[String(params.duty)];
    const reason = params.reason;
    const pod = this.options.gates?.accessPod;
    if (
      !pod ||
      !duty?.grant ||
      duty.kind !== "withdraw-access" ||
      (duty.status !== "pending" && duty.status !== "discharged") ||
      !this.ownsPodGrant(duty.grant) ||
      (reason !== "principal" && reason !== "expiry") ||
      (reason === "expiry" &&
        !(Date.parse(this.now()) >= Date.parse(duty.grant.pointer.validUntil)))
    )
      return { conclusion: "not-executed", reason: "No authorized withdrawal duty" };
    if (duty.status !== "discharged") {
      await pod.withdraw(duty.grant, reason, (event) => this.record(event));
      this.dutyExecutor().withdrawn(duty.id);
      this.persist();
    }
    return { conclusion: "completed", observed: { duty: duty.id } };
  }

  private hasTrustPin(party: string, purpose: string | undefined, kid?: string): boolean {
    return [...(this.options.gates?.pins ?? []), ...this.state.trustPins].some(
      (pin) =>
        pin.party === party &&
        pin.purpose === purpose &&
        (!kid || pin.kid === kid) &&
        Date.parse(pin.expiresAt) > Date.parse(this.now()),
    );
  }
  pendingTrustRequests() {
    return copyData(this.state.trustHolds);
  }
  submitTrustDecision(requestId: string, approvalJws: string): Promise<StepResult> {
    return this.exclusive(async () => {
      const hold = this.state.trustHolds[requestId];
      const approval = await verifyApproval(approvalJws, {
        trust: this.trust,
        actor: this.identity.actor,
        limits: this.limits,
        at: this.now(),
      });
      if (
        !hold ||
        !approval.ok ||
        approval.approval.actionDigest !== hold.digest ||
        approval.approval.conversation !== hold.message.conversation ||
        this.state.usedApprovals[approval.approval.id] ||
        Date.parse(hold.expiresAt) <= Date.parse(this.now())
      )
        return this.result("rejected", { reason: "approval-denied", outbound: [] });
      this.state.usedApprovals[approval.approval.id] = true;
      delete this.state.trustHolds[requestId];
      if (approval.approval.decision === "deny") {
        this.state.trustRefusals[digestOf(hold.message)] = true;
        this.inbound.verdictEvent("source", "fail", "The principal refused this trust decision.", {
          reason: "source-unknown",
        });
        this.inbound.decisionEvent("refuse", "The held message is refused.", "source-unknown");
        this.persist();
        return this.result("rejected", { reason: "source-unknown", outbound: [] });
      }
      if (!hold.purpose || !this.options.gates?.purposes?.[hold.purpose])
        return this.result("rejected", { reason: "purpose-not-permitted", outbound: [] });
      this.state.trustPins.push({
        kid: hold.kid,
        party: hold.party,
        purpose: hold.purpose,
        expiresAt: hold.expiresAt,
      });
      this.record({
        type: "trust-pinned",
        requestId,
        kid: hold.kid,
        party: hold.party,
        purpose: hold.purpose,
        expiresAt: hold.expiresAt,
        at: this.now(),
      });
      this.persist();
      return this.receiveGuarded(hold.wire, { binding: hold.binding });
    });
  }

  /** Rules see only this task's admitted statements. The core supplies a rule name, no inputs. */
  issueDerivationRequest(input: {
    rule: string;
    subject: string;
    purpose: string;
    assurances: DerivedRequest["assurances"];
  }): DerivedRequest {
    const rule = this.options.gates?.rules?.find((r) => r.id === input.rule);
    if (!rule) throw new Error("rule-not-accepted");
    const gate = this.options.gates ?? {};
    const requests = this.state.domain.derivedRequests as unknown as Record<string, DerivedRequest>;
    let nonce = this.newId();
    for (let attempts = 0; requests[nonce]; attempts++) {
      if (attempts >= 32) throw new Error("replay-conflict");
      nonce = this.newId();
    }
    const request: DerivedRequest = {
      ...input,
      ruleDigest: digestOf(rule),
      nonce,
      query: queryFor(rule),
      consumed: false,
      policy: proofPolicy(gate, rule, input.subject, (source, claimType) => {
        const query = {
          evaluator: this.identity.actor,
          source,
          claimType,
          subject: input.subject,
          at: this.now(),
        };
        return (
          (gate.resolver?.resolveSource(query) ?? this.trust.assessSource(query)).outcome ===
            "accepted" &&
          (!gate.claimSources?.[claimType] || gate.claimSources[claimType].includes(source))
        );
      }),
    };
    (this.state.domain.derivedRequests as unknown as Record<string, DerivedRequest>)[
      request.nonce
    ] = copyData(request);
    this.persist(); // Before the caller can send this nonce.
    return copyData(request);
  }
  async protocolStatement(
    claimType: "derivation.request" | "joint.message",
    value: JsonObject,
    purpose: string,
  ) {
    if (!this.options.sourceKey || !this.identity.party) throw new Error("unknown-key");
    const statement: JsonObject = {
      id: this.newId(),
      issuer: this.identity.party,
      subject: this.identity.party,
      claimType,
      method: "recorded-by-authority",
      asOf: this.now(),
      value,
      terms: {
        policy: {
          id: this.newId(),
          permissions: [
            {
              type: "permission",
              action: "use",
              constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: purpose }],
            },
            {
              type: "permission",
              action: "distribute",
              constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: purpose }],
            },
          ],
        },
      },
    };
    return { statement, jws: await signCompact(this.options.sourceKey, TYP.statement, statement) };
  }
  async newJointSession(
    method: string,
    params: Omit<import("../derive/verifiers.js").SessionParams, "sessionId">,
  ) {
    const protocol = this.options.gates?.jointProtocols?.get(method);
    if (!protocol) throw new Error("method-not-accepted");
    return protocol.newSession({ ...params, sessionId: randomBytes(32).toString("base64url") });
  }
  async acceptJointSession(fixed: FixedJointSession): Promise<boolean> {
    if (fixed.session.wire) {
      const protocol = this.options.gates?.jointProtocols?.get(fixed.method);
      if (!protocol) return false;
      const { wire, ruleDigest, ...params } = fixed.session;
      const made = await protocol.newSession(
        params as unknown as import("../derive/verifiers.js").SessionParams,
      );
      if (made.ruleDigest !== ruleDigest || digestOf(made.session) !== digestOf(fixed.session))
        return false;
      void wire;
    }
    if (!(await this.inbound.checkJointBindings(fixed.session))) return false;
    this.fixJointSession(fixed);
    return true;
  }
  fixJointSession(fixed: FixedJointSession): void {
    const sessions = this.state.domain.fixedJointSessions as unknown as Record<
      string,
      FixedJointSession
    >;
    const id = String(fixed.session.sessionId);
    if (sessions[id] && digestOf(sessions[id]) !== digestOf(fixed))
      throw new Error("replay-conflict");
    sessions[id] = copyData(fixed);
    this.persist();
  }
  async jointResult(ruleId: string, joint: JsonObject) {
    const rule = this.options.gates?.rules?.find((r) => r.id === ruleId);
    const protocol = this.options.gates?.jointProtocols?.get(String(joint.method));
    const session = joint.session as JsonObject,
      outcome = joint.outcome as unknown as import("../derive/verifiers.js").JointOutcome;
    const fixed = (
      this.state.domain.fixedJointSessions as unknown as Record<string, FixedJointSession>
    )[String(session.sessionId)];
    if (!rule || !protocol || !fixed || digestOf(session) !== digestOf(fixed.session))
      return { ok: false as const, reason: "derivation-not-verified" };
    const checked = await protocol.verifyOutcome({
      session,
      outcome,
      contributions: joint.contributions as JsonObject[],
    });
    if (!checked.ok || !["release", "threshold-verdict"].includes(outcome.type))
      return { ok: false as const, reason: "derivation-not-verified" };
    const value =
      outcome.type === "threshold-verdict"
        ? outcome.verdict
        : outcome.type === "release"
          ? session.statistic === "count"
            ? outcome.count
            : session.statistic === "sum"
              ? outcome.sum
              : { count: outcome.count, sum: outcome.sum }
          : undefined;
    if (value === undefined) return { ok: false as const, reason: "derivation-not-verified" };
    const issuer = this.identity.party ?? this.identity.actor;
    const statement: JsonObject = {
      id: this.newId(),
      issuer,
      subject: String(session.sessionId),
      claimType: rule.output,
      method: "derived",
      asOf: this.now(),
      value: value as Json,
      derivation: {
        rule: rule.id,
        ruleDigest: digestOf(rule),
        assurance: "joint",
        deriver: issuer,
        outputDigest: digestOf(value),
        at: this.now(),
        joint,
        inputs: [],
      },
    };
    if (!this.options.sourceKey) return { ok: false as const, reason: "unknown-key" };
    const jws = await signCompact(this.options.sourceKey, TYP.statement, statement);
    this.record({ type: "joint-derivation", statement });
    this.persist();
    return { ok: true as const, statement, jws };
  }
  derivationRelease(
    input: Parameters<OutboundGate["checkDerivationRelease"]>[0],
    contributionSession?: FixedJointSession,
  ): boolean {
    const ok = this.outbound.checkDerivationRelease(input, contributionSession);
    this.record({ type: "derivation-evidence", ...input, at: this.now() });
    this.persist();
    return ok;
  }
  proveDerived(input: {
    method: string;
    request: DerivedRequest;
    recipient: string;
    assurance: "attested" | "proved";
    proofBinds: readonly ProofBinds[];
    inputs: readonly string[];
    presentationSaltHex?: string;
  }) {
    return this.exclusive(async () => {
      const system = this.options.gates?.proofSystems?.get(input.method),
        gate = this.options.gates;
      const rule = gate?.rules?.find(
        (r) => r.id === input.request.rule && digestOf(r) === input.request.ruleDigest,
      );
      if (
        !system ||
        !rule ||
        !rule.assurances.includes(input.assurance) ||
        !input.request.assurances.includes(input.assurance)
      )
        return { ok: false as const, reason: "assurance-insufficient" };
      const receivedRequest = [...this.gateMemory.facts.values()].some(
        (f) =>
          f.claimType === "derivation.request" &&
          f.source === input.recipient &&
          digestOf(f.statement?.value) === digestOf(input.request),
      );
      if (!receivedRequest) return { ok: false as const, reason: "missing-context" };
      const facts = input.inputs.map((id) => this.gateMemory.facts.get(id));
      const credentials = input.inputs.map(
        (id) =>
          gate?.proofCredentials?.find(
            (c) => c.statement === id && c.digest === this.gateMemory.facts.get(id)?.digest,
          )?.credential,
      );
      if (
        facts.some((f) => !f || f.subject !== input.request.subject) ||
        !credentials.length ||
        credentials.some((c) => !c)
      )
        return { ok: false as const, reason: "derivation-not-verified" };
      if (
        !this.derivationRelease({
          subject: input.request.nonce,
          purpose: input.request.purpose,
          recipient: input.recipient,
          inputs: input.inputs,
          way: "proof",
        })
      )
        return { ok: false as const, reason: "prohibited" };
      const args = {
        query: queryFor(rule),
        policy: input.request.policy,
        nonce: input.request.nonce,
        credentials: [
          ...new Map((credentials as JsonObject[]).map((c) => [digestOf(c), c])).values(),
        ],
      };
      const queryCondition =
        system.kind === "real" && system.method === SPARQ_ZK_QUERY.method && isBooleanRule(rule);
      if (system.method === SPARQ_ZK_QUERY.method && input.request.policy.inputCommitment)
        args.credentials.sort((a, b) => digestOf(a).localeCompare(digestOf(b)));
      let proof = gate?.proofCache?.read(input.method, args);
      const cached = !!proof;
      if (!proof) {
        if (input.method === "sparq-noir-closed-world/0" && !gate?.generateProofs)
          return { ok: false as const, reason: "evidence-missing" };
        proof = await system.prove({
          ...args,
          ...(queryCondition ? { booleanResult: true } : {}),
          ...(input.presentationSaltHex === undefined
            ? {}
            : { presentationSaltHex: input.presentationSaltHex }),
        });
        if (gate?.generateProofs && system.kind === "real")
          gate.proofCache?.write(input.method, args, proof);
      }
      const subjectAnswer =
        system.kind === "real" && system.method === SPARQ_ZK_RESULT.method && isBooleanRule(rule);
      if (subjectAnswer && !resultSupportsSubject(proof.result, input.request.subject))
        return { ok: false as const, reason: "derivation-not-verified" };
      if (queryCondition && typeof proof.result !== "boolean")
        return { ok: false as const, reason: "derivation-not-verified" };
      const value = subjectAnswer ? true : proof.result;
      gate?.sink?.emit({
        part: "outbound-gate",
        kind: "check",
        check: "evidence",
        verdict: "pass",
        reason: "evidence-complete",
        rule: { id: "DER-23", text: "The receiver verifies this evidence now." },
        caption: cached
          ? "The proof was generated earlier from exactly the same query, policy, nonce and credential digests; the receiver verifies it now."
          : "The holder generated evidence for this exact request; the receiver must verify it.",
      });
      const issuer = this.identity.party ?? this.identity.actor;
      const statement: JsonObject = {
        id: this.newId(),
        issuer,
        subject: input.request.subject,
        claimType: rule.output,
        method: "derived",
        value,
        asOf: facts.map((f) => f?.asOf ?? this.now()).sort()[0] ?? this.now(),
        terms: {
          policy: { id: this.newId() },
          inherited: facts.map((f) => ({ target: f?.id ?? "", terms: f?.terms ?? null })),
        } as unknown as JsonObject,
        derivation: {
          rule: rule.id,
          ruleDigest: digestOf(rule),
          params: rule.params,
          assurance: input.assurance,
          proof: {
            method: input.method,
            presentation: proof.presentation,
            nonce: input.request.nonce,
          },
          proofBinds: [...input.proofBinds],
          deriver: issuer,
          at: this.now(),
          outputDigest: digestOf(value),
          inputs: facts.map((f) => ({
            id: f?.id ?? "",
            digest: f?.digest ?? "",
            issuer: f?.source ?? "",
            claimType: f?.claimType ?? "",
            method: f?.method ?? "",
            asOf: f?.asOf ?? this.now(),
          })),
        },
      };
      const key = this.options.sourceKey;
      if (!key) return { ok: false as const, reason: "unknown-key" };
      const jws = await signCompact(key, TYP.statement, statement);
      this.record({
        type: "proof-derivation",
        statement,
        requestDigest: digestOf(args),
        proofDigest: digestOf(jws),
        recipient: input.recipient,
        purpose: input.request.purpose,
        cached,
      });
      this.persist();
      return { ok: true as const, statement, jws };
    });
  }

  /** A sender may present its own gate-produced answer in the exact request's scope. */
  private authoredProofSupports(
    intent: ActionIntent,
    item: EvidenceItem,
    claimType: string,
  ): boolean {
    if (
      intent.action !== "distribute" ||
      item.role !== "credential" ||
      item.format !== "derivation+jws"
    )
      return false;
    const entries = this.ledger.entries();
    if (
      this.ledger.requiresTrustedCheckpoint &&
      !verifyLedgerAtHead(entries, this.trustedAuditHead()).ok
    )
      return false;
    const proofDigest = digestOf(item.value);
    const record = entries.findLast(
      ({ record }) =>
        record.type === "proof-derivation" &&
        record.producer !== "core" &&
        record.proofDigest === proofDigest &&
        record.recipient === intent.recipient &&
        record.purpose === intent.purpose,
    )?.record;
    const statement = record?.statement as JsonObject | undefined;
    if (!statement || statement.claimType !== claimType || !intent.purpose || !intent.recipient)
      return false;
    const at = this.now();
    const derivation = statement.derivation as JsonObject;
    const inputs = derivation.inputs as { id: string; digest: string }[];
    return (
      fitnessOf(
        StatementQualityNode.from(
          statement as unknown as import("../gates/quality.js").QualityClaim,
        ),
        this.options.gates?.reliance,
        at,
      ).verdict === "pass" &&
      inputs.every(({ id, digest }) => {
        const fact = this.gateMemory.facts.get(id);
        return (
          fact?.digest === digest &&
          (["use", "distribute"] as const).every(
            (action) =>
              evaluateItemTerms(fact.terms, {
                agent: this.identity.actor,
                action,
                target: id,
                purpose: intent.purpose,
                recipient: intent.recipient,
                at,
              }).verdict === "pass",
          )
        );
      })
    );
  }
  derive(input: {
    rule: string;
    subject: Iri;
    purpose: Iri;
    assurance?: "recomputed" | "by-source" | "attested";
  }) {
    return this.exclusive(() => this.deriveInner(input));
  }
  private async deriveInner(input: {
    rule: string;
    subject: Iri;
    purpose: Iri;
    assurance?: "recomputed" | "by-source" | "attested";
  }) {
    const task = this.options.gates?.taskId;
    if (!task) return { ok: false as const, reason: "missing-context" };
    const source = input.assurance === "by-source" || input.assurance === "attested";
    const author = source ? this.identity.party : this.identity.actor;
    const key = source ? this.options.sourceKey : this.keysByAlg.get("EdDSA");
    const sourcePin = key
      ? (this.trust.resolver("issuer")(key.kid) ?? this.trust.resolver("party")(key.kid))
      : undefined;
    if (!author || (source && (!key || sourcePin?.subject !== author)))
      return { ok: false as const, reason: "deriver-not-accepted" };
    const result = evaluateRule({
      ...input,
      rules: this.options.gates?.rules ?? [],
      sources: this.options.gates?.sourceAliases,
      memory: this.gateMemory,
      reliance: this.options.gates?.reliance,
      task,
      deriver: author,
      at: this.now(),
    });
    this.record({
      type: "derivation",
      rule: input.rule,
      outcome: result.ok ? "completed" : "refused",
      reason: result.ok ? "fit-for-use" : result.reason,
      at: this.now(),
    });
    if (!result.ok) return result;
    if (!key) return { ok: false as const, reason: "unknown-key" };
    const jws = await signCompact(key, TYP.statement, result.statement);
    this.registerIdentifier(String(result.statement.id));
    this.persist();
    return { ok: true as const, statement: result.statement, jws };
  }

  /** An internal decision is allowed only by its current agreement and every input's terms. */
  assess(input: { assessment: string; agreement: Iri; subject: Iri }) {
    return this.exclusive(async () => {
      const plan = this.options.gates?.assessments?.find((p) => p.id === input.assessment);
      const agreement = this.state.agreements[input.agreement];
      if (!plan || !agreement) return { ok: false as const, reason: "no-agreement" };
      const terms = agreement.terms;
      if (
        terms.purpose !== plan.purpose ||
        (Array.isArray(terms.prohibitedPurposes) && terms.prohibitedPurposes.includes(plan.purpose))
      )
        return { ok: false as const, reason: "purpose-not-permitted" };
      const result = await this.deriveInner({
        rule: plan.rule,
        purpose: plan.purpose,
        subject: input.subject,
      });
      if (!result.ok) return result;
      const d = result.statement.derivation as JsonObject;
      const inputs = d.inputs as JsonObject[];
      const keep = plan.keep.includes("output");
      if (keep)
        this.setDomain(
          `_assessment:${plan.id}`,
          {
            output: result.statement.value ?? null,
            claimType: result.statement.claimType ?? null,
            ruleDigest: d.ruleDigest ?? null,
            agreement: input.agreement,
            terms: result.statement.terms ?? null,
            asOf: result.statement.asOf ?? null,
            validUntil: result.statement.validUntil ?? null,
          },
          agreement.conversation,
        );
      // Erase payloads, including accepted factual support. Retain only digest-level provenance.
      const ids = new Set(inputs.map((i) => String(i.id)));
      this.erasePayloads(ids);
      if (keep)
        this.gateMemory.enter(this.options.gates?.taskId ?? agreement.conversation, {
          id: this.registerIdentifier(
            derivedUrn("assessment-output", {
              plan: plan.id,
              agreement: input.agreement,
              output: result.statement.value ?? null,
            }),
          ),
          digest: digestOf(result.statement.value),
          label: `Assessment output ${plan.id}`,
          kind: "memory",
          accepted: false,
          subject: input.subject,
          source: this.identity.actor,
          claimType: String(result.statement.claimType),
          method: "derived",
          asOf: String(result.statement.asOf),
          terms: result.statement.terms as unknown as import("../gates/common.js").ItemTerms,
        });
      const receipt = {
        assessment: plan.id,
        agreement: input.agreement,
        outputDigest: digestOf(result.statement.value),
        kept: keep ? ["output"] : [],
        discarded: [...ids],
        duty: "discharged",
        at: this.now(),
      };
      this.record({ type: "duty-discharged", ...receipt });
      this.persist();
      return { ok: true as const, receipt, ...(keep ? { statement: result.statement } : {}) };
    });
  }

  async readReference(
    reference: ResourceReference,
    holder: ResourceReader | undefined,
    purpose: Iri,
    item: Iri,
  ) {
    const fail = (reason: string) => {
      this.inbound.verdictEvent("source", "fail", `Resource read failed: ${reason}.`, { reason });
      this.inbound.decisionEvent("refuse", "The reference is not admitted.", reason);
      this.record({
        type: "resource-read-result",
        ref: reference.ref,
        item,
        purpose,
        reason,
        at: this.now(),
      });
      return { ok: false as const, reason };
    };
    if (!holder) return fail("lookup-failed");
    const key = this.keysByAlg.get("EdDSA");
    if (!key || !this.identity.party) return fail("not-authorised");
    const grantCheck = await verifyResourceGrant(
      reference.grant,
      this.trust,
      this.now(),
      this.identity.actor,
    );
    this.record(grantCheck.verification);
    const grant = grantCheck.payload;
    if (
      !grant ||
      grant.ref !== reference.ref ||
      grant.reader.actor !== this.identity.actor ||
      grant.reader.party !== this.identity.party ||
      !grant.items.some((i) => i.id === item)
    )
      return fail("not-authorised");
    if (Date.parse(grant.validUntil) <= Date.parse(this.now())) return fail("expired");
    if (grant.purpose !== purpose) return fail("purpose-not-permitted");
    if (
      digestOf([...new Set(reference.claimTypes)].sort()) !==
        digestOf([...new Set(grant.items.map((i) => i.claimType))].sort()) ||
      (reference.digest && reference.digest !== grant.digest)
    )
      return fail("evidence-invalid");
    const request = {
      type: "ResourceRead",
      id: this.newId(),
      actor: this.identity.actor,
      party: this.identity.party,
      ref: reference.ref,
      item,
      purpose,
      at: this.now(),
    };
    let result: Awaited<ReturnType<ResourceReader["read"]>>;
    try {
      result = await holder.read(
        reference,
        await signCompact(key, "awp-resource-read+jws", request),
      );
    } catch {
      return fail("lookup-failed");
    }
    if (!result.ok) return fail(result.reason);
    if (result.originals) {
      const envelope = await verifyStatement(result.jws, {
        trust: this.trust,
        typ: "awp-original-statements+jws",
        role: "issuer",
        schema: originalEnvelopeSchema,
        limits: this.limits,
        at: this.now(),
        verifier: this.identity.actor,
      });
      this.record(envelope.verification);
      const payload = envelope.payload;
      if (
        !payload ||
        envelope.signer?.subject !== grant.issuer ||
        payload.issuer !== grant.issuer ||
        payload.ref !== reference.ref ||
        payload.item !== item ||
        payload.grant !== reference.grant ||
        payload.statements.length !== 1
      )
        return fail("evidence-invalid");
      const original = payload.statements[0] as string;
      const checked = await this.inbound.assessClaim(
        { role: "credential", format: "jws-compact", value: original },
        undefined,
      );
      if (
        !checked.claim ||
        checked.claim.id !== item ||
        digestOf(checked.claim) !== payload.statementDigest ||
        !grant.items.some((i) => i.id === item && i.claimType === checked.claim?.claimType)
      )
        return fail("evidence-invalid");
      const admitted = await this.admitStatements([{ jws: original }], {
        task: this.options.gates?.taskId ?? reference.ref,
        purpose,
      });
      const fact = this.gateMemory.facts.get(item);
      if (fact) {
        const terms: import("../gates/common.js").ItemTerms = {
          policy: {
            id: grant.id,
            permissions: [
              {
                type: "permission",
                action: "use",
                target: item,
                constraints: [
                  { leftOperand: "purpose", operator: "eq", rightOperand: purpose },
                  { leftOperand: "dateTime", operator: "lt", rightOperand: grant.validUntil },
                ],
              },
            ],
          },
          inherited: [{ target: item, terms: fact.terms ?? null }],
        };
        this.gateMemory.facts.set(item, { ...fact, terms });
        for (const [scope, items] of Object.entries(this.state.contextItems))
          this.state.contextItems[scope] = items.map((i) => (i.id === item ? { ...i, terms } : i));
      }
      this.record({
        type: "original-reference-read",
        holder: grant.issuer,
        item,
        originalIssuer: checked.claim.issuer,
        digest: payload.statementDigest,
        ...admitted,
      });
      this.persist();
      return { ok: admitted.admitted === 1, ...admitted };
    }
    const response = await this.inbound.assessClaim(
      { role: "credential", format: "jws-compact", value: result.jws },
      undefined,
    );
    if (
      !response.claim ||
      response.claim.id !== item ||
      response.claim.issuer !== grant.issuer ||
      response.claim.resourceGrant !== reference.grant ||
      !grant.items.some(
        (i) => i.id === response.claim?.id && i.claimType === response.claim?.claimType,
      )
    )
      return fail("evidence-invalid");
    const admitted = await this.admitStatements([{ jws: result.jws }], {
      task: this.options.gates?.taskId ?? reference.ref,
      purpose,
    });
    this.record({
      type: "resource-read-result",
      ref: reference.ref,
      item,
      grant: result.grant.id,
      ...admitted,
      at: this.now(),
    });
    return { ok: admitted.admitted === 1, ...admitted };
  }

  /** Source address and request fields come from provenance, never from the reading value. */
  structuredRequest(claimType: string): {
    source: string;
    claimType: string;
    originalDigest: string;
  } {
    const items = this.gateMemory.context(this.options.gates?.taskId ?? "*");
    const reading = items.find((i) => i.kind === "reading" && i.claimType === claimType);
    const original = items.find(
      (i) => i.kind === "content" && i.digest === reading?.statement?.originalDigest,
    );
    if (!original)
      throw new RejectError("missing-context", "no source-bound content for this claim");
    const request = { source: original.source, claimType, originalDigest: original.digest };
    this.record({ type: "structured-form-request", ...request, at: this.now() });
    return request;
  }

  /** The host installs a reader with one immutable part and no runtime capabilities. */
  async readContent(
    partId: Iri,
    subject: Iri,
    reader: (part: Readonly<import("../core/types.js").ContentPart>) => unknown,
  ): Promise<{ readings: { statement: JsonObject; jws: string }[]; dropped: number }> {
    const task = this.options.gates?.taskId ?? "*";
    const item = this.gateMemory
      .context(task)
      .find((item) => item.kind === "content" && item.id === partId);
    if (!item?.statement) throw new RejectError("missing-context", "content part is unavailable");
    const originalPart = copyData(
      item.statement,
    ) as unknown as import("../core/types.js").ContentPart;
    const part = Object.freeze({
      ...originalPart,
      bytes: Array.isArray(originalPart.bytes)
        ? Object.freeze([...originalPart.bytes])
        : originalPart.bytes,
    });
    const output = await reader(part);
    const readings: { statement: JsonObject; jws: string }[] = [];
    let dropped = 0;
    for (const [claimType, value] of Object.entries(
      output && typeof output === "object" && !Array.isArray(output) ? output : {},
    )) {
      const declaration = this.options.gates?.readings?.find((r) => r.claimType === claimType);
      const valid = declaration && readingValueAllowed(value, declaration);
      if (!valid) {
        dropped++;
        continue;
      }
      readings.push(
        await this.recordReading({
          task,
          originalDigest: item.digest,
          claimType,
          subject,
          value: value as Json,
        }),
      );
    }
    for (const reading of readings) {
      const rule = this.options.gates?.reliance?.rules.find(
        (r) => r.claimType === reading.statement.claimType,
      );
      if (rule?.methods.includes("model-output"))
        await this.admitStatements([reading], {
          task,
          taskId: task,
          subject,
          purpose: item.admittedPurpose,
        });
    }
    return { readings, dropped };
  }

  /** UNS-3: the runtime, not the core, fixes authorship, method and provenance. */
  recordReading(input: {
    task: Iri;
    originalDigest: string;
    claimType: string;
    subject: Iri;
    value: Json;
    terms?: import("../gates/common.js").ItemTerms;
  }): Promise<{ statement: JsonObject; jws: string }> {
    return this.exclusive(async () => {
      const original = this.gateMemory
        .context(input.task)
        .find((item) => item.digest === input.originalDigest);
      if (!original)
        throw new RejectError(
          "missing-context",
          "the reading does not name content in this task's context",
        );
      if (original.kind === "content") {
        const declaration = this.options.gates?.readings?.find(
          (r) => r.claimType === input.claimType,
        );
        if (!declaration || !readingValueAllowed(input.value, declaration))
          throw new RejectError("structured-form-required", "reading is outside the declared type");
      }
      const key = this.keysByAlg.get("EdDSA");
      if (!key) throw new RejectError("unknown-key", "no authoring agent key");
      if (!this.options.core)
        throw new RejectError("missing-context", "a reading needs a declared core implementation");
      const implementation = {
        issuer: this.identity.actor,
        core: this.options.core,
        description: this.description(),
      };
      const implementationId = this.registerIdentifier(
        derivedUrn("implementation", implementation),
      );
      const implementationStatement = { id: implementationId, ...implementation };
      const implementationJws = await signCompact(key, TYP.implementation, implementationStatement);
      this.record({
        type: "implementation-statement",
        id: implementationId,
        digest: digestOf(implementationStatement),
        jws: implementationJws,
        at: this.now(),
      });
      const statement: JsonObject = {
        id: this.newId(),
        issuer: this.identity.actor,
        subject: input.subject,
        claimType: input.claimType,
        value: input.value,
        method: "model-output",
        asOf: this.now(),
        originalDigest: input.originalDigest,
        implementation: implementationId,
        implementationDigest: digestOf(implementationStatement),
      };
      // A reading inherits the original's terms. The caller cannot loosen them.
      if (original.terms) statement.terms = original.terms as unknown as Json;
      const jws = await signCompact(key, TYP.statement, statement);
      this.record({ type: "reading", statement, digest: digestOf(statement), at: this.now() });
      this.options.gates?.sink?.emit({
        part: "memory",
        kind: "store",
        caption: `Model-output reading of unstructured data ${input.originalDigest}; claim ${input.claimType}.`,
      });
      this.gateMemory.enter(input.task, {
        ...original,
        id: String(statement.id),
        label: `Reading of ${original.label}`,
        source: this.identity.actor,
        subject: input.subject,
        claimType: input.claimType,
        method: "model-output",
        kind: "reading",
        statement,
        identifiers: identifiersIn(statement),
        accepted: false,
        digest: digestOf(statement),
      });
      this.persist();
      return { statement, jws };
    });
  }

  /** Factual statements available to a core, copied from gate-held task memory only. */
  admittedStatements(): readonly JsonObject[] {
    return this.gateMemory
      .context(this.options.gates?.taskId ?? "*")
      .filter(
        (item) =>
          item.accepted === true &&
          this.gateMemory.facts.get(item.id)?.digest === item.digest &&
          !!item.statement,
      )
      .map((item) => copyData(item.statement!));
  }
  /**
   * The agreement this agent formed in one conversation, named by its terms digest, with
   * the two signed messages that formed it as this agent recorded them.
   */
  agreementProof(conversation: string): { digest: string; offer: string; acceptance: string } {
    const agreement = Object.values(this.state.agreements).find(
      (a) => a.conversation === conversation,
    );
    const offer = agreement && this.state.recordMessages[agreement.offer];
    const acceptance = agreement && this.state.recordMessages[agreement.acceptance];
    if (!agreement || !offer || !acceptance)
      throw Error(`no recorded agreement in ${conversation}`);
    return { digest: agreement.termsDigest, offer: offer.jws, acceptance: acceptance.jws };
  }

  /** This agent's record head: the sequence and chain hash of its last entry. */
  recordHead(): { seq: number; hash: string } {
    const head = this.trustedAuditHead();
    if (!head?.seq || !verifyLedgerAtHead(this.ledger.entries(), head).ok)
      throw Error("this agent's record head is unavailable");
    this.ledger.enableRangeCommitments?.();
    return head;
  }

  /**
   * Brief 31 item 4: sign a receipt for a peer's record head that this agent was shown, and
   * keep it in this agent's own record. A forum accepts a range segment anchored there.
   */
  witnessRecordHead(
    head: {
      actor: string;
      party: string;
      seq: number;
      hash: string;
      interval?: { conversation: string; from: LedgerHead };
    },
    legacyApprovals: readonly LedgerEntry[] = [],
  ): Promise<{ jws: string }> {
    return this.exclusive(async () => {
      const key = this.keysByAlg.get("EdDSA");
      if (!key || !this.identity.party) throw Error("record signing key unavailable");
      const approvalRedactions = legacyApprovals.map((entry) => {
        const redacted = legacyApprovalRedaction(entry);
        if (
          !redacted ||
          !head.interval ||
          entry.seq > head.seq ||
          entry.seq <= head.interval.from.seq ||
          !verifyLedgerRange([entry], { seq: entry.seq - 1, hash: entry.prev }, entry).ok
        )
          throw Error("invalid approval row for the witnessed interval");
        return digestOf(redacted);
      });
      const at = this.now();
      const redactions = approvalRedactions.length ? { approvalRedactions } : {};
      this.ledger.append({ type: "record-anchor-receipt", ...head, ...redactions }, at);
      const receipt = {
        type: "RecordAnchorReceipt",
        actor: this.identity.actor,
        party: this.identity.party,
        subject: head.actor,
        subjectParty: head.party,
        seq: head.seq,
        hash: head.hash,
        ...(head.interval ? { interval: head.interval } : {}),
        ...redactions,
        at,
      };
      this.persist();
      return { jws: await signCompact(key, "awp-record-anchor+jws", receipt) };
    });
  }

  /**
   * Export this agent's record for a forum. By default the segment carries the whole
   * record. With an anchor (brief 31 item 4) it carries the entries after the anchor entry,
   * the anchor's chain hash, and the peer's receipt for that anchor.
   */
  exportRecord(
    conversation: string,
    anchor?: LedgerHead & { receipt: string },
    terminal?: LedgerHead & { receipt: string },
  ): Promise<{ jws: string }> {
    return this.exclusive(async () => {
      const key = this.keysByAlg.get("EdDSA");
      if (!key || !this.identity.party) throw Error("record signing key unavailable");
      if (anchor && !terminal) throw Error("a range needs a witnessed terminal");
      const all = this.ledger.entries();
      if (
        this.ledger.requiresTrustedCheckpoint &&
        !verifyLedgerAtHead(all, this.trustedAuditHead()).ok
      )
        throw Error("this agent's record head is unavailable");
      const entries = all.filter(
        (entry) => entry.seq > (anchor?.seq ?? 0) && (!terminal || entry.seq <= terminal.seq),
      );
      if (terminal && !verifyLedgerRange(entries, anchor ?? LEDGER_GENESIS, terminal).ok)
        throw Error("the retained record does not match the witnessed interval");
      let witnessedApprovals: readonly string[] = [];
      if (
        terminal &&
        entries.some((entry) => legacyApprovalRedaction(entry) && !entry.recordDigest)
      ) {
        const verified = await verifyStatement(terminal.receipt, {
          trust: this.trust,
          typ: "awp-record-anchor+jws",
          role: "actor",
          schema: anchorReceiptSchema,
          limits: RECORD_LIMITS,
          at: this.now(),
          verifier: this.identity.actor,
        });
        const receipt = verified.payload;
        if (
          receipt &&
          verified.signer?.subject === receipt.actor &&
          verified.signer.party === receipt.party &&
          receipt.party !== this.identity.party &&
          receipt.subject === this.identity.actor &&
          receipt.subjectParty === this.identity.party &&
          receipt.seq === terminal.seq &&
          receipt.hash === terminal.hash &&
          receipt.interval?.conversation === conversation &&
          digestOf(receipt.interval.from) ===
            digestOf(anchor ? { seq: anchor.seq, hash: anchor.hash } : LEDGER_GENESIS)
        )
          witnessedApprovals = receipt.approvalRedactions ?? [];
      }
      const messages: { direction: "in" | "out"; digest: string; jws: string }[] = [];
      for (const { direction, digest, jws, conversation: recorded } of Object.values(
        this.state.recordMessages,
      )) {
        if (recorded !== conversation) continue;
        if (
          !entries.some(
            ({ record }) =>
              record.type === `message-${direction}` &&
              record.digest === digest &&
              (!anchor || this.rangeMessageRecord(record, conversation)),
          )
        )
          continue;
        if (anchor && !(await this.rangeMessage(jws, conversation, digest))) continue;
        messages.push({ direction, digest, jws });
      }
      const signed = await Promise.all(
        entries.map(async (entry) => {
          let disclosed: LedgerRangeEntry = entry;
          const approval = legacyApprovalRedaction(entry);
          if (
            approval ||
            (anchor &&
              !messages.some(
                ({ direction, digest }) =>
                  this.rangeMessageRecord(entry.record, conversation) &&
                  entry.record.type === `message-${direction}` &&
                  entry.record.digest === digest,
              ))
          ) {
            if (
              !entry.recordDigest &&
              (!approval || !witnessedApprovals.includes(digestOf(approval)))
            )
              throw Error("record has no commitment for redaction");
            disclosed = approval ?? { ...entry, record: null };
          }
          return {
            entry: disclosed,
            proof: await signCompact(key, "awp-record-entry+jws", disclosed),
          };
        }),
      );
      const segment = {
        type: "RecordSegment",
        actor: this.identity.actor,
        party: this.identity.party,
        conversation,
        ...(anchor ? { anchor } : {}),
        ...(terminal ? { terminal } : {}),
        entries: signed,
        messages,
      };
      return { jws: await signCompact(key, "awp-record-segment+jws", segment) };
    });
  }

  private rangeMessageRecord(record: LedgerEntry["record"], conversation: string): boolean {
    const keys =
      record.type === "message-in"
        ? [
            "type",
            "id",
            "kind",
            "conversation",
            "digest",
            "from",
            "onBehalfOfClaim",
            "binding",
            "at",
          ]
        : ["type", "id", "kind", "conversation", "digest", "at"];
    return (
      (record.type === "message-in" || record.type === "message-out") &&
      record.conversation === conversation &&
      record.kind === "invoke" &&
      Object.keys(record).every((key) => keys.includes(key)) &&
      typeof record.digest === "string" &&
      /^sha-256:[0-9a-f]{64}$/.test(record.digest) &&
      (record.binding === undefined ||
        ["direct", "direct-local/0.1"].includes(String(record.binding)))
    );
  }

  /** The range format carries the original structured fee notice and its signed credential. */
  private async rangeMessage(
    jws: string,
    conversation: string,
    digest: string,
  ): Promise<string | undefined> {
    const verified = await this.readRecordMessage(jws);
    const message = verified?.message;
    if (
      !message ||
      digestOf(message) !== digest ||
      message.conversation !== conversation ||
      message.kind !== "invoke" ||
      message.body.operation.id !== "urn:op:fee-notice" ||
      message.body.basis.kind !== "represented" ||
      message.content?.length ||
      message.authorship ||
      Object.keys(message.body.input).length !== 0
    )
      return undefined;
    let item: string | undefined;
    for (const evidence of message.evidence ?? []) {
      if (evidence.format !== "jws-compact") return undefined;
      if (evidence.role === "representation") {
        const proof = await verifyStatement(evidence.value, {
          trust: this.trust,
          typ: TYP.representation,
          role: "party",
          schema: representationSchema,
          limits: this.limits,
          verifier: this.identity.actor,
          at: this.now(),
        });
        if (
          !proof.payload ||
          proof.signer?.subject !== message.from.onBehalfOf ||
          proof.payload.actor !== message.from.actor ||
          proof.payload.party !== message.from.onBehalfOf
        )
          return undefined;
        continue;
      }
      if (evidence.role !== "credential" || item) return undefined;
      item = await this.rangeCredential(evidence.value);
      if (!item) return undefined;
    }
    return item;
  }

  private readRecordMessage(jws: string) {
    return verifyRecordedMessage(jws, this.trust, (kid) => {
      const key = [...this.keysByAlg.values()].find((value) => value.kid === kid);
      return key && this.identity.party
        ? {
            kid,
            alg: key.alg,
            publicJwk: key.publicJwk,
            role: "actor",
            subject: this.identity.actor,
            party: this.identity.party,
          }
        : undefined;
    });
  }

  private async rangeCredential(jws: string, feeOnly = true): Promise<string | undefined> {
    const verify = (role: "issuer" | "party") =>
      verifyStatement(jws, {
        trust: this.trust,
        typ: TYP.statement,
        role,
        schema: claimSchema,
        limits: this.limits,
        verifier: this.identity.actor,
        at: this.now(),
      });
    let checked = await verify("issuer");
    if (checked.verification.outcome === "unknown-key") checked = await verify("party");
    const claim = checked.payload;
    if (
      !claim ||
      (feeOnly && claim.claimType !== "fee.charged") ||
      checked.signer?.subject !== claim.issuer ||
      !claim.id ||
      this.gateMemory.facts.get(claim.id)?.digest !== digestOf(decodeCompactPayload(jws))
    )
      return undefined;
    return claim.id;
  }

  private async readOwnRecordProof(jws: string, typ: string): Promise<unknown> {
    const checked = await verifyCompact(jws, {
      typ,
      limits: RECORD_LIMITS,
      allowedAlgs: ["EdDSA"],
      resolve: (kid) => [...this.keysByAlg.values()].find((key) => key.kid === kid),
    });
    return checked.outcome === "valid" ? checked.payload : undefined;
  }

  /** Whole-record rows may repeat original statements. Inspect both the row and its proof. */
  private wholeRecordItems(value: unknown, items: Set<string>): boolean {
    if (typeof value === "string")
      return !value.startsWith("awp-jsonld-gzip:") && !/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(value);
    if (!value || typeof value !== "object") return true;
    if (Array.isArray(value)) return value.every((item) => this.wholeRecordItems(item, items));
    const record = value as Record<string, unknown>;
    if (record.type === "approval" && "jws" in record) return false;
    if (typeof record.claimType === "string" && typeof record.issuer === "string") {
      if (
        typeof record.id !== "string" ||
        this.gateMemory.facts.get(record.id)?.digest !== digestOf(record)
      )
        return false;
      items.add(record.id);
    }
    return Object.values(record).every((item) => this.wholeRecordItems(item, items));
  }

  /** Inventory signed companion payloads by their exact proof bytes and authenticated owner. */
  async recordReleaseProofs(
    segment: import("zod").infer<typeof recordSegmentSchema>,
    agreement?: { offer: string; acceptance: string },
    whole?: { segment: string; observation?: string },
  ) {
    const proofs = new Map<string, { digest: string; issuer: string; label: string }>();
    const credentials = new Set<string>();
    const add = (proof: string, issuer: string, label: string) => {
      const digest = digestOf(proof);
      proofs.set(digest, { digest, issuer, label });
    };
    if (whole) add(whole.segment, segment.party, "Signed whole record");
    for (const [proof, kind, archived] of [
      ...segment.messages.map(
        (message) => [message.jws, whole ? undefined : "invoke", message] as const,
      ),
      ...(agreement
        ? ([
            [agreement.offer, "propose", undefined],
            [agreement.acceptance, "accept", undefined],
          ] as const)
        : []),
    ]) {
      const verified = await this.readRecordMessage(proof);
      const message = verified?.message;
      if (
        !message ||
        (kind && message.kind !== kind) ||
        (archived &&
          (message.conversation !== segment.conversation ||
            digestOf(message) !== archived.digest)) ||
        message.from.actor !== verified.pinned.subject ||
        !message.from.onBehalfOf ||
        message.from.onBehalfOf !== verified.pinned.party
      )
        return undefined;
      add(
        proof,
        message.from.onBehalfOf,
        kind === "propose"
          ? "Signed agreement offer"
          : kind === "accept"
            ? "Signed agreement acceptance"
            : kind === "invoke"
              ? "Signed fee invoke"
              : "Signed record message",
      );
      for (const item of message.evidence ?? []) {
        if (item.format !== "jws-compact") return undefined;
        if (item.role === "credential") {
          const id = await this.rangeCredential(item.value, false);
          if (!id) return undefined;
          credentials.add(id);
          continue;
        }
        if (item.role !== "representation") return undefined;
        const signed = await verifyStatement(item.value, {
          trust: this.trust,
          typ: TYP.representation,
          role: "party",
          schema: representationSchema,
          limits: this.limits,
          verifier: this.identity.actor,
          at: this.now(),
        });
        if (
          signed.signer?.subject !== message.from.onBehalfOf ||
          signed.payload?.party !== message.from.onBehalfOf ||
          signed.payload.actor !== message.from.actor
        )
          return undefined;
        add(item.value, signed.payload.party, "Signed representation");
      }
    }
    if (whole?.observation) {
      const checked = await verifyStatement(whole.observation, {
        trust: this.trust,
        typ: TYP.statement,
        role: "issuer",
        schema: claimSchema,
        limits: this.limits,
        verifier: this.identity.actor,
        at: this.now(),
      });
      const claim = checked.payload;
      if (!claim || checked.signer?.subject !== claim.issuer) return undefined;
      const id = await this.rangeCredential(whole.observation, false);
      if (id) credentials.add(id);
      else if (claim.claimType !== "onward.observation" || claim.terms !== undefined)
        return undefined;
      add(whole.observation, claim.issuer, "Signed observation");
    }
    return { proofs: [...proofs.values()], credentials: [...credentials] };
  }

  private async recordProofItems(
    inventory: NonNullable<Awaited<ReturnType<AgentRuntime["recordReleaseProofs"]>>>,
    grants: readonly unknown[],
    intent: ActionIntent,
    whole: boolean,
  ): Promise<string[] | undefined> {
    const available = new Map(inventory.proofs.map((proof) => [proof.digest, proof]));
    const facts: import("../gates/common.js").AdmittedFact[] = [];
    for (const jws of grants) {
      if (typeof jws !== "string") return undefined;
      const options = {
        trust: this.trust,
        typ: RECORD_PROOF_GRANT_TYP,
        schema: recordProofGrantSchema,
        limits: this.limits,
        at: this.now(),
        verifier: this.identity.actor,
      };
      let checked = await verifyStatement(jws, { ...options, role: "party" });
      if (whole && checked.verification.outcome === "unknown-key")
        checked = await verifyStatement(jws, { ...options, role: "issuer" });
      const { payload, signer } = checked;
      if (!payload) return undefined;
      const proof = available.get(payload.digest);
      if (
        !proof ||
        (signer?.role === "issuer" && proof.label !== "Signed observation") ||
        payload.issuer !== proof.issuer ||
        signer?.subject !== proof.issuer ||
        payload.holder !== this.identity.actor ||
        payload.recipient !== intent.recipient ||
        payload.purpose !== intent.purpose ||
        Date.parse(payload.validUntil) <= Date.parse(this.now())
      )
        return undefined;
      available.delete(payload.digest);
      const id = derivedUrn("record-proof", payload);
      facts.push({
        id,
        label: proof.label,
        source: proof.issuer,
        claimType: "record.proof",
        digest: proof.digest,
        terms: {
          policy: {
            id: derivedUrn("record-proof-grant", jws),
            permissions: [
              {
                type: "permission",
                action: "distribute",
                target: id,
                constraints: [
                  { leftOperand: "recipient", operator: "eq", rightOperand: payload.recipient },
                  { leftOperand: "purpose", operator: "eq", rightOperand: payload.purpose },
                ],
              },
            ],
          },
        },
      });
    }
    if (
      available.size ||
      facts.some(
        ({ id }) =>
          this.gateMemory.facts.has(id) &&
          this.gateMemory.facts.get(id)?.claimType !== "record.proof",
      )
    )
      return undefined;
    if (whole) return inventory.credentials;
    for (const fact of facts) this.gateMemory.facts.set(fact.id, fact);
    return [...inventory.credentials, ...facts.map(({ id }) => id)];
  }

  /** Derive disclosure from the actual signed request, record and companion proofs. */
  private async recordDisclosures(
    parameters: NamedValuesNode,
    intent: ActionIntent,
    rangeOnly: boolean,
  ): Promise<string[] | undefined> {
    const params = parameters.live;
    if (
      Array.isArray(params) ||
      typeof params.request !== "string" ||
      (params.operation !== "submit" && params.operation !== "answer") ||
      Object.keys(params).some(
        (key) => !["operation", "recordFrom", "evidence", "request", "proofGrants"].includes(key),
      )
    )
      return undefined;
    try {
      const submit = params.operation === "submit";
      const request = (submit ? forumClaimSchema : forumAnswerSchema).parse(
        await this.readOwnRecordProof(
          params.request,
          submit ? "awp-forum-claim+jws" : "awp-forum-answer+jws",
        ),
      );
      const segment = recordSegmentSchema.parse(
        await this.readOwnRecordProof(request.segment, "awp-record-segment+jws"),
      );
      if (
        !segment.terminal ||
        (rangeOnly && !segment.anchor) ||
        segment.anchor?.seq !== params.recordFrom ||
        segment.actor !== this.identity.actor ||
        segment.party !== this.identity.party ||
        request.actor !== segment.actor ||
        request.party !== segment.party
      )
        return undefined;
      const grants = params.proofGrants ?? [];
      if (!Array.isArray(grants)) return undefined;
      if (request.type === "ForumAnswer") {
        const checked = await verifyStatement(request.request, {
          typ: "awp-record-request+jws",
          trust: this.trust,
          role: "issuer",
          schema: recordRequestSchema,
          limits: RECORD_LIMITS,
          verifier: this.identity.actor,
          at: this.now(),
        });
        const charge = checked.payload;
        if (
          !charge ||
          charge.issuer !== intent.recipient ||
          checked.signer?.subject !== charge.issuer ||
          charge.case !== request.case ||
          charge.respondent !== segment.party ||
          charge.conversation !== segment.conversation
        )
          return undefined;
      }
      for (const point of [
        segment.anchor,
        segment.terminal,
        "answerThrough" in request ? request.answerThrough : undefined,
      ]) {
        if (!point) continue;
        const checked = await verifyStatement(point.receipt, {
          typ: "awp-record-anchor+jws",
          trust: this.trust,
          role: "actor",
          schema: anchorReceiptSchema,
          limits: RECORD_LIMITS,
          verifier: this.identity.actor,
          at: this.now(),
        });
        const receipt = checked.payload;
        if (
          !receipt ||
          checked.signer?.subject !== receipt.actor ||
          checked.signer.party !== receipt.party ||
          receipt.seq !== point.seq ||
          receipt.hash !== point.hash
        )
          return undefined;
      }
      if (!segment.anchor) {
        const items = new Set<string>();
        for (const { entry, proof } of segment.entries) {
          const signed = rangeEntrySchema.parse(
            await this.readOwnRecordProof(proof, "awp-record-entry+jws"),
          );
          if (
            !this.wholeRecordItems(entry.record, items) ||
            !this.wholeRecordItems(signed.record, items)
          )
            return undefined;
        }
        const inventory = await this.recordReleaseProofs(
          segment,
          "agreement" in request ? request.agreement : undefined,
          {
            segment: request.segment,
            observation: "observation" in request ? request.observation : undefined,
          },
        );
        if (!inventory) return undefined;
        const allowed = await this.recordProofItems(inventory, grants, intent, true);
        return allowed && [...new Set([...allowed, ...items])];
      }
      const entries = segment.entries.map(({ entry }) => entry) as LedgerRangeEntry[];
      const hasMessage = (entry: LedgerRangeEntry, digest: string, direction: string) =>
        entry.record?.digest === digest && entry.record.type === `message-${direction}`;
      const items = new Set<string>();
      for (const { entry, proof } of segment.entries) {
        const payload = await this.readOwnRecordProof(proof, "awp-record-entry+jws");
        if (
          !payload ||
          digestOf(payload) !== digestOf(entry) ||
          (entry.record &&
            (!this.rangeMessageRecord(entry.record, segment.conversation) ||
              !segment.messages.some(({ digest, direction }) =>
                hasMessage(entry, digest, direction),
              )))
        )
          return undefined;
      }
      for (const message of segment.messages) {
        if (!entries.some((entry) => hasMessage(entry, message.digest, message.direction)))
          return undefined;
        const item = await this.rangeMessage(message.jws, segment.conversation, message.digest);
        if (!item) return undefined;
        items.add(item);
      }
      if ("observation" in request && request.observation) {
        const item = await this.rangeCredential(request.observation);
        if (!item) return undefined;
        items.add(item);
        if ("agreement" in request && request.agreement) {
          const fact = this.gateMemory.facts.get(item);
          const binding = fact?.statement?.agreement as
            | {
                conversation?: string;
                discloseTo?: string;
                discloseFor?: string;
              }
            | undefined;
          if (
            !binding?.conversation ||
            binding.discloseTo !== intent.recipient ||
            binding.discloseFor !== intent.purpose ||
            digestOf(request.agreement) !== digestOf(this.agreementProof(binding.conversation))
          )
            return undefined;
        }
      } else if ("agreement" in request && request.agreement) return undefined;
      const inventory = await this.recordReleaseProofs(
        segment,
        "agreement" in request ? request.agreement : undefined,
      );
      if (!inventory) return undefined;
      const proofs = await this.recordProofItems(inventory, grants, intent, false);
      if (!proofs) return undefined;
      return [...new Set([...items, ...proofs])];
    } catch {
      return undefined;
    }
  }

  /**
   * Brief 32 §3: audit this agent's own record. Every outbound release is re-evaluated at its
   * recorded time against the mandate in force then (by the same mandate method `authorise`
   * uses), never trusting the recorded outcome. All events go on part `record`, so the audit
   * is not a gate run. A `record-audit` entry names the component statement in force, the
   * mandate, the counts and each release found outside the mandate.
   */
  auditRecord(): Promise<RecordAuditResult> {
    return this.exclusive(async () => {
      const sink = this.options.gates?.sink;
      const at = this.now();
      const audit = await auditReleases(
        this.ledger.entries(),
        (action, when, mandate) => {
          if (this.mandate?.digest !== mandate.digest || this.mandate.mandate.id !== mandate.id)
            return undefined;
          this.reauthorising = true;
          try {
            return this.mandateDecision(action, when, new Map());
          } finally {
            this.reauthorising = false;
          }
        },
        {
          head: this.trustedAuditHead(),
          verifyApproval: async (entry, release) => {
            const id = entry.record.id;
            if (typeof id !== "string") return undefined;
            const jws =
              typeof entry.record.jws === "string"
                ? entry.record.jws
                : typeof entry.record.proofDigest === "string"
                  ? this.state.auditApprovalProofs[entry.record.proofDigest]
                  : undefined;
            if (
              !jws ||
              (entry.record.jws === undefined && digestOf(jws) !== entry.record.proofDigest)
            )
              return undefined;
            const checked = await verifyApproval(jws, {
              trust: this.trust,
              actor: this.identity.actor,
              limits: this.limits,
              at: release.at,
            });
            if (!checked.ok && checked.verification.outcome === "unknown-key") return undefined;
            return (
              checked.ok &&
              checked.approval.id === id &&
              checked.approval.decision === "approve" &&
              checked.approval.actionDigest === release.digest &&
              checked.approval.conversation === release.action.conversation
            );
          },
        },
      );
      const component = [...this.gateMemory.facts.values()].find(
        (fact) => fact.claimType === "agent.components" && fact.subject === this.identity.actor,
      )?.digest;
      const gateRun = ++this.auditGateRun;
      if (audit.chain === "broken") {
        sink?.emit({
          part: "record",
          kind: "check",
          gateRun,
          check: "evidence",
          verdict: "fail",
          reason: "record-unavailable",
          caption: "This agent's record does not verify, so its releases cannot be audited.",
        });
        sink?.emit({
          part: "record",
          kind: "decision",
          gateRun,
          outcome: "stop",
          reason: "record-unavailable",
          caption: "The audit stops: the record is not intact.",
        });
        return { ok: false, judged: 0, inside: 0, unjudged: 0, outside: [], released: [] };
      }
      for (const release of audit.judged)
        sink?.emit({
          part: "record",
          kind: "check",
          gateRun,
          check: "evidence",
          verdict:
            release.verdict === "inside"
              ? "pass"
              : release.verdict === "outside"
                ? "fail"
                : "indeterminate",
          reason: release.reason,
          caption:
            release.verdict === "inside"
              ? `A ${release.action.action} action released at ${release.at} is within the mandate in force then.`
              : release.verdict === "outside"
                ? `A ${release.action.action} action released at ${release.at} is outside the mandate in force then: re-evaluated, the mandate does not allow it, although the record says it was permitted.`
                : `A ${release.action.action} action released at ${release.at} cannot be judged from the retained mandate and approval evidence.`,
        });
      if (audit.unjudged.length)
        sink?.emit({
          part: "record",
          kind: "record",
          caption: `${audit.unjudged.length} replies inside agreed exchanges carry no authorisation decision; they are reported, not judged.`,
        });
      const outside = audit.outside.filter((release) => release.verdict === "outside");
      const indeterminate = audit.outside.length - outside.length + (audit.pruned ? 1 : 0);
      sink?.emit({
        part: "record",
        kind: "decision",
        gateRun,
        outcome: outside.length ? "ask-principal" : indeterminate ? "indeterminate" : "go",
        ...(outside.length
          ? { reason: "not-authorised" as const }
          : indeterminate
            ? { reason: "record-unavailable" as const }
            : {}),
        caption: outside.length
          ? "The audit found a release outside the mandate. Sam decides whether to claim."
          : indeterminate
            ? "The record is missing evidence needed to judge some releases."
            : "Every judged release is within the mandate in force when it was released.",
      });
      if (outside.length)
        sink?.emit({
          part: "principal",
          kind: "record",
          chat: {
            who: "agent",
            text: `Your agent's record shows ${outside.length === 1 ? "one action" : `${outside.length} actions`} released although your mandate did not allow ${outside.length === 1 ? "it" : "them"}: ${outside.map((release) => `a ${release.action.action} at ${release.at}`).join("; ")}. You can send a claim to the gate's operator.`,
          },
          caption: "The agent tells Sam what the audit found.",
        });
      const mandate = this.mandate
        ? { id: this.mandate.mandate.id, digest: this.mandate.digest }
        : undefined;
      const findings = outside.map((release) => ({
        actionDigest: release.actionDigest,
        decision: release.decision,
        release: release.release,
      }));
      this.record({
        type: "record-audit",
        actor: this.identity.actor,
        ...(component ? { statement: component } : {}),
        ...(mandate ? { mandate } : {}),
        judged: audit.judged.length,
        inside: audit.judged.length - audit.outside.length,
        outside: findings,
        indeterminate,
        unjudged: audit.unjudged.length,
        at,
      });
      const entry = this.ledger.entries().at(-1);
      this.persist();
      return {
        ok: indeterminate === 0,
        judged: audit.judged.length,
        inside: audit.judged.length - audit.outside.length,
        unjudged: audit.unjudged.length,
        outside: findings,
        released: audit.judged.map((release) => ({
          actionDigest: release.actionDigest,
          verdict: release.verdict,
        })),
        ...(component ? { statement: component } : {}),
        ...(mandate ? { mandate } : {}),
        ...(entry ? { entry: { seq: entry.seq, hash: entry.hash } } : {}),
      };
    });
  }

  /**
   * Brief 32: does this agent's own record support an outgoing record-backed statement? A
   * `record-audit` entry must list the claimed action digest as outside the mandate, and the
   * recipient must be the gate operator an admitted component statement names.
   */
  private recordBacks(claim: Readonly<Record<string, unknown>>, recipient: string): boolean {
    const entries = this.ledger.entries();
    if (!verifyLedgerAtHead(entries, this.trustedAuditHead()).ok) return false;
    const auditEntry = entries.find((entry) => entry.hash === claim.audit);
    const audit = auditEntry?.record;
    if (
      !auditEntry ||
      audit?.type !== "record-audit" ||
      audit.producer === "core" ||
      audit.actor !== this.identity.actor ||
      claim.subject !== recipient ||
      typeof claim.action !== "string" ||
      typeof claim.components !== "string" ||
      audit.statement !== claim.components ||
      !audit.mandate ||
      !claim.mandate ||
      canonicalJson(audit.mandate) !== canonicalJson(claim.mandate) ||
      !Array.isArray(audit.outside) ||
      !audit.outside.some((finding) => {
        if (!finding || finding.actionDigest !== claim.action || !claim.range) return false;
        const { decision, release } = finding;
        if (
          !decision ||
          !release ||
          canonicalJson(claim.range) !== canonicalJson({ decision, release })
        )
          return false;
        const authored = entries.find(
          (entry) => entry.seq === decision.seq && entry.hash === decision.hash,
        );
        const released = entries.find(
          (entry) => entry.seq === release.seq && entry.hash === release.hash,
        );
        const policy = authored?.record.policy as AuthorisationDecision["policy"] | undefined;
        return (
          !!authored &&
          !!released &&
          authored.seq < released.seq &&
          released.seq < auditEntry.seq &&
          authored.record.type === "authorisation-decision" &&
          authored.record.producer !== "core" &&
          authored.record.decider === this.identity.actor &&
          authored.record.actionDigest === claim.action &&
          !!authored.record.action &&
          actionDigest(authored.record.action as ActionIntent) === claim.action &&
          canonicalJson({ id: policy?.id ?? null, digest: policy?.digest ?? null }) ===
            canonicalJson(claim.mandate) &&
          released.record.type === "gate-decision" &&
          released.record.producer !== "core" &&
          released.record.agent === this.identity.actor &&
          released.record.gate === "outbound-gate" &&
          released.record.outcome === "go" &&
          !entries.some(
            ({ seq, record }) =>
              seq > authored.seq &&
              seq < released.seq &&
              record.producer !== "core" &&
              (record.type === "authorisation-decision" ||
                (record.type === "gate-decision" && record.gate === "outbound-gate")),
          )
        );
      })
    )
      return false;
    return [...this.gateMemory.facts.values()].some(
      (fact) =>
        fact.claimType === "agent.components" &&
        fact.digest === claim.components &&
        fact.subject === this.identity.actor &&
        (fact.statement?.agent === undefined || fact.statement.agent === this.identity.actor) &&
        (fact.statement?.gate as { operatedBy?: unknown } | undefined)?.operatedBy === recipient,
    );
  }

  /** Check this agent's own record and show it in the trace. */
  checkRecord(entries: readonly LedgerEntry[]): {
    ok: boolean;
    attributions: readonly { digest: string; signer: string }[];
  } {
    const v = verifyLedger(entries);
    this.options.gates?.sink?.emit({
      part: "record",
      kind: "record",
      caption: `${entries.length} entries in this agent's hash-chained record; the chain ${
        v.ok ? "verifies" : "does not verify"
      }.`,
    });
    const attributions = v.ok
      ? entries.flatMap(({ record }) =>
          record.type === "verification" &&
          record.outcome === "valid" &&
          typeof record.protectedObject === "string" &&
          typeof record.attributedTo === "string"
            ? [{ digest: record.protectedObject, signer: record.attributedTo }]
            : [],
        )
      : [];
    return { ok: v.ok, attributions };
  }

  close(): void {
    this.closed = true;
    this.store.close();
  }

  /**
   * Open a negotiation. With `discover`, a `describe` is sent first and the proposal
   * follows once a compatible configuration is selected from the peer's description.
   */
  async startNegotiation(input: {
    peer: { actor: Iri; party?: Iri };
    operation: OperationRef;
    terms: JsonObject;
    models: readonly { id: string; version: string }[];
    discover?: boolean;
    configuration?: string;
    evidence?: readonly EvidenceItem[];
    content?: readonly import("../core/types.js").ContentPart[];
    conditions?: readonly DisclosureCondition[];
    /**
     * Caller-chosen conversation id (must be new). Lets a caller record its intent BEFORE the
     * call and later prove from this runtime's state whether the negotiation was started.
     */
    conversation?: Iri;
  }): Promise<StepResult> {
    return this.exclusive(async () => {
      const terms = input.terms.compensation
        ? await withPaymentOffer(input.terms, input.peer.party)
        : input.terms;
      return this.start({
        ...input,
        plan: {
          type: "propose",
          operation: input.operation,
          terms,
          models: input.models,
          ...(input.evidence ? { evidence: input.evidence } : {}),
          ...(input.content ? { content: input.content } : {}),
          ...(input.conditions ? { conditions: input.conditions } : {}),
        },
      });
    });
  }

  async startInvocation(input: {
    peer: { actor: Iri; party?: Iri };
    operation: OperationRef;
    input: JsonObject;
    basis: JsonObject;
    purpose?: Iri;
    models: readonly { id: string; version: string }[];
    discover?: boolean;
    configuration?: string;
    conversation?: Iri;
    evidence?: readonly EvidenceItem[];
    content?: readonly import("../core/types.js").ContentPart[];
    conditions?: readonly DisclosureCondition[];
  }): Promise<StepResult> {
    return this.exclusive(async () => {
      if (input.basis.kind === "agreement") {
        // Performance under an agreement happens in the agreement's own conversation.
        this.record({
          type: "local-refusal",
          reason: "no-agreement",
          detail: "use invokeUnderAgreement within the agreed conversation",
          at: this.now(),
        });
        return this.result("local", {
          reason: "no-agreement",
          detail: "no agreement in a new conversation",
          outbound: [],
        });
      }
      return this.start({
        ...input,
        plan: {
          type: "invoke",
          operation: input.operation,
          input: input.input,
          basis: input.basis,
          ...(input.purpose ? { purpose: input.purpose } : {}),
          models: input.models,
          ...(input.evidence ? { evidence: input.evidence } : {}),
          ...(input.content ? { content: input.content } : {}),
          ...(input.conditions ? { conditions: input.conditions } : {}),
        },
      });
    });
  }

  /**
   * Report an activity outcome in an existing conversation (e.g. a lender's application-
   * state receipt after internal processing). Receipts disclose no new data to new parties.
   */
  async sendReceipt(
    conversationId: Iri,
    body: {
      activity: Iri;
      outcome: "completed" | "not-executed" | "uncertain";
      observed?: JsonObject;
      final: boolean;
    },
    /** Protected statements to carry with the receipt (e.g. a signed decision). */
    evidence: readonly EvidenceItem[] = [],
  ): Promise<StepResult> {
    return this.exclusive(async () => {
      const conv = this.mustConversation(conversationId);
      const out = await this.emit(
        conv.id,
        "receipt",
        { ref: conv.agreement ?? conv.id, ...body },
        evidence.length > 0 ? { evidence } : {},
      );
      this.persist();
      const after = this.state.conversations[conv.id];
      return this.result("local", {
        conversation: conv.id,
        ...(after ? { phase: after.phase } : {}),
        outbound: [out],
      });
    });
  }

  private async start(input: {
    peer: { actor: Iri; party?: Iri };
    plan: StartPlan;
    discover?: boolean;
    configuration?: string;
    conversation?: Iri;
  }): Promise<StepResult> {
    this.decisions = [];
    const at = this.now();
    this.guardCapacity();
    const id = input.conversation ?? this.newId();
    if (!input.conversation) this.state.generatedConversations[id] = true;
    if (this.state.conversations[id]) throw new Error(`conversation ${id} exists`);
    // Discovery runs under the most preferred local configuration; a peer that does not
    // accept it answers `unsupported`, so any description received implies it is shared.
    const configuration = input.configuration ?? this.options.accepted[0];
    const conv = openConversation({
      id,
      role: "initiator",
      peer: input.peer,
      ...(configuration ? { configuration } : {}),
      at,
    });
    this.state.conversations[id] = conv;
    this.setDomain(`_start:${id}`, input.plan as unknown as Json, id);
    if (input.discover !== false || !input.configuration) {
      const discoveryConfig = input.configuration ?? this.options.accepted[0];
      if (!discoveryConfig) throw new Error("no accepted configuration");
      const out = await this.emit(
        id,
        "describe",
        {},
        { configuration: discoveryConfig, evidence: input.plan.evidence ?? [] },
      );
      this.persist();
      return this.result("local", { conversation: id, outbound: [out] });
    }
    const outbound = await this.continueStart(id);
    this.persist();
    return this.result(outbound.pending ? "pending-approval" : "local", {
      conversation: id,
      outbound: outbound.messages,
      ...(outbound.pending ? { pendingApproval: outbound.pending } : {}),
    });
  }

  /** Emit the opening propose/invoke once the configuration is known. */
  private async continueStart(conversationId: Iri): Promise<{
    messages: OutboundMessage[];
    pending?: { actionDigest: string; intent: ActionIntent };
  }> {
    const plan = this.getDomain(`_start:${conversationId}`) as unknown as StartPlan | undefined;
    const conv = this.mustConversation(conversationId);
    this.carriage = conv.configuration;
    if (!plan) return { messages: [] };
    const handler = this.handlers.get(operationKey(plan.operation));
    if (!handler) throw new Error(`no local handler for ${operationKey(plan.operation)}`);
    const ctx = this.context(conv);
    if (plan.type === "propose" && plan.terms) {
      const intent = handler.intentForProposal?.(ctx, plan.terms);
      if (!intent) throw new Error("handler provides no proposal intent");
      if (this.resuming && this.resumingDigest !== actionDigest(intent))
        throw new MessageReleaseError(
          this.result("rejected", { reason: "approval-mismatch", outbound: [] }),
        );
      const decision = this.authorise(intent, false, plan.evidence);
      if (decision.outcome === "approval-required") {
        return {
          messages: [],
          pending: this.park(conv.id, intent, {
            type: "propose",
            operation: plan.operation,
            terms: plan.terms,
          }),
        };
      }
      if (decision.outcome !== "permit") {
        this.closeLocally(conv, "refused", `own mandate: ${decision.reason}`);
        return { messages: [] };
      }
      const body = {
        operation: plan.operation,
        terms: plan.terms,
        termsDigest: this.registerIdentifier(digestOf(plan.terms)),
        round: 1,
      };
      return {
        messages: [
          await this.emit(conversationId, "propose", body, {
            evidence: [...this.ownEvidence(), ...(plan.evidence ?? [])],
            ...(plan.conditions ? { conditions: plan.conditions } : {}),
            intent,
          }),
        ],
      };
    }
    let intent = handler.intentForInvoke?.(ctx, plan.input ?? {});
    const challenge = conv.phase === "challenged" ? conv.challenge : undefined;
    if (challenge && Date.parse(challenge.expiresAt) <= Date.parse(this.now()))
      throw new RejectError("expired", "challenge expired");
    if (intent && challenge)
      intent = {
        ...intent,
        parameters: {
          ...intent.parameters,
          challenge: { id: challenge.id, nonce: challenge.nonce },
        },
      };
    if (intent) {
      if (this.resuming && this.resumingDigest !== actionDigest(intent))
        throw new MessageReleaseError(
          this.result("rejected", { reason: "approval-mismatch", outbound: [] }),
        );
      const decision = this.authorise(intent, false, plan.evidence);
      if (decision.outcome === "approval-required") {
        return {
          messages: [],
          pending: this.park(
            conv.id,
            intent,
            {
              type: "invoke",
              operation: plan.operation,
              input: plan.input ?? {},
              basis: plan.basis ?? { kind: "public" },
              ...(plan.purpose ? { purpose: plan.purpose } : {}),
            },
            false,
          ),
        };
      }
      if (decision.outcome !== "permit") {
        this.closeLocally(conv, "refused", `own mandate: ${decision.reason}`);
        return { messages: [] };
      }
    }
    const purpose = plan.purpose ?? intent?.purpose;
    const body = {
      operation: plan.operation,
      input: plan.input ?? {},
      ...(challenge ? { challenge: { id: challenge.id, nonce: challenge.nonce } } : {}),
      basis: plan.basis ?? { kind: "public" },
      ...(purpose ? { purpose } : {}),
    };
    const anonymous =
      configurationById(conv.configuration ?? "")?.requesterAuthentication === "not-applicable";
    return {
      messages: [
        await this.emit(conversationId, "invoke", body, {
          evidence: anonymous ? [] : [...this.ownEvidence(), ...(plan.evidence ?? [])],
          ...(plan.content ? { content: plan.content } : {}),
          ...(plan.conditions ? { conditions: plan.conditions } : {}),
          ...(intent ? { intent } : {}),
        }),
      ],
    };
  }

  /** Retry a held invocation in its original conversation, bound to its challenge. */
  retryChallenge(conversation: Iri): Promise<StepResult> {
    return this.exclusive(async () => {
      const conv = this.mustConversation(conversation);
      if (conv.phase !== "challenged" || !conv.challenge)
        return this.result("rejected", { reason: "protocol-violation", outbound: [] });
      if (Date.parse(conv.challenge.expiresAt) <= Date.parse(this.now()))
        return this.result("rejected", { reason: "expired", outbound: [] });
      const result = await this.continueStart(conversation);
      this.persist();
      return this.result(result.pending ? "pending-approval" : "local", {
        conversation,
        outbound: result.messages,
        ...(result.pending ? { pendingApproval: result.pending } : {}),
      });
    });
  }

  /**
   * Continue an existing agreed conversation with an invocation (e.g. a transfer request
   * under an agreement). The intent is authorised before sending.
   */
  async invokeUnderAgreement(input: {
    evidence?: readonly EvidenceItem[];
    conversation: Iri;
    operation: OperationRef;
    input: JsonObject;
    purpose?: Iri;
  }): Promise<StepResult> {
    return this.exclusive(async () => {
      const conv = this.mustConversation(input.conversation);
      if (!conv.agreement) throw new Error("conversation has no agreement");
      const handler = this.handlers.get(operationKey(input.operation));
      const intent = handler?.intentForInvoke?.(this.context(conv), input.input);
      const evidence = [...this.ownEvidence(), ...(input.evidence ?? [])];
      if (intent) {
        const decision = this.authorise(intent, false, evidence);
        if (decision.outcome !== "permit") {
          this.persist();
          return this.result("local", {
            conversation: conv.id,
            reason: decision.outcome,
            detail: decision.reason,
            outbound: [],
          });
        }
      }
      const body = {
        operation: input.operation,
        input: input.input,
        basis: { kind: "agreement", agreement: conv.agreement },
        ...(input.purpose ? { purpose: input.purpose } : {}),
      };
      const out = await this.emit(conv.id, "invoke", body, {
        evidence,
        ...(intent ? { intent } : {}),
      });
      this.persist();
      return this.result("local", { conversation: conv.id, outbound: [out] });
    });
  }

  // ---------------------------------------------------------------- inbound

  /** Process one inbound wire message. Never throws on hostile input. */
  receive(wire: unknown, meta: { binding?: string } = {}): Promise<StepResult> {
    return this.exclusive(() =>
      receiveCarriage(
        wire,
        meta,
        this.inbound,
        this.options.gates?.name ?? ((id) => id ?? "the represented party"),
        (id) => Boolean(this.state.outbox[id]),
        (recovered) => this.receiveGuarded(recovered, meta),
      ),
    );
  }

  private async receiveGuarded(wire: unknown, meta: { binding?: string }): Promise<StepResult> {
    try {
      return await this.receiveInner(wire, meta);
    } catch (error) {
      this.admission = undefined;
      if (error instanceof RejectError) {
        // (set inside receiveInner; widened because TS cannot see that mutation)
        const current = this.current as { id: Iri; kid?: string } | undefined;
        const seen = current ? this.state.seen[current.id] : undefined;
        if (current && seen?.disposition === "processing") {
          // A redelivery of a message rejected mid-dispatch stays rejected (no reprocessing).
          this.state.seen[current.id] = { ...seen, disposition: "rejected" };
        }
        this.persist();
        return this.result("rejected", {
          reason: error.reason,
          detail: error.detail,
          outbound: [],
        });
      }
      throw error;
    } finally {
      this.admission = undefined;
    }
  }

  private reject(reason: ReasonCode, detail: string, extra: JsonObject = {}): never {
    this.admission?.refuse(reason, detail);
    this.record({ type: "rejection", reason, detail, ...extra, at: this.now() });
    throw new RejectError(reason, detail);
  }

  private async receiveInner(wire: unknown, meta: { binding?: string }): Promise<StepResult> {
    const at = this.now();
    try {
      this.carriage = isMessagePacket(wire)
        ? documentConfiguration(wire).configuration
        : peekWire(wire)?.configuration;
    } catch {
      this.carriage = undefined;
    }
    // Verification records do not emit trace events. Admit once, then render the
    // arrival from that very dataset before recording the integrity verdict.
    const checked = await this.inbound.verifyIntegrity(wire, meta, (id) =>
      Boolean(this.state.outbox[id]),
    );
    const inspected = checked.message ?? (await inspectMessagePacket(wire)) ?? peekWire(wire);
    const admission = this.inbound.arrive(wire, meta.binding, inspected);
    this.admission = admission;
    if (!checked.ok) {
      if (checked.message)
        this.current = { id: checked.message.id, ...(checked.kid ? { kid: checked.kid } : {}) };
      admission.failIntegrity(checked.reason, checked.detail);
      this.reject(checked.reason, checked.detail, checked.extra ?? {});
    }
    const msg = checked.message;
    const msgDigest = digestOf(msg);
    const documentConfig = configurationById(msg.configuration);
    const admittedDocumentDigest = isMessagePacket(wire)
      ? await packetDocumentDigest(
          wire,
          documentConfig?.integrity.status === "selected" &&
            documentConfig.integrity.mechanism === "data-integrity"
            ? "data-integrity"
            : "jws",
        )
      : undefined;
    this.current = { id: msg.id, ...(checked.signedBy ? { kid: checked.signedBy.kid } : {}) };

    // Replay / idempotency.
    this.pruneSeen(Date.parse(at));
    const seen = this.state.seen[msg.id];
    if (seen) {
      if (
        seen.digest !== msgDigest ||
        (seen.documentDigest && seen.documentDigest !== admittedDocumentDigest)
      ) {
        admission.failIntegrity("replay-conflict", "message id reused with different content");
        this.reject("replay-conflict", "message id reused with different content");
      }
      const responses = seen.responses
        .map((id) => this.state.outbox[id])
        .filter((e): e is OutboxEntry => Boolean(e))
        .map((e) => this.outboundFromEntry(e));
      // An entry still `processing`/`interrupted` means a crash cut dispatch short after a
      // write-ahead snapshot. The message is NOT re-dispatched (its partial effects are
      // durable); recover() completes the recorded work, and the responses recorded so far
      // are returned here.
      const interrupted = seen.disposition === "processing" || seen.disposition === "interrupted";
      // A redelivery is answered from the record, not admitted again.
      this.admission = undefined;
      this.record({ type: "duplicate", message: msg.id, interrupted, at });
      return this.result("duplicate", {
        messageId: msg.id,
        kind: msg.kind,
        conversation: msg.conversation,
        outbound: responses,
        ...(interrupted
          ? { detail: "earlier processing was interrupted; recover() completes it" }
          : {}),
      });
    }
    if (Object.keys(this.state.seen).length >= this.limits.maxSeenMessages) {
      admission.failIntegrity("capacity", "replay set is full; refusing new input");
      this.reject("capacity", "replay set is full; refusing new input");
    }
    admission.passIntegrity(checked);
    if (this.options.gates?.trust && checked.signedBy) {
      const party = msg.from.onBehalfOf ?? msg.from.actor ?? "";
      const purpose =
        (msg.body as JsonObject).purpose ??
        (msg.kind === "propose" ? msg.body.terms.purpose : undefined) ??
        this.purposeOf(msg.conversation);
      const scoped = this.hasTrustPin(
        party,
        typeof purpose === "string" ? purpose : undefined,
        checked.signedBy.kid,
      );
      if (!scoped) {
        if (this.state.trustRefusals[msgDigest]) {
          this.inbound.verdictEvent(
            "source",
            "fail",
            "The principal declined this unknown sender.",
            { reason: "source-unknown" },
          );
          this.inbound.decisionEvent(
            "refuse",
            "The message remains outside the core.",
            "source-unknown",
          );
          return this.result("rejected", { reason: "source-unknown", outbound: [] });
        }
        const prior = Object.values(this.state.trustHolds).find(
          (hold) => hold.message.id === msg.id,
        );
        if (prior) {
          if (digestOf(prior.message) !== digestOf(msg))
            this.reject("replay-conflict", "held message id reused with different bytes");
          return this.result("pending-approval", { reason: "source-unknown", outbound: [] });
        }
        for (const [id, hold] of Object.entries(this.state.trustHolds))
          if (Date.parse(hold.expiresAt) <= Date.parse(at)) delete this.state.trustHolds[id];
        if (Object.keys(this.state.trustHolds).length >= this.limits.maxOpenConversations)
          this.reject("bounds-exceeded", "too many pending trust decisions");
        const requestId = derivedUrn("trust-request", {
          message: msgDigest,
          kid: checked.signedBy.kid,
        });
        const hold = {
          digest: digestOf({
            requestId,
            message: msgDigest,
            kid: checked.signedBy.kid,
            party,
            purpose,
          }),
          message: copyData(msg!),
          wire: copyData(wire) as WireMessage,
          binding: meta.binding ?? "unknown",
          kid: checked.signedBy.kid,
          party,
          purpose: typeof purpose === "string" ? purpose : "",
          expiresAt: msg.expiresAt,
        };
        this.state.trustHolds[requestId] = hold;
        this.inbound.verdictEvent(
          "source",
          "ask-principal",
          "The sender's key is in no own list accepted for this purpose.",
          { reason: "source-unknown" },
        );
        this.inbound.decisionEvent(
          "ask-principal",
          "The runtime holds the message without showing it to the core.",
          "source-unknown",
        );
        this.options.gates.sink?.emit({
          part: "principal",
          kind: "ask-principal",
          reason: "source-unknown",
          chat: {
            who: "agent",
            text: `Add key fingerprint ${hold.kid} for ${party}, purpose ${hold.purpose}, until ${hold.expiresAt}? Arrived through ${hold.binding}. Sender claims actor ${msg.from.actor ?? "none"}, party ${party}. Request digest ${hold.digest}.`,
          },
          caption:
            "The gate built this trust question. The sender's self-description establishes no role or authority.",
        });
        this.record({
          type: "trust-requested",
          requestId,
          digest: hold.digest,
          kid: hold.kid,
          party,
          purpose: hold.purpose,
          at,
        });
        this.persist();
        return this.result("pending-approval", { reason: "source-unknown", outbound: [] });
      }
    }
    this.gateMemory.rememberIdentifiers(msg.conversation, msg);
    this.state.seen[msg.id] = {
      digest: msgDigest,
      ...(admittedDocumentDigest ? { documentDigest: admittedDocumentDigest } : {}),
      expiresAt: msg.expiresAt,
      disposition: "processing",
      responses: [],
      conversation: msg.conversation,
    };
    this.record({
      type: "message-in",
      id: msg.id,
      kind: msg.kind,
      conversation: msg.conversation,
      digest: msgDigest,
      ...(msg.from.actor ? { from: msg.from.actor } : {}),
      ...(msg.from.onBehalfOf ? { onBehalfOfClaim: msg.from.onBehalfOf } : {}),
      binding: meta.binding ?? "direct",
      at,
    });

    if (
      wire &&
      typeof wire === "object" &&
      ((wire as WireMessage).format === "awp-jws-compact/0.1" || isMessagePacket(wire))
    )
      this.state.recordMessages[msg.id] = {
        direction: "in",
        conversation: msg.conversation,
        digest: msgDigest,
        jws: isMessagePacket(wire) ? encodeMessageProof(wire) : (wire as { jws: string }).jws,
      };
    this.retainedMessageViews.set(msg.id, msg);
    const outbound = await this.dispatch(msg);
    const conv = this.state.conversations[msg.conversation];
    const recorded = this.state.seen[msg.id]?.responses ?? [];
    this.state.seen[msg.id] = {
      digest: msgDigest,
      ...(admittedDocumentDigest ? { documentDigest: admittedDocumentDigest } : {}),
      expiresAt: msg.expiresAt,
      disposition: outbound.disposition,
      responses: [...new Set([...recorded, ...outbound.outbound.map((o) => o.id)])],
      conversation: msg.conversation,
    };
    this.persist();
    return this.result(outbound.disposition, {
      messageId: msg.id,
      kind: msg.kind,
      conversation: msg.conversation,
      ...(conv ? { phase: conv.phase } : {}),
      outbound: outbound.outbound,
      ...(outbound.reason ? { reason: outbound.reason } : {}),
      ...(outbound.detail ? { detail: outbound.detail } : {}),
      ...(outbound.pending ? { pendingApproval: outbound.pending } : {}),
    });
  }

  private async dispatch(msg: AnyMessage): Promise<{
    disposition: Disposition;
    outbound: OutboundMessage[];
    reason?: string;
    detail?: string;
    pending?: { actionDigest: string; intent: ActionIntent };
  }> {
    const opening =
      msg.kind === "describe" ||
      msg.kind === "invoke" ||
      (msg.kind === "propose" && msg.body.round === 1);
    let conv = this.state.conversations[msg.conversation];
    let created = false;

    // Profile and configuration acceptance. One exception: a peer that does not accept our
    // configuration can only answer under one of its own. Such an authenticated notice may
    // close a conversation WE opened (it can only stop us, never cause an action).
    const closingNotice =
      Boolean(conv) &&
      conv?.role === "initiator" &&
      msg.kind === "unsupported" &&
      (msg.body.reason === "unsupported-configuration" ||
        msg.body.reason === "unsupported-profile");
    if (
      !closingNotice &&
      (msg.profile !== PILOT_PROFILE || !this.options.accepted.includes(msg.configuration))
    ) {
      const reason: ReasonCode =
        msg.profile !== PILOT_PROFILE ? "unsupported-profile" : "unsupported-configuration";
      if (!conv && opening && msg.from.actor && this.acceptedAnyway(msg)) {
        this.admission?.refuse(reason, "configuration not accepted");
        const created = this.createResponder(msg);
        const out = await this.emit(
          created.id,
          "unsupported",
          { ref: msg.id, reason, detail: "see implementation description" },
          {
            inReplyTo: msg.id,
            configuration: this.pickReplyConfiguration(msg),
            force: true,
          },
        );
        return { disposition: "accepted", outbound: [out], reason };
      }
      this.reject(reason, `${msg.profile} / ${msg.configuration} not accepted`);
    }

    if (conv) {
      if (conv.peer.actor && msg.from.actor !== conv.peer.actor) {
        this.reject(
          "protocol-violation",
          "message from a different actor than the conversation peer",
        );
      }
      if (!conv.peer.actor && msg.from.actor) {
        this.reject("protocol-violation", "conversation peer is anonymous");
      }
      if (
        !isTerminal(conv.phase) &&
        Date.parse(this.now()) - Date.parse(conv.openedAt) > this.limits.conversationTtlMs
      ) {
        conv = this.apply(conv, { type: "expire", at: this.now() });
      }
    } else {
      if (!opening) this.reject("protocol-violation", `no conversation for ${msg.kind}`);
      conv = this.createResponder(msg);
      created = true;
    }

    const next = transition(
      conv,
      {
        type: "message",
        direction: "in",
        message: copyData(msg!),
        at: this.now(),
        agreementDelivery: conv.operation
          ? this.handlers.get(operationKey(conv.operation))?.agreementDelivery
          : undefined,
      },
      this.limits,
    );
    if (!next.ok) {
      if (created && msg.from.actor) {
        // An authenticated opening message we cannot act on gets one explicit refusal.
        this.admission?.refuse(next.reason, next.detail);
        this.record({
          type: "refusal",
          conversation: conv.id,
          kind: "refuse",
          reason: next.reason,
          detail: next.detail,
          ref: msg.id,
          at: this.now(),
        });
        const out = await this.emit(
          conv.id,
          "refuse",
          { ref: msg.id, reason: next.reason, detail: next.detail },
          { inReplyTo: msg.id, force: true },
        );
        this.closeLocally(this.mustConversation(conv.id), "refused", next.reason);
        return {
          disposition: "accepted" as const,
          outbound: [out],
          reason: next.reason,
          detail: next.detail,
        };
      }
      this.reject(next.reason, next.detail, { conversation: conv.id });
    }
    conv = this.saveConversation(next.state);
    const declaredPurpose =
      msg.kind === "invoke"
        ? msg.body.purpose
        : msg.kind === "propose"
          ? msg.body.terms.purpose
          : undefined;
    if (typeof declaredPurpose === "string")
      this.setDomain(`_purpose:${conv.id}`, declaredPurpose, conv.id);

    switch (msg.kind) {
      case "describe":
        return this.onDescribe(conv, msg);
      case "description":
        return this.onDescription(conv, msg);
      case "propose":
        return this.onPropose(conv, msg);
      case "accept":
        return this.onAccept(conv, msg);
      case "refuse":
      case "challenge":
      case "unsupported":
      case "indeterminate":
        return this.onClosed(conv, msg);
      case "invoke":
        return this.onInvoke(conv, msg);
      case "deliver":
        return this.onDeliver(conv, msg);
      case "receipt":
        return this.onReceipt(conv, msg);
    }
  }

  /** An unsupported opening message from a pinned actor still earns an explicit answer. */
  private acceptedAnyway(msg: AnyMessage): boolean {
    return Boolean(msg.from.actor) && this.options.accepted.length > 0;
  }

  private pickReplyConfiguration(msg: AnyMessage): string {
    const cfg = configurationById(msg.configuration);
    if (cfg && this.options.accepted.includes(msg.configuration)) return msg.configuration;
    const alg = cfg?.integrity.status === "selected" ? cfg.integrity.alg : undefined;
    return (
      this.options.accepted.find((id) => {
        const c = configurationById(id);
        return c?.integrity.status === "selected" && c.integrity.alg === alg;
      }) ??
      this.options.accepted[0] ??
      msg.configuration
    );
  }

  private createResponder(msg: AnyMessage): ConversationState {
    this.guardCapacity();
    const conv = openConversation({
      id: msg.conversation,
      role: "responder",
      peer: {
        ...(msg.from.actor ? { actor: msg.from.actor } : {}),
        ...(msg.from.onBehalfOf ? { party: msg.from.onBehalfOf } : {}),
      },
      ...(this.options.accepted.includes(msg.configuration)
        ? { configuration: msg.configuration }
        : {}),
      at: this.now(),
    });
    this.state.conversations[conv.id] = conv;
    return conv;
  }

  private async onDescribe(conv: ConversationState, msg: Message<"describe">) {
    // Fixed protocol processing is outside the core. Track it if a core hook reads it.
    const refused = await this.admitToCore(
      conv,
      msg,
      [...this.handlers.values()].some((h) => !!h.describeFor),
    );
    if (refused) return refused;
    let extensions: JsonObject | undefined;
    for (const h of this.handlers.values()) {
      const ext = await h.describeFor?.(this.context(conv, msg), msg.evidence ?? []);
      if (ext) extensions = { ...(extensions ?? {}), ...ext };
    }
    const description = this.description(extensions) as unknown as JsonObject;
    const out = await this.emit(conv.id, "description", { description }, { inReplyTo: msg.id });
    return { disposition: "accepted" as const, outbound: [out] };
  }

  private async onDescription(conv: ConversationState, msg: Message<"description">) {
    const startPlan = this.getDomain(`_start:${conv.id}`) as unknown as StartPlan | undefined;
    const readsDescription =
      startPlan && !!this.handlers.get(operationKey(startPlan.operation))?.vetDescription;
    const refused = await this.admitToCore(conv, msg, !!readsDescription);
    if (refused) return refused;
    const peer = readPeerDescription(msg.body.description);
    const plan = this.getDomain(`_start:${conv.id}`) as unknown as StartPlan | undefined;
    if (!peer || !plan) {
      this.record({ type: "description-unusable", conversation: conv.id, at: this.now() });
      return { disposition: "accepted" as const, outbound: [] };
    }
    this.setDomain(`_peerDescription:${conv.id}`, msg.body.description, conv.id);
    const selection = selectConfiguration({
      localAccepted: this.options.accepted,
      peer,
      operation: plan.operation,
      acceptedModels: plan.models,
    });
    this.record({
      type: "configuration-selection",
      conversation: conv.id,
      ...(selection as unknown as JsonObject),
      at: this.now(),
    });
    const anonymous =
      configurationById(conv.configuration ?? "")?.requesterAuthentication === "not-applicable";
    if (!selection.ok && anonymous) {
      // An anonymous requester never signs; it simply stops.
      this.closeLocally(this.mustConversation(conv.id), "unsupported", selection.reason);
      return {
        disposition: "accepted" as const,
        outbound: [],
        reason: selection.reason,
        detail: selection.detail,
      };
    }
    if (!selection.ok) {
      const out = await this.emit(
        conv.id,
        "unsupported",
        { ref: msg.id, reason: selection.reason },
        { inReplyTo: msg.id },
      );
      return {
        disposition: "accepted" as const,
        outbound: [out],
        reason: selection.reason,
        detail: selection.detail,
      };
    }
    const vet = this.handlers
      .get(operationKey(plan.operation))
      ?.vetDescription?.(this.context(conv, msg), msg.body.description);
    if (vet) {
      this.record({
        type: "description-vetting",
        conversation: conv.id,
        reason: vet.reason,
        detail: vet.detail,
        at: this.now(),
      });
      if (anonymous) {
        this.closeLocally(this.mustConversation(conv.id), "unsupported", vet.reason);
        return {
          disposition: "accepted" as const,
          outbound: [],
          reason: vet.reason,
          detail: vet.detail,
        };
      }
      const out = await this.emit(
        conv.id,
        "unsupported",
        { ref: msg.id, reason: vet.reason },
        { inReplyTo: msg.id },
      );
      return {
        disposition: "accepted" as const,
        outbound: [out],
        reason: vet.reason,
        detail: vet.detail,
      };
    }
    if (selection.configuration !== this.mustConversation(conv.id).configuration) {
      const out = await this.emit(
        conv.id,
        "unsupported",
        {
          ref: msg.id,
          reason: "unsupported-configuration",
          detail: "selected configuration differs from the discovery configuration",
        },
        { inReplyTo: msg.id },
      );
      return {
        disposition: "accepted" as const,
        outbound: [out],
        reason: "unsupported-configuration",
      };
    }
    const cont = await this.continueStart(conv.id);
    return {
      disposition: cont.pending ? ("pending-approval" as const) : ("accepted" as const),
      outbound: cont.messages,
      ...(cont.pending ? { pending: cont.pending } : {}),
    };
  }

  private async onPropose(conv: ConversationState, msg: Message<"propose">) {
    const handler = this.handlers.get(operationKey(msg.body.operation));
    if (!handler?.onProposal || handler.description.pattern !== "negotiate") {
      return this.replyClose(
        conv,
        msg,
        "unsupported",
        "unsupported-operation",
        `${operationKey(msg.body.operation)} not offered`,
      );
    }
    if (digestOf(msg.body.terms) !== msg.body.termsDigest) {
      return this.replyClose(
        conv,
        msg,
        "refuse",
        "terms-digest-mismatch",
        "termsDigest does not match terms",
      );
    }
    if (msg.body.terms.compensation) {
      try {
        this.paymentOffers.set(msg.body.termsDigest, await readPaymentOffer(msg.body.terms));
      } catch {
        return this.replyClose(
          conv,
          msg,
          "refuse",
          "protocol-violation",
          "The RDF offer does not match its stated service terms.",
        );
      }
    }
    this.setDomain(`_offer:${msg.id}`, msg.body.terms as Json, conv.id);
    if (handler.termsSchema) {
      const parsed = handler.termsSchema.safeParse(msg.body.terms);
      if (!parsed.success) {
        const unknown = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
        return this.replyClose(
          conv,
          msg,
          unknown ? "unsupported" : "refuse",
          unknown ? "unsupported-term" : "invalid-terms",
          parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
    }
    const rep = await this.checkRepresentation(conv, msg, handler);
    if (rep && rep.outcome !== "accepted") {
      return this.replyClose(
        conv,
        msg,
        "refuse",
        rep.reason ?? "representation-invalid",
        "representation not accepted",
      );
    }
    const credentialFailure = await this.inbound.checkAgreementCredential(
      agreementMessageNode(msg)!,
    );
    if (credentialFailure) {
      this.admission?.refuse(credentialFailure, "The offered agreement credential is invalid.");
      return this.replyClose(conv, msg, "refuse", credentialFailure as ReasonCode);
    }
    const refused = await this.admitToCore(conv, msg);
    if (refused) return refused;
    const reply = await handler.onProposal(this.context(conv, msg, rep), msg.body);
    return this.applyReply(conv, msg, reply, handler);
  }

  private async onAccept(conv: ConversationState, msg: Message<"accept">) {
    const offer = conv.history.find((h) => h.id === msg.body.proposal);
    const offerMsg = offer ? this.state.outbox[offer.id]?.wire : undefined;
    const operation = conv.operation;
    if (!operation || !offerMsg) {
      this.reject("protocol-violation", "accepted proposal is not ours");
    }
    const terms = this.getDomain(`_offer:${msg.body.proposal}`) as JsonObject | undefined;
    const agreementId = this.agreementId(
      msg.body.proposal,
      msg.body.termsDigest,
      msg.body.selection,
    );
    if (agreementId !== msg.body.agreement || !terms) {
      this.reject("protocol-violation", "agreement id does not match offer + acceptance");
    }
    const handler = this.handlers.get(operationKey(operation));
    const selectionProblem = handler?.validateSelection?.(terms, msg.body.selection);
    if (selectionProblem) {
      return this.replyClose(conv, msg, "refuse", "invalid-terms", selectionProblem);
    }
    const rep = handler ? await this.checkRepresentation(conv, msg, handler) : undefined;
    if (rep && rep.outcome !== "accepted") {
      // The agreement is not recognised; report instead of performing.
      this.admission?.refuse(rep.reason ?? "representation-invalid", "acceptor representation");
      const out = await this.emit(
        conv.id,
        "indeterminate",
        {
          ref: msg.id,
          reason: rep.reason ?? "representation-invalid",
          detail: "acceptor representation not accepted",
        },
        { inReplyTo: msg.id, force: true },
      );
      return { disposition: "accepted" as const, outbound: [out], reason: rep.reason };
    }
    const credentialFailure = await this.inbound.checkAgreementCredential(
      agreementMessageNode(msg)!,
      agreementMessageNode(this.retainedMessageViews.get(msg.body.proposal)),
    );
    if (credentialFailure) {
      this.admission?.refuse(credentialFailure, "No two-proof agreement has been established.");
      return this.replyClose(conv, msg, "refuse", credentialFailure as ReasonCode);
    }
    const refused = await this.admitToCore(conv, msg);
    if (refused) return refused;
    const agreement: Agreement = {
      type: "agreement",
      id: agreementId,
      conversation: conv.id,
      operation,
      offer: msg.body.proposal,
      acceptance: msg.id,
      termsDigest: msg.body.termsDigest,
      terms,
      ...(msg.body.selection ? { selection: msg.body.selection } : {}),
      offeror: this.selfRef(),
      acceptor: msg.from,
      formedAt: this.now(),
    };
    this.state.agreements[agreement.id] = agreement;
    this.record(agreement);
    this.installAgreementDuties(agreement);
    if (!handler?.onAgreement) return { disposition: "accepted" as const, outbound: [] };
    const plan = await handler.onAgreement(
      this.context(this.mustConversation(conv.id), msg, rep),
      agreement,
      "offeror",
    );
    return this.executeAgreementPlan(conv.id, plan, agreement);
  }

  private async onClosed(
    conv: ConversationState,
    msg: Extract<AnyMessage, { kind: "refuse" | "challenge" | "unsupported" | "indeterminate" }>,
  ) {
    await this.admission?.complete(conv, msg);
    if (msg.kind === "challenge") {
      this.setDomain(`_challenge:${conv.id}`, msg.body.needs as unknown as Json, conv.id);
      this.record({
        type: "challenged-by-peer",
        conversation: conv.id,
        challenge: msg.body.needs,
        at: this.now(),
      });
      return { disposition: "accepted" as const, outbound: [] };
    }
    this.record({
      type: "closed-by-peer",
      conversation: conv.id,
      kind: msg.kind,
      reason: msg.body.reason,
      at: this.now(),
    });
    const handler = conv.operation ? this.handlers.get(operationKey(conv.operation)) : undefined;
    handler?.onClosed?.(this.context(conv, msg), msg.kind, msg.body.reason);
    for (const [digest, p] of Object.entries(this.state.pending)) {
      if (p.conversation === conv.id) delete this.state.pending[digest];
    }
    return { disposition: "accepted" as const, outbound: [] };
  }

  private async onInvoke(conv: ConversationState, msg: Message<"invoke">) {
    const handler = this.handlers.get(operationKey(msg.body.operation));
    if (!handler?.onInvoke) {
      return this.replyClose(
        conv,
        msg,
        "unsupported",
        "unsupported-operation",
        `${operationKey(msg.body.operation)} not offered`,
      );
    }
    const publicAccess = msg.body.basis.kind === "public";
    // Brief 31 §2.2: the gate records the refusal as its authority check; the wire reason
    // stays credentials-required, which tells the asker what it lacks.
    if (!msg.from.actor && (handler.description.access !== "public" || !publicAccess))
      this.admission?.failAuthority(
        "An unnamed requester may ask only for public operations; this one is restricted to named parties.",
      );
    if (publicAccess && handler.description.access !== "public") {
      return this.replyClose(
        conv,
        msg,
        "refuse",
        "credentials-required",
        "operation is not public",
      );
    }
    if (!msg.from.actor && !publicAccess) {
      return this.replyClose(
        conv,
        msg,
        "refuse",
        "credentials-required",
        "anonymous requests only for public operations",
      );
    }
    if (handler.inputSchema) {
      const parsed = handler.inputSchema.safeParse(msg.body.input);
      if (!parsed.success) {
        const unknown = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
        return this.replyClose(
          conv,
          msg,
          unknown ? "unsupported" : "refuse",
          unknown ? "unsupported-term" : "invalid-terms",
          parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
    }
    let rep: RepresentationAssessment | undefined;
    if (!publicAccess) {
      rep = await this.checkRepresentation(conv, msg, handler);
      const askMore = this.admission?.askedFor;
      if (askMore) return this.replyChallenge(conv, msg, askMore);
      if (rep && rep.outcome !== "accepted") {
        if (rep.reason === "approval-required" && rep.deciderRole) {
          const detail = `The authority register records another holder's objection. Decision required from role ${rep.deciderRole} for ${handler.description.id}; message digest ${digestOf(msg)}.`;
          this.inbound.verdictEvent("authority", "ask-principal", detail, {
            reason: "approval-required",
          });
          this.inbound.decisionEvent("ask-principal", detail, "approval-required");
          return {
            disposition: "pending-approval" as const,
            outbound: [],
            reason: "approval-required",
          };
        }
        if (rep.reason === "representation-out-of-scope" && !this.options.gates?.authorityChains) {
          const detail = `A current mandate credential must cover ${handler.description.id}; accepted roles: ${this.options.gates?.organizations?.policy.requiredRoles[handler.description.id]?.join(", ") ?? "a representative authorized for this operation"}.`;
          this.inbound.decisionEvent("ask-more", detail, rep.reason);
          return this.replyClaimChallenge(conv, msg, rep.reason, detail);
        }
        return this.replyClose(
          conv,
          msg,
          "refuse",
          rep.reason ?? "representation-invalid",
          "representation not accepted",
        );
      }
    }
    if (handler.description.id === "urn:op:erasure-request" && !this.erasureAuthorised(msg)) {
      this.inbound.verdictEvent(
        "authority",
        "fail",
        "The requester is neither the subject nor an agreed onward sender.",
        { reason: "representation-out-of-scope" },
      );
      return this.replyClose(
        conv,
        msg,
        "refuse",
        "representation-out-of-scope",
        "erasure subject mismatch",
      );
    }
    const refused = await this.admitToCore(conv, msg);
    if (refused) return refused;
    if (handler.description.id === "urn:op:erasure-request") {
      const output = this.eraseRequested(msg);
      const result = await this.applyReply(conv, msg, { type: "deliver", output }, handler);
      if ((output.parts as JsonObject[]).some((p) => p.outcome === "stop"))
        for (const v of this.outbound.rejectEffect(
          {
            action: "use",
            operation: handler.description.id,
            conversation: conv.id,
            target: handler.description.id,
            parameters: {},
          },
          "no-agreement",
        ))
          this.record(v);
      return result;
    }
    if (handler.description.id === "urn:op:general-notice")
      return this.applyReply(
        conv,
        msg,
        { type: "deliver", output: { acknowledgement: msg.body.input.duty ?? msg.id } },
        handler,
      );
    const reply = await handler.onInvoke(
      this.context(conv, msg, rep),
      msg.body,
      this.coreEvidence(msg.evidence ?? []),
    );
    return this.applyReply(conv, msg, reply, handler);
  }

  private async onDeliver(conv: ConversationState, msg: Message<"deliver">) {
    const request = conv.requests?.[msg.body.ref];
    if (!request) this.reject("protocol-violation", "delivery request is not recorded");
    const handler = this.handlers.get(operationKey(request.operation));
    const refused = await this.admitToCore(conv, msg);
    if (refused) return refused;
    if (!handler?.onDeliver) return { disposition: "accepted" as const, outbound: [] };
    const duty = Object.values(this.state.duties.work).find(
      (d) => d.conversation === conv.id && d.recipient?.party === msg.from.onBehalfOf,
    );
    if (duty?.kind === "notify" && msg.body.output.acknowledgement === duty.id)
      this.dutyExecutor().acknowledge(conv.id, msg.from.onBehalfOf ?? "");
    if (duty?.kind === "inform-onward" && msg.body.output.subject === duty.subject) {
      const parts = msg.body.output.parts;
      if (
        Array.isArray(parts) &&
        parts.some((p) => !!p && typeof p === "object" && !Array.isArray(p) && p.outcome === "stop")
      ) {
        duty.status = "blocked";
        duty.reason = "no-agreement";
        this.record({ type: "duty-undischargeable", ...duty });
      } else this.dutyExecutor().acknowledge(conv.id, msg.from.onBehalfOf ?? "");
    }
    const reply = await handler.onDeliver(
      this.context(conv, msg),
      msg.body,
      this.coreEvidence(msg.evidence ?? []),
    );
    return this.applyReply(this.mustConversation(conv.id), msg, reply, handler);
  }

  private async onReceipt(conv: ConversationState, msg: Message<"receipt">) {
    const refused = await this.admitToCore(conv, msg);
    if (refused) return refused;
    this.record({
      type: "peer-outcome-report",
      conversation: conv.id,
      activity: msg.body.activity,
      conclusion: msg.body.outcome,
      final: msg.body.final ?? false,
      reporter: msg.from.actor ?? "anonymous",
      note: "the peer's conclusion about its own activity; not independently observed",
      at: this.now(),
    });
    const handler = conv.operation ? this.handlers.get(operationKey(conv.operation)) : undefined;
    if (!handler?.onReceipt) return { disposition: "accepted" as const, outbound: [] };
    const reply = await handler.onReceipt(this.context(conv, msg), msg.body);
    return this.applyReply(this.mustConversation(conv.id), msg, reply, handler);
  }

  /** The inbound gate's remaining checks and decision, right before the core sees `msg`. */
  private async admitToCore(conv: ConversationState, msg: AnyMessage, entersCore = true) {
    const r = await this.admission?.complete(conv, msg);
    if (r && !r.ok) {
      if (r.askMore) return this.replyClaimChallenge(conv, msg, r.reason, r.detail);
      return this.replyClose(conv, msg, "refuse", r.reason, r.detail);
    }
    if (!entersCore) return undefined;
    for (const pointer of this.admission?.admittedPointers ?? []) {
      this.setDomain(
        `_reference:${pointer.item.id}`,
        {
          pointer,
          conversation: conv.id,
          delivery: msg.id,
        } as unknown as JsonObject,
        conv.id,
      );
    }
    this.recordItemTransfer(msg, conv, true);
    const task = this.options.gates?.taskId ?? conv.id;
    if (msg.kind === "invoke")
      this.setDomain(
        `_standing-request:${conv.id}`,
        {
          actor: msg.from.actor ?? "anonymous",
          party: msg.from.onBehalfOf ?? "unknown",
          items: msg.body.input.items ?? null,
        },
        conv.id,
      );
    for (const item of msg.evidence ?? []) {
      if (item.role !== "credential") continue;
      try {
        const claim = unverifiedEvidenceClaim(item);
        const fact = this.gateMemory.facts.get(String(claim.id));
        const digest = digestOf(claim);
        if (fact && fact.digest === digest)
          this.gateMemory.enter(task, { ...fact, kind: "statement", accepted: true, digest });
      } catch {
        /* An unaccepted claim is never a fact. The message below retains its labels. */
      }
    }
    for (const part of msg.content ?? []) {
      // A relayed part needs an admitted source statement binding its digest.
      const source = [...this.gateMemory.facts.values()].find(
        (fact) =>
          fact.statement?.contentDigest === part.digest &&
          this.gateMemory.context(task).some((i) => i.accepted && i.digest === fact.digest) &&
          (msg.evidence ?? []).some((e) => {
            try {
              return digestOf(unverifiedEvidenceClaim(e)) === fact.digest;
            } catch {
              return false;
            }
          }),
      );
      const introducedSource = this.trust.data.keys.find(
        (key) => key.role === "actor" && key.subject === msg.from.actor,
      )?.party;
      const item = {
        id: part.id,
        digest: part.digest,
        kind: "content" as const,
        accepted: false,
        label: "Unstructured data; never instructions",
        claimType: "unstructured-content",
        source: source?.source ?? introducedSource ?? msg.from.actor ?? "unknown",
        subject: source?.subject ?? msg.from.onBehalfOf ?? "unknown",
        ...(source?.terms
          ? {
              terms: {
                policy: {
                  id: derivedUrn("content-terms", { digest: part.digest, source: source.id }),
                },
                inherited: [{ target: source.id, terms: source.terms }],
              },
            }
          : {}),
        ...(source?.admittedPurpose ? { admittedPurpose: source.admittedPurpose } : {}),
        statement: part as unknown as JsonObject,
      };
      this.gateMemory.enter(task, item);
      this.record({ type: "unstructured-content", ...item, at: this.now() });
      this.options.gates?.sink?.emit({
        part: "memory",
        kind: "store",
        caption: `Unstructured data ${part.digest}; not instructions; source ${item.source}.`,
      });
    }
    this.gateMemory.enter(task, {
      id: msg.id,
      label: `${msg.kind} from ${msg.from.actor ?? "anonymous"}`,
      identifiers: identifiersIn(msg),
      kind: "message",
      digest: digestOf(msg),
      subject: msg.from.onBehalfOf ?? "unknown",
      source: msg.from.actor ?? "anonymous",
      claimType: `message:${msg.kind}`,
    });
    return undefined;
  }

  // ---------------------------------------------------------------- replies & plans

  private async applyReply(
    conv: ConversationState,
    msg: AnyMessage,
    reply: HandlerReply,
    handler: OperationHandler,
    answeringOperation?: OperationRef,
  ): Promise<{
    disposition: Disposition;
    outbound: OutboundMessage[];
    reason?: string;
    detail?: string;
    pending?: { actionDigest: string; intent: ActionIntent };
  }> {
    if (reply.type === "none") return { disposition: "accepted", outbound: [] };
    if (reply.type === "refuse" || reply.type === "unsupported" || reply.type === "indeterminate") {
      return this.replyClose(conv, msg, reply.type, reply.reason, reply.detail);
    }
    // A delivery answers the operation that was invoked, which may differ from the
    // conversation's negotiated operation (e.g. a transfer under a data-offer agreement).
    const operation =
      answeringOperation ?? (msg.kind === "invoke" ? msg.body.operation : undefined);
    const intent = "intent" in reply ? reply.intent : undefined;
    if (intent) {
      const decision = this.authorise(
        intent,
        false,
        "evidence" in reply ? reply.evidence : undefined,
      );
      if (decision.outcome === "approval-required") {
        const pending = this.park(
          conv.id,
          intent,
          { type: "reply", inReplyTo: msg.id, reply, ...(operation ? { operation } : {}) },
          true,
        );
        return { disposition: "pending-approval", outbound: [], pending };
      }
      if (decision.outcome === "indeterminate") {
        return this.replyClose(
          conv,
          msg,
          "indeterminate",
          "indeterminate-policy",
          "own mandate could not decide",
        );
      }
      if (decision.outcome === "deny") {
        if (this.options.gates?.accessPod && intent.parameters.access !== undefined) {
          this.closeLocally(conv, "refused", decision.reason);
          return { disposition: "rejected", reason: decision.reason, outbound: [] };
        }
        return this.replyClose(
          conv,
          msg,
          "refuse",
          "not-authorised",
          "not authorised by the represented party's mandate",
        );
      }
    }
    return {
      disposition: "accepted",
      outbound: await this.performReply(conv.id, msg.id, reply, handler, operation, intent),
    };
  }

  private async performReply(
    conversationId: Iri,
    inReplyTo: Iri,
    reply: HandlerReply,
    handler: OperationHandler,
    answeringOperation?: OperationRef,
    /** The intent authorised for this reply (carried to the outbox for transmission). */
    intent?: ActionIntent,
  ): Promise<OutboundMessage[]> {
    const conv = this.mustConversation(conversationId);
    const authorised = intent ? { intent } : {};
    switch (reply.type) {
      case "accept": {
        const open = conv.openProposal;
        if (!open) throw new Error("no open proposal to accept");
        const agreementId = this.agreementId(open.id, open.termsDigest, reply.selection);
        const body = {
          proposal: open.id,
          termsDigest: open.termsDigest,
          ...(reply.selection ? { selection: reply.selection } : {}),
          agreement: agreementId,
        };
        const terms = this.getDomain(`_offer:${open.id}`) as JsonObject;
        const credentialProtocol = this.options.gates?.agreementCredential;
        const credentialOffer = agreementMessageNode(this.retainedMessageViews.get(open.id));
        const credentialKey = this.keysByAlg.get("EdDSA");
        const nativeAcceptance =
          credentialProtocol && credentialOffer && credentialKey
            ? await credentialProtocol
                .accept(credentialOffer, credentialKey, this.trust, this.now())
                .catch((error) => {
                  const reason =
                    error instanceof AgreementCredentialError ? error.reason : "evidence-invalid";
                  this.outbound.stopAgreementCredential(open.id, reason);
                  throw new MessageReleaseError(this.result("rejected", { reason, outbound: [] }));
                })
            : undefined;
        const acceptanceApproval = intent ? this.state.approvals[actionDigest(intent)] : undefined;
        const paymentEvidence: EvidenceItem[] =
          terms.compensation && this.options.mandateJws && intent
            ? [
                { role: "authorisation", format: "jws-compact", value: this.options.mandateJws },
                {
                  role: "authorisation",
                  format: "awp-action-intent/0.1",
                  value: canonicalJson(intent),
                },
                ...(acceptanceApproval
                  ? [
                      {
                        role: "approval" as const,
                        format: "jws-compact",
                        value: acceptanceApproval.jws,
                      },
                    ]
                  : []),
              ]
            : [];
        const out = await this.emit(conv.id, "accept", body, {
          inReplyTo,
          evidence: [
            ...this.ownEvidence(),
            ...paymentEvidence,
            ...(nativeAcceptance ? [nativeAcceptance.evidence] : []),
            ...(reply.evidence ?? []),
          ],
          ...authorised,
        });
        if (nativeAcceptance && !nativeAcceptance.complete) return [out];
        const agreement: Agreement = {
          type: "agreement",
          id: agreementId,
          conversation: conv.id,
          operation: conv.operation as OperationRef,
          offer: open.id,
          acceptance: out.id,
          termsDigest: open.termsDigest,
          terms,
          ...(reply.selection ? { selection: reply.selection } : {}),
          offeror: {
            ...(conv.peer.actor ? { actor: conv.peer.actor } : {}),
            ...(conv.peer.party ? { onBehalfOf: conv.peer.party } : {}),
          },
          acceptor: this.selfRef(),
          formedAt: this.now(),
        };
        this.state.agreements[agreement.id] = agreement;
        this.record(agreement);
        this.installAgreementDuties(agreement);
        const rest = handler.onAgreement
          ? await this.executeAgreementPlan(
              conv.id,
              await handler.onAgreement(
                this.context(this.mustConversation(conv.id)),
                agreement,
                "acceptor",
              ),
              agreement,
            )
          : { outbound: [] };
        return [out, ...rest.outbound];
      }
      case "counter": {
        const open = conv.openProposal;
        if (!open) throw new Error("no open proposal to counter");
        const body = {
          operation: conv.operation as OperationRef,
          terms: reply.terms,
          termsDigest: this.registerIdentifier(digestOf(reply.terms)),
          round: open.round + 1,
          counters: open.id,
        };
        return [
          await this.emit(conv.id, "propose", body, {
            inReplyTo,
            evidence: this.ownEvidence(),
            ...authorised,
          }),
        ];
      }
      case "deliver": {
        const basis = conv.agreement
          ? { kind: "agreement", agreement: conv.agreement }
          : { kind: "invocation", invocation: inReplyTo };
        const body = {
          ref: inReplyTo,
          basis,
          operation: answeringOperation ?? (conv.operation as OperationRef),
          output: reply.output,
        };
        return [
          await this.emit(conv.id, "deliver", body, {
            inReplyTo,
            evidence: reply.evidence ?? [],
            ...authorised,
            ...(reply.conditions && reply.conditions.length > 0
              ? { conditions: reply.conditions }
              : {}),
          }),
        ];
      }
      case "receipt":
        return [await this.replyReceipt(conv, inReplyTo, reply)];
      default:
        return [];
    }
  }

  private replyReceipt(
    conv: ConversationState,
    inReplyTo: Iri,
    reply: Omit<import("../core/types.js").ReceiptBody, "ref">,
    id?: Iri,
  ): Promise<OutboundMessage> {
    return this.emit(
      conv.id,
      "receipt",
      {
        ref: conv.agreement ?? inReplyTo,
        activity: reply.activity,
        outcome: reply.outcome,
        ...(reply.observed ? { observed: reply.observed } : {}),
        final: reply.final,
      },
      { inReplyTo, ...(id ? { id } : {}) },
    );
  }

  private async executeAgreementPlan(
    conversationId: Iri,
    plan: AgreementPlan,
    agreement: Agreement,
  ) {
    this.apply(this.mustConversation(conversationId), {
      type: "agreement-requirements",
      requiredOutcomes: plan.requiredOutcomes,
      at: this.now(),
    });
    // Record every effect as `planned` before anything runs, so the first write-ahead
    // snapshot already contains the whole plan: recover() can finish it after a crash.
    for (const e of plan.effects ?? []) this.planEffect(conversationId, e, agreement.id);
    const outbound: OutboundMessage[] = [];
    for (const [index, message] of (plan.messages ?? []).entries()) {
      try {
        outbound.push(...(await this.performPlanMessage(conversationId, message)));
      } catch (error) {
        if (error instanceof MessageReleaseError && error.result.pendingApproval) {
          const pending = this.state.pending[error.result.pendingApproval.actionDigest];
          const continuation = pending?.continuation as unknown as Continuation | undefined;
          if (pending && continuation?.type === "release-message")
            this.state.pending[pending.actionDigest] = {
              ...pending,
              continuation: copyData({
                ...continuation,
                after: {
                  agreement,
                  plan: { ...plan, messages: (plan.messages ?? []).slice(index + 1) },
                },
              }) as unknown as Json,
            };
        }
        throw error;
      }
    }
    for (const e of plan.effects ?? []) {
      outbound.push(...(await this.runEffect(conversationId, e, agreement.id)));
    }
    return { disposition: "accepted" as const, outbound };
  }

  /** A scripted or model core can propose a follow-up only through this executor. */
  sendMessage(conversation: Iri, plan: OutboundPlan): Promise<StepResult> {
    return this.exclusive(async () => {
      const outbound = await this.performPlanMessage(conversation, plan);
      this.persist();
      const pending = Object.values(this.state.pending).find(
        (p) => p.conversation === conversation,
      );
      return this.result(pending ? "pending-approval" : "local", {
        conversation,
        outbound,
        ...(pending
          ? { pendingApproval: { actionDigest: pending.actionDigest, intent: pending.intent } }
          : {}),
      });
    });
  }

  private async performPlanMessage(
    conversationId: Iri,
    m: OutboundPlan,
  ): Promise<OutboundMessage[]> {
    if (m.intent) {
      const decision = this.authorise(m.intent, false, m.evidence);
      if (decision.outcome === "approval-required") {
        this.park(conversationId, m.intent, { type: "message", plan: m });
        return [];
      }
      if (decision.outcome !== "permit") {
        this.record({
          type: "plan-message-blocked",
          conversation: conversationId,
          kind: m.kind,
          reason: decision.reason,
          at: this.now(),
        });
        return [];
      }
    }
    return [
      await this.emit(conversationId, m.kind, m.body as never, {
        evidence: m.evidence ?? [],
        ...(m.intent ? { intent: m.intent } : {}),
      }),
    ];
  }

  // ---------------------------------------------------------------- executor

  /**
   * The outbound gate's release around the pilot's mandate decision. `quiet` re-authorises
   * at transmission or reconciliation without showing a new release.
   */
  private authorise(
    intent: ActionIntent,
    quiet = false,
    evidence: readonly EvidenceItem[] = [],
    withdrawal?: { grant: PodGrant; reason: "principal" | "expiry" },
  ): AuthorisationDecision {
    // Invalid core proposals retain the existing fail-closed scope checks.
    if (intent.target && intent.conversation) intent = ActionIntentNode.toNode(intent).live;
    const at = this.now();
    const approvals = new Map<string, { id: Iri; decision: "approve" | "deny" }>();
    for (const [digest, a] of Object.entries(this.state.approvals)) {
      if (Date.parse(a.validUntil) > Date.parse(at) && (quiet || !this.state.usedApprovals[a.id]))
        approvals.set(digest, { id: a.id, decision: a.decision });
    }
    let decision: AuthorisationDecision =
      withdrawal?.reason === "expiry"
        ? {
            type: "authorisation-decision",
            at,
            action: intent,
            actionDigest: actionDigest(intent),
            decider: this.identity.actor,
            policy: {
              id: withdrawal.grant.pointer.id,
              digest: digestOf(withdrawal.grant),
              evaluator: "grant-withdrawal",
            },
            outcome: "permit",
            basis: "autonomous",
            reason: "grant-expired",
          }
        : this.mandateDecision(intent, at, approvals);
    if (!withdrawal && (intent.operation === WITHDRAW_ACCESS || intent.target === WITHDRAW_ACCESS))
      decision = { ...decision, outcome: "deny", reason: "not-authorised" };
    let effective = decision;
    if (!quiet && !this.resuming) this.outbound.propose(intent, this.proposalOrigin);
    this.reauthorising = quiet;
    try {
      effective = this.outbound.release(intent, decision, [
        ...evidence,
        ...(this.options.gates?.supplementaryEvidence ?? []),
      ]).decision;
    } finally {
      this.reauthorising = false;
    }
    this.record({
      ...effective,
      originalDigests: this.gateMemory
        .context(this.options.gates?.taskId ?? intent.conversation)
        .filter((i) => i.kind === "reading")
        .map((i) => i.statement?.originalDigest)
        .filter((d) => typeof d === "string"),
    });
    this.decisions.push(effective);
    return effective;
  }

  /**
   * The mandate part of `authorise`: the owner mandate evaluated at `at`, then the standing
   * rules. Brief 32: the record audit re-evaluates recorded releases with the same method.
   */
  private mandateDecision(
    intent: ActionIntent,
    at: string,
    approvals: ReadonlyMap<string, { id: Iri; decision: "approve" | "deny" }>,
  ): AuthorisationDecision {
    const revoked = this.mandate ? this.isRevoked(this.mandate) : false;
    let decision = evaluateIntent({
      loaded: this.mandate,
      withdrawn: revoked,
      loadFailure: this.mandateFailure,
      intent,
      decider: this.identity.actor,
      at,
      approvals,
      ...(this.options.policyEngine ? { engine: this.options.policyEngine } : {}),
    });
    const standing = !revoked ? this.standingAccess(intent) : undefined;
    if (
      standing &&
      this.mandate &&
      Date.parse(this.mandate.mandate.validFrom) <= Date.parse(at) &&
      Date.parse(this.mandate.mandate.validUntil) > Date.parse(at) &&
      !this.mandate.mandate.autonomous.prohibitions?.some(
        (r) => r.action === intent.action && (!r.target || r.target === intent.target),
      )
    ) {
      decision = {
        ...decision,
        outcome: standing.ok ? "permit" : "deny",
        reason: standing.ok ? "within-mandate" : standing.reason,
        ...(standing.ok ? { basis: "autonomous", matchedRule: standing.rule.id } : {}),
      };
    }
    return decision;
  }

  private standingAccess(
    intent: ActionIntent,
  ):
    | { ok: true; rule: import("../mechanisms/mandate.js").StandingRule }
    | { ok: false; reason: string }
    | undefined {
    const mandate = this.mandate?.mandate;
    const rules = mandate?.standing?.filter((r) => r.allows.action === intent.action) ?? [];
    if (!rules.length) return undefined;
    const peer = this.state.conversations[intent.conversation]?.peer;
    if (!peer?.actor || !peer.party || intent.recipient !== peer.party)
      return { ok: false, reason: "not-authorised" };
    const task = this.options.gates?.taskId ?? intent.conversation;
    const facts = [...this.gateMemory.facts.values()].filter((f) =>
      this.gateMemory.context(task).some((i) => i.accepted && i.digest === f.digest),
    );
    const current = (f: import("../gates/common.js").AdmittedFact) =>
      !!f.statement &&
      fitnessOf(
        StatementQualityNode.from({
          ...f.statement,
          method: f.method ?? f.statement.method,
        } as unknown as import("../gates/quality.js").QualityClaim),
        this.options.gates?.reliance,
        this.now(),
      ).verdict === "pass" &&
      (!f.statement.validFrom ||
        Date.parse(String(f.statement.validFrom)) <= Date.parse(this.now())) &&
      evaluateItemTerms(f.terms, {
        agent: this.identity.actor,
        action: "use",
        target: f.id,
        purpose: intent.purpose,
        at: this.now(),
      }).verdict === "pass";
    const declaration = facts.find(
      (f) =>
        f.claimType === "emergency.declaration" &&
        f.source === peer.party &&
        f.subject === peer.party &&
        f.statement?.declared === "emergency" &&
        current(f),
    );
    if (!declaration) return undefined; // ordinary mandate applies without the signed declaration
    const key = this.trust.data.keys.find((k) => k.role === "actor" && k.subject === peer.actor);
    for (const rule of rules) {
      const role = facts.find(
        (f) =>
          f.claimType === "organization.role" &&
          f.subject === peer.party &&
          f.statement?.role === rule.when.requesterRole &&
          f.statement?.subjectKey === key?.kid &&
          f.statement?.withdrawn !== true &&
          f.statement?.status !== "withdrawn" &&
          !facts.some(
            (later) =>
              later.claimType === "organization.role" &&
              later.subject === peer.party &&
              later.statement?.subjectKey === key?.kid &&
              (later.statement?.withdrawn === true || later.statement?.status === "withdrawn"),
          ) &&
          current(f),
      );
      if (!role) continue;
      if (Date.parse(rule.expires) <= Date.parse(this.now()))
        return { ok: false, reason: "expired" };
      const items = intent.parameters.items;
      if (
        !Array.isArray(items) ||
        !items.length ||
        items.some((i) => typeof i !== "string" || !rule.allows.items.includes(i))
      )
        return { ok: false, reason: "excessive-scope" };
      const request = this.getDomain(`_standing-request:${intent.conversation}`) as
        | JsonObject
        | undefined;
      if (
        !request ||
        request.actor !== peer.actor ||
        request.party !== peer.party ||
        digestOf(request.items) !== digestOf(items)
      )
        return { ok: false, reason: "excessive-scope" };
      return { ok: true, rule };
    }
    if (!this.reauthorising)
      this.inbound.verdictEvent(
        "source",
        "fail",
        "No current admitted professional-register role for the authenticated requester.",
        { reason: "source-unknown" },
      );
    return { ok: false, reason: "source-unknown" };
  }

  private dutyExecutor() {
    return new DutyExecutor(
      this.state.duties,
      () => this.now(),
      (r) => this.record(r),
    );
  }

  private agreementDutyRules(agreement: Agreement | undefined): DutyRule[] {
    const value = agreement?.terms.duties;
    if (value === undefined) return [];
    if (!Array.isArray(value))
      throw new RejectError("unsupported-term", "agreement duties must be a closed list");
    return value.map((d) => dutyRuleSchema.parse(d));
  }

  private installAgreementDuties(agreement: Agreement) {
    for (const rule of this.agreementDutyRules(agreement))
      if (rule.kind === "delete" && rule.by)
        this.dutyExecutor().add({
          kind: "delete",
          source: agreement.id,
          items: rule.items,
          due: rule.by,
        });
  }

  private recordItemTransfer(message: AnyMessage, conv: ConversationState, incoming: boolean) {
    const peer = incoming
      ? { actor: message.from.actor, party: message.from.onBehalfOf }
      : { actor: message.to?.actor, party: message.to?.party };
    if (!peer.actor || !peer.party) return;
    const agreement = conv.agreement ? this.state.agreements[conv.agreement] : undefined;
    const rules = this.agreementDutyRules(agreement);
    for (const evidence of message.evidence ?? []) {
      if (evidence.role !== "credential") continue;
      let claim: JsonObject;
      try {
        claim = unverifiedEvidenceClaim(evidence);
      } catch {
        continue;
      }
      const fact = this.gateMemory.facts.get(String(claim.id));
      if (!fact || fact.digest !== digestOf(claim) || !claim.subject) continue;
      this.dutyExecutor().transfer(
        {
          item: String(claim.id),
          digest: fact.digest,
          subject: String(claim.subject),
          to: { actor: peer.actor, party: peer.party },
          ...(agreement ? { agreement: agreement.id } : {}),
          duties: rules,
          message: message.id,
          at: this.now(),
        },
        incoming,
      );
    }
  }

  private erasureAuthorised(message: Message<"invoke">) {
    const input = message.body.input;
    if (
      typeof input.subject !== "string" ||
      !Array.isArray(input.items) ||
      !input.items.length ||
      !input.items.every((id) => typeof id === "string")
    )
      return false;
    if (message.from.onBehalfOf === input.subject)
      return input.items.every(
        (id) =>
          [...this.gateMemory.facts.values()].some(
            (f) => f.id === id && f.subject === input.subject,
          ) ||
          Object.values(this.state.contextItems)
            .flat()
            .some((f) => f.id === id && f.subject === input.subject),
      );
    return (
      input.onward === true &&
      input.items.every((id) =>
        this.state.duties.incoming.some(
          (t) =>
            t.item === id &&
            t.subject === input.subject &&
            t.to.party === message.from.onBehalfOf &&
            t.agreement &&
            t.duties.some((d) => d.kind === "inform-onward"),
        ),
      )
    );
  }

  private erasePayloads(ids: ReadonlySet<string>) {
    const contains = (value: unknown, depth = 0): boolean => {
      if (depth > 32) return false;
      if (typeof value === "string") {
        if (ids.has(value)) return true;
        const parts = value.split(".");
        if (parts.length === 3)
          try {
            return contains(decodeCompactPayload(value), depth + 1);
          } catch {}
        return false;
      }
      return (
        !!value &&
        typeof value === "object" &&
        Object.values(value).some((v) => contains(v, depth + 1))
      );
    };
    for (const [scope, items] of Object.entries(this.state.contextItems)) {
      this.state.contextItems[scope] = items.map((item) => {
        if (!ids.has(item.id) && !contains(item.statement)) return item;
        const { statement: _payload, identifiers: _values, ...tombstone } = item;
        return {
          ...tombstone,
          accepted: false,
          kind: "memory" as const,
          label: `Discarded input: ${item.label}`,
        };
      });
      this.gateMemory.contexts[scope] = this.state.contextItems[scope] ?? [];
    }
    for (const id of ids) {
      this.gateMemory.facts.delete(id);
      delete this.state.precedenceHolds[id];
    }
    for (const [key, value] of Object.entries(this.state.domain))
      if (contains(value)) delete this.state.domain[key];
    for (const [key, value] of Object.entries(this.state.outbox))
      if (contains(value.wire)) delete this.state.outbox[key];
    for (const [key, value] of Object.entries(this.state.pending))
      if (contains(value.continuation)) delete this.state.pending[key];
    for (const [key, value] of Object.entries(this.state.recordMessages))
      if (contains(value.jws)) delete this.state.recordMessages[key];
    this.record({ type: "items-deleted", items: [...ids], at: this.now() });
    this.options.gates?.sink?.emit({
      part: "record",
      kind: "record",
      caption: `Payloads deleted; digest tombstones retained for ${[...ids].join(", ")}.`,
    });
  }

  private eraseReferenceStatement(item: string, grant: string): void {
    let other: import("../gates/common.js").ContextItem | undefined;
    let erased = false;
    for (const [scope, items] of Object.entries(this.state.contextItems)) {
      this.state.contextItems[scope] = items.map((fact) => {
        if (fact.id !== item) return fact;
        if (fact.dataUseGrant?.id !== grant) {
          if (fact.accepted && fact.statement) other = fact;
          return fact;
        }
        const {
          statement: _payload,
          identifiers: _values,
          original: _original,
          ...tombstone
        } = fact;
        if (!_payload && !_original) return fact;
        erased = true;
        return {
          ...tombstone,
          accepted: false,
          kind: "memory",
          label: `Discarded input: ${fact.label}`,
        };
      });
    }
    if (this.gateMemory.facts.get(item)?.dataUseGrant?.id === grant) {
      erased = true;
      if (other) this.gateMemory.facts.set(item, other);
      else this.gateMemory.facts.delete(item);
    }
    if (this.state.precedenceHolds[item]?.dataUseGrant?.id === grant) {
      erased = true;
      delete this.state.precedenceHolds[item];
    }
    if (erased) {
      this.record({ type: "reference-statement-deleted", item, grant });
      this.persist();
    }
  }

  private eraseRequested(message: Message<"invoke">): JsonObject {
    const subject = String(message.body.input.subject);
    const items = message.body.input.items as string[];
    const parts: JsonObject[] = items.map((item) => ({ item, outcome: "done" }));
    parts.push(...this.dutyExecutor().inform(subject, items, message.id));
    this.erasePayloads(new Set(items));
    this.persist();
    return { subject, parts };
  }

  triggerDuties(event: string) {
    const sources = [
      ...Object.values(this.state.agreements).flatMap((a) =>
        this.agreementDutyRules(a).map((rule) => ({ source: a.id, rule })),
      ),
      ...(this.mandate?.mandate.duties ?? []).map((rule) => ({
        source: this.mandate?.mandate.id ?? "",
        rule,
      })),
    ];
    for (const { source, rule } of sources) {
      if (rule.kind === "delete" && rule.on === event)
        this.dutyExecutor().add({ kind: "delete", source, items: rule.items, due: this.now() });
      if (rule.kind === "notify" && rule.event === event)
        for (const party of rule.parties) {
          const actor = this.trust.data.keys.find(
            (k) => k.role === "actor" && k.party === party,
          )?.subject;
          if (!actor) {
            this.record({ type: "duty-unroutable", source, party, event, reason: "lookup-failed" });
            continue;
          }
          this.dutyExecutor().add({
            kind: "notify",
            source,
            items: [],
            event,
            recipient: { actor, party },
            due: new Date(Date.parse(this.now()) + rule.withinSeconds * 1000).toISOString(),
          });
        }
    }
    this.persist();
    return this.auditDuties();
  }

  auditDuties() {
    const deadline = this.options.gates?.agreementDeadlineSeconds;
    if (deadline)
      for (const conversation of Object.values(this.state.conversations)) {
        const start = this.getDomain(`_start:${conversation.id}`) as unknown as
          | StartPlan
          | undefined;
        if (
          conversation.role === "initiator" &&
          !conversation.agreement &&
          !isTerminal(conversation.phase) &&
          start?.type === "propose" &&
          Date.parse(this.now()) - Date.parse(conversation.openedAt) > deadline * 1000
        ) {
          const intent: ActionIntent = {
            action: "use",
            operation: conversation.operation?.id ?? "urn:op:agreement",
            target: conversation.operation?.id ?? "urn:op:agreement",
            conversation: conversation.id,
            parameters: {},
          };
          for (const verdict of this.outbound.rejectEffect(intent, "no-agreement"))
            this.record(verdict);
          this.closeLocally(conversation, "refused", "no-agreement");
        }
      }
    for (const rule of this.mandate?.mandate.duties ?? [])
      if (rule.kind === "delete" && rule.by)
        this.dutyExecutor().add({
          kind: "delete",
          source: this.mandate?.mandate.id ?? "",
          items: rule.items,
          due: rule.by,
        });
    const work = this.dutyExecutor().audit();
    for (const duty of work)
      if (
        duty.kind === "delete" &&
        duty.status === "pending" &&
        Date.parse(duty.due) <= Date.parse(this.now())
      ) {
        if (duty.referenceCopy) {
          const { operation, grant } = duty.referenceCopy;
          const handler = this.handlers.get(operationKey(operation));
          const item = duty.items[0];
          if (!item) continue;
          this.eraseReferenceStatement(item, grant);
          if (!handler?.eraseReferenceCopy?.(item, grant)) continue;
        } else {
          this.erasePayloads(new Set(duty.items));
        }
        const stored = this.state.duties.work[duty.id];
        if (stored) stored.status = "discharged";
        this.record({ type: "duty-discharged", ...duty, status: "discharged", at: this.now() });
      }
    if (work.some((d) => d.missedAt)) {
      this.options.gates?.sink?.emit({
        part: "outbound-gate",
        kind: "check",
        check: "evidence",
        verdict: "ask-more",
        reason: "result-uncertain",
        caption: "A required signed acknowledgement missed its deadline.",
      });
      this.options.gates?.sink?.emit({
        part: "outbound-gate",
        kind: "decision",
        outcome: "ask-more",
        reason: "result-uncertain",
        caption: "The notice audit retains the missed acknowledgement.",
      });
    }
    this.options.gates?.sink?.emit({
      part: "record",
      kind: "record",
      caption: `Duty audit: ${Object.values(this.state.duties.work)
        .map(
          (duty) =>
            `${duty.kind === "notify" ? "Notification" : duty.kind === "withdraw-access" ? "Access withdrawal" : "Deletion"} ${duty.status}${"acknowledgedAt" in duty && duty.acknowledgedAt ? "; acknowledged by its recipient" : ""}`,
        )
        .join(". ")}.`,
    });
    this.persist();
    return copyData(Object.values(this.state.duties.work));
  }

  dischargeDuties(): Promise<StepResult> {
    return this.exclusive(async () => {
      await this.reconcilePodGrants();
      this.auditDuties();
      const outbound: OutboundMessage[] = [];
      for (const duty of Object.values(this.state.duties.work)) {
        if (duty.kind === "withdraw-access") {
          if (duty.status === "pending" && Date.parse(this.now()) >= Date.parse(duty.due)) {
            const plan = this.withdrawalPlan(duty, "expiry");
            await this.runEffect(plan.key, plan, duty.source);
          }
          continue;
        }
        if (duty.kind === "delete" || duty.message || !duty.recipient) continue;
        const operation =
          duty.kind === "inform-onward" ? "urn:op:erasure-request" : "urn:op:general-notice";
        this.registerIdentifier(duty.id);
        const conversation = derivedUrn("general-duty", duty.id);
        const previous = Object.values(this.state.outbox).find(
          (entry) => entry.conversation === conversation && entry.kind === "invoke",
        );
        if (previous) {
          const message = peekWire(previous.wire);
          if (message) {
            this.dutyExecutor().sent(duty.id, previous.id, conversation);
            outbound.push(this.outboundFromEntry(previous, message));
            continue;
          }
        }
        const input: JsonObject =
          duty.kind === "inform-onward"
            ? { subject: duty.subject ?? "", items: duty.items, onward: true }
            : { duty: duty.id, event: duty.event ?? "" };
        const result = await this.start({
          conversation,
          peer: duty.recipient,
          configuration: this.options.accepted[0],
          discover: false,
          plan: {
            type: "invoke",
            operation: { id: operation, version: "0.1" },
            models: [],
            input,
            basis: { kind: "represented" },
            purpose: "urn:purpose:duties",
          },
        });
        outbound.push(...result.outbound);
        const sent = result.outbound[0];
        if (sent) this.dutyExecutor().sent(duty.id, sent.id, sent.message.conversation);
      }
      this.persist();
      return this.result("local", { outbound });
    });
  }

  private notificationFor(duty: RuntimeState["notificationDuties"][string]) {
    const recipient = this.options.gates?.notificationRecipients?.[duty.recipient];
    if (!recipient || (duty.recipient === "principal" && recipient.party !== this.identity.party))
      return undefined;
    return Object.values(this.state.outbox).find((entry) => {
      if (entry.conversation !== derivedUrn("notification", duty.id)) return false;
      const message = peekWire(entry.wire);
      return (
        message?.kind === "invoke" &&
        message.from.actor === this.identity.actor &&
        message.to?.actor === recipient.actor &&
        message.to.party === recipient.party &&
        message.body.operation.id === "urn:op:duty-notification" &&
        message.body.purpose === "urn:purpose:emergency-notification" &&
        digestOf(message.body.input) === digestOf({ rule: duty.rule, use: duty.use })
      );
    });
  }

  notificationDuties() {
    let changed = false;
    for (const duty of Object.values(this.state.notificationDuties)) {
      if (duty.status === "pending") {
        const sent = this.notificationFor(duty);
        if (sent) {
          changed = true;
          duty.status =
            Date.parse(sent.createdAt) <= Date.parse(duty.due) ? "discharged" : "failed";
          duty.at = sent.createdAt;
          duty.message = sent.id;
          this.record({
            type: duty.status === "discharged" ? "duty-discharged" : "duty-failed",
            ...duty,
          });
        }
      }
      if (duty.status === "pending" && deadlineMissed(duty.due, this.now())) {
        changed = true;
        duty.status = "failed";
        this.record({ type: "duty-failed", ...duty, at: this.now() });
        this.options.gates?.sink?.emit({
          part: "record",
          kind: "record",
          caption: `Failed notification duty ${duty.id}, due ${duty.due}.`,
        });
      }
    }
    if (changed) this.persist();
    return copyData(Object.values(this.state.notificationDuties));
  }

  dischargeNotifications(): Promise<StepResult> {
    this.notificationWork ??= this.dischargeNotificationDuties().finally(() => {
      this.notificationWork = undefined;
    });
    return this.notificationWork;
  }

  private async dischargeNotificationDuties(): Promise<StepResult> {
    const outbound: OutboundMessage[] = [];
    this.notificationDuties();
    for (const duty of Object.values(this.state.notificationDuties)) {
      if (duty.status === "discharged" || duty.message) continue;
      const peer = this.options.gates?.notificationRecipients?.[duty.recipient];
      if (!peer || (duty.recipient === "principal" && peer.party !== this.identity.party)) continue;
      const notificationConversation = derivedUrn("notification", duty.id);
      const previous = this.notificationFor(duty);
      if (previous) {
        duty.status = "discharged";
        duty.at = previous.createdAt;
        duty.message = previous.id;
        this.record({ type: "duty-discharged", ...duty });
        this.persist();
        continue;
      }
      const result = await this.startInvocation({
        conversation: notificationConversation,
        peer,
        operation: { id: "urn:op:duty-notification", version: "0.1" },
        input: { rule: duty.rule, use: duty.use },
        basis: { kind: "represented" },
        purpose: "urn:purpose:emergency-notification",
        models: [],
      });
      if (result.outbound.length) {
        const late = duty.status === "failed";
        duty.status = late ? "failed" : "discharged";
        duty.at = this.now();
        duty.message = result.outbound[0]?.id;
        this.record({ type: late ? "duty-late-notification" : "duty-discharged", ...duty });
        this.options.gates?.sink?.emit({
          part: "record",
          kind: "record",
          caption: `Notification duty ${duty.id} discharged at ${duty.at} by message ${duty.message}.`,
        });
        outbound.push(...result.outbound);
        this.persist();
      }
    }
    return this.result("local", { outbound });
  }

  /** Record an effect as `planned` (definitely not attempted) if not already known. */
  private planEffect(
    ownerId: Iri,
    plan: EffectPlan,
    basis: Iri,
    emailChallenge?: EmailChallenge,
  ): EffectState {
    const existing = this.state.effects[plan.key];
    if (existing) return existing;
    const planned: EffectState = {
      key: plan.key,
      adapter: plan.adapter,
      activity: this.newId(),
      conversation: ownerId,
      basis,
      params: plan.params,
      intentDigest: actionDigest(plan.intent),
      activityType: plan.activityType,
      status: "planned",
      attempts: 0,
      receiptSent: !plan.receipt,
      ...(emailChallenge ? { emailChallenge } : {}),
      startedAt: this.now(),
    };
    this.state.effects[plan.key] = planned;
    this.setDomain(`_effectIntent:${plan.key}`, plan.intent as unknown as Json, ownerId);
    return planned;
  }

  /** Rebuild the plan of a recorded effect (for recovery). */
  private planOf(effect: EffectState): EffectPlan | undefined {
    const intent = this.findEffectIntent(effect);
    if (!intent) return undefined;
    return {
      adapter: effect.adapter,
      key: effect.key,
      params: effect.params as JsonObject,
      intent,
      activityType: effect.activityType ?? "unknown",
      ...(effect.receiptSent ? {} : { receipt: { final: true } }),
    };
  }

  private async callAdapter(op: () => Promise<EffectResult>, what: string): Promise<EffectResult> {
    const ms = this.options.effectTimeoutMs ?? DEFAULT_EFFECT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<EffectResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ conclusion: "uncertain", reason: `${what} timed out after ${ms} ms` }),
            ms,
          );
        }),
      ]);
    } catch (error) {
      return { conclusion: "uncertain", reason: `${what} error: ${(error as Error).message}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async redeemForEffect(plan: EffectPlan): Promise<boolean> {
    const policy = this.options.gates?.singleUse;
    const rules = policy?.actions.filter((r) => r.action === plan.intent.action) ?? [];
    if (!rules.length) return true;
    const fail = (reason: string) => {
      for (const verdict of this.outbound.rejectEffect(plan.intent, reason)) this.record(verdict);
      this.record({ type: "single-use-effect-refusal", effect: plan.key, reason, at: this.now() });
      return false;
    };
    const key = this.keysByAlg.get("EdDSA");
    if (!key || !this.identity.party || !policy) return fail("not-authorised");
    for (const rule of rules) {
      if (plan.intent.parameters.item !== rule.item) return fail("evidence-invalid");
      if (rule.parametersDigest && digestOf(plan.intent.parameters) !== rule.parametersDigest)
        return fail("terms-digest-mismatch");
      const service = policy.registers[rule.register];
      if (!service || service.identity !== rule.register) return fail("lookup-failed");
      for (const operation of ["status", rule.operation] as const) {
        const request = {
          type: "SingleUseRequest",
          id: this.newId(),
          actor: this.identity.actor,
          party: this.identity.party,
          item: rule.item,
          operation,
          at: this.now(),
          purpose: plan.intent.purpose,
          for: actionDigest(plan.intent),
          evidence: [...policy.evidence],
          acceptances: [...policy.acceptances],
        };
        let answer: import("../mechanisms/single-use.js").RegisterResult;
        try {
          answer = await service.request(
            await signCompact(key, "awp-single-use-request+jws", request),
          );
        } catch {
          return fail("lookup-failed");
        }
        if (!answer.ok) return fail(answer.reason);
        const checked = await verifyStatement(answer.jws, {
          trust: this.trust,
          typ: TYP.statement,
          role: "issuer",
          schema: singleUseStatusSchema,
          limits: this.limits,
          at: this.now(),
          verifier: this.identity.actor,
        });
        this.record(checked.verification);
        const status = checked.payload;
        if (
          !status ||
          checked.signer?.subject !== rule.register ||
          status.issuer !== rule.register ||
          status.subject !== rule.item
        )
          return fail("evidence-invalid");
        const age = Date.parse(this.now()) - Date.parse(status.asOf);
        if (age < 0 || age > rule.maxAgeSeconds * 1000) return fail("lookup-failed");
        if (operation === "status" && ["redeemed", "withdrawn"].includes(status.status))
          return fail("status-withdrawn");
        if (
          operation !== "status" &&
          (status.status !== "redeemed" ||
            status.redeemedBy !== this.identity.party ||
            status.for !== actionDigest(plan.intent))
        )
          return fail("evidence-invalid");
        this.record({
          type: "single-use-answer",
          effect: plan.key,
          statement: status,
          jws: answer.jws,
          at: this.now(),
        });
        this.persist();
      }
    }
    return true;
  }

  private markApprovalConsumed(intent: ActionIntent): (() => void) | undefined {
    const gate = this.options.gates;
    const digest = actionDigest(intent);
    const orgApprovals = this.state.organisationApprovals[digest] ?? [];
    if (
      intent.action !== "pay" &&
      !gate?.personDecisions?.some((p) => p.action === intent.action) &&
      !(gate?.email && intent.operation === "urn:op:email") &&
      !this.state.relianceBindings[digest] &&
      !orgApprovals.length
    )
      return undefined;
    const approval = this.state.approvals[digest];
    const consumed = approval && !this.state.usedApprovals[approval.id];
    if (consumed) this.state.usedApprovals[approval.id] = true;
    for (const org of orgApprovals) this.state.usedApprovals[org.id] = true;
    return consumed
      ? () => this.record({ type: "approval-consumed", id: approval.id, actionDigest: digest })
      : undefined;
  }

  private async publicationMatches(adapter: EffectAdapter, plan: EffectPlan): Promise<boolean> {
    if (!adapter.publicationRecipient) return true;
    if (digestOf(plan.params) !== digestOf(plan.intent.parameters)) return false;
    const recipient = adapter.publicationRecipient(ActionIntentNode.toNode(plan.intent).parameters);
    const { evidence, items } = plan.params;
    if (
      plan.intent.action !== "distribute" ||
      !recipient ||
      recipient !== plan.intent.recipient ||
      Object.keys(plan.params).some((key) => !["host", "evidence", "items"].includes(key)) ||
      !Array.isArray(items) ||
      !Array.isArray(evidence) ||
      !items.length ||
      items.length !== evidence.length
    )
      return false;
    for (const [index, jws] of items.entries()) {
      if (typeof jws !== "string" || typeof evidence[index] !== "string") return false;
      const id = String(evidence[index]);
      const fact = this.gateMemory.facts.get(id);
      if (!fact?.digest || fact.compactProofDigest !== digestOf(jws)) return false;
      const verify = (role: "issuer" | "party") =>
        verifyStatement(jws, {
          trust: this.trust,
          typ: TYP.statement,
          role,
          schema: claimSchema,
          limits: this.limits,
          verifier: this.identity.actor,
          at: this.now(),
        });
      let checked = await verify("issuer");
      if (checked.verification.outcome === "unknown-key") checked = await verify("party");
      const claim = checked.payload;
      if (
        !claim ||
        checked.signer?.subject !== claim.issuer ||
        claim.id !== id ||
        digestOf(decodeCompactPayload(jws)) !== fact.digest
      )
        return false;
    }
    return true;
  }

  private recordEvidenceFor(adapter: EffectAdapter, plan: EffectPlan) {
    if (plan.intent.action !== "distribute") return undefined;
    const parameters = ActionIntentNode.toNode(plan.intent).parameters;
    return this.recordDisclosures(parameters, plan.intent, adapter.recordRangeOnly === true);
  }

  private async runEffect(
    ownerId: Iri,
    plan: EffectPlan,
    basis: Iri,
    newChallenge?: EmailChallenge,
  ): Promise<OutboundMessage[]> {
    const existingChallenge = this.state.effects[plan.key]?.emailChallenge;
    if (
      existingChallenge &&
      digestOf(this.state.effects[plan.key]?.params) !== digestOf(plan.params)
    )
      return [];
    const boundary = this.effectAdapters.get(plan.adapter);
    const withdrawal =
      plan.adapter === POD_ACCESS_ADAPTER ? this.withdrawalEffectDuty(plan) : undefined;
    if (plan.adapter === POD_ACCESS_ADAPTER && !withdrawal) {
      for (const verdict of this.outbound.rejectEffect(plan.intent, "not-authorised"))
        this.record(verdict);
      return [];
    }
    if (boundary?.bindsParameters || boundary?.plainTextEmail || boundary?.publicationRecipient) {
      if (digestOf(plan.params) !== digestOf(plan.intent.parameters)) {
        for (const verdict of this.outbound.rejectEffect(plan.intent, "not-authorised"))
          this.record(verdict);
        return [];
      }
    }
    if (boundary && !(await this.publicationMatches(boundary, plan))) {
      for (const verdict of this.outbound.rejectEffect(plan.intent, "evidence-invalid"))
        this.record(verdict);
      return [];
    }
    let emailContext: { text: string; approved: boolean } | undefined;
    if (boundary?.plainTextEmail) {
      const email = emailEnvelopeSchema.safeParse(plan.params);
      if (
        !email.success ||
        plan.intent.operation !== "urn:op:email" ||
        plan.intent.action !== "distribute" ||
        email.data.to !== plan.intent.recipient ||
        email.data.purpose !== plan.intent.purpose ||
        email.data.from !== this.options.gates?.email?.from ||
        !email.data.text.endsWith(this.emailFooter()) ||
        !(await this.checkEmailPin(email.data.to, email.data.purpose))
      ) {
        for (const verdict of this.outbound.rejectEffect(plan.intent, "source-unknown"))
          this.record(verdict);
        return [];
      }
      const approval = this.state.approvals[actionDigest(plan.intent)];
      const approved =
        approval?.decision === "approve" &&
        Date.parse(approval.validUntil) > Date.parse(this.now()) &&
        !this.state.usedApprovals[approval.id];
      // Brief 31 §2.4: while a mailbox challenge is active, the context checks run inside
      // the release, in the ordered position of disclosure and data terms. Every other email
      // keeps the baseline order: context checks before the gate decides.
      if (existingChallenge || newChallenge || this.namedMailbox(email.data.to, email.data.purpose))
        emailContext = { text: email.data.text, approved };
      else {
        const contextVerdicts = this.outbound.checkEmailContext(
          plan.intent,
          email.data.text,
          approved,
        );
        for (const verdict of contextVerdicts) this.record(verdict);
        if (contextVerdicts.some((verdict) => verdict.verdict === "fail")) return [];
      }
    }
    if (boundary?.releasesRecord) {
      if (boundary.recordRecipient !== plan.intent.recipient) {
        for (const verdict of this.outbound.rejectEffect(plan.intent, "not-authorised"))
          this.record(verdict);
        return [];
      }
      if (digestOf(plan.params) !== digestOf(plan.intent.parameters)) {
        for (const verdict of this.outbound.rejectEffect(plan.intent, "not-authorised"))
          this.record(verdict);
        return [];
      }
      const evidence = await this.recordEvidenceFor(boundary, plan);
      if (!evidence) {
        for (const verdict of this.outbound.rejectEffect(plan.intent, "evidence-invalid"))
          this.record(verdict);
        return [];
      }
      plan = {
        ...plan,
        params: { ...plan.params, evidence },
        intent: { ...plan.intent, parameters: { ...plan.intent.parameters, evidence } },
      };
    }
    if (!this.outbound.checkEffect(plan.intent, plan.params)) return [];
    const existing = this.state.effects[plan.key];
    if (existing?.status === "concluded") return []; // idempotent: already done
    if (existing?.status === "attempting") return this.reconcileOne(existing);
    const planned = this.planEffect(
      ownerId,
      plan,
      basis,
      boundary?.plainTextEmail ? newChallenge : undefined,
    );
    const scoped = this.effectAdapters.get(plan.adapter);
    this.recordReleaseDigest =
      scoped?.releasesRecord || scoped?.purposeScoped ? actionDigest(plan.intent) : undefined;
    this.outbound.holdEmailContext(emailContext);
    const expiry = plan.params.reason === "expiry";
    const decision = this.authorise(
      plan.intent,
      false,
      [],
      withdrawal?.grant && { grant: withdrawal.grant, reason: expiry ? "expiry" : "principal" },
    );
    this.outbound.holdEmailContext(undefined);
    for (const verdict of this.outbound.takeEmailContextVerdicts()) this.record(verdict);
    this.recordReleaseDigest = undefined;
    const adapter = this.effectAdapters.get(plan.adapter);
    const expiryGrant = expiry && withdrawal?.grant;
    // A due withdrawal still owes cleanup when the gate cannot authorize an attempt now.
    if (expiryGrant && (decision.outcome !== "permit" || !adapter)) return [];
    if (decision.outcome === "ask-more") return [];
    if (decision.outcome === "approval-required") {
      this.park(ownerId, plan.intent, { type: "effect", plan, basis });
      return [];
    }
    const at = this.now();
    this.record({
      type: "activity",
      id: planned.activity,
      activityType: plan.activityType,
      basis,
      effectKey: plan.key,
      actor: this.identity.actor,
      ...(this.identity.party ? { onBehalfOf: this.identity.party } : {}),
      startedAt: at,
      status: "intended",
    });
    if (decision.outcome !== "permit" || !adapter) {
      return this.conclude(
        planned,
        {
          conclusion: "not-executed",
          reason: adapter ? `not authorised: ${decision.reason}` : `no adapter ${plan.adapter}`,
        },
        "direct-response",
      );
    }
    if (!(await this.redeemForEffect(plan))) {
      if (expiryGrant) return [];
      return this.conclude(
        planned,
        { conclusion: "not-executed", reason: "single-use check refused" },
        "direct-response",
      );
    }
    if (!(await this.outbound.ensureRecord(plan.key))) {
      if (expiryGrant) return [];
      return this.conclude(
        planned,
        { conclusion: "not-executed", reason: "record-unavailable" },
        "direct-response",
      );
    }
    this.outbound.sealEffect(plan.intent, plan.key);
    if (!(await this.outbound.ensureRecord(plan.key))) {
      if (expiryGrant) return [];
      return this.conclude(
        planned,
        { conclusion: "not-executed", reason: "record-unavailable" },
        "direct-response",
      );
    }
    const attempting: EffectState = {
      ...planned,
      status: "attempting",
      attempts: planned.attempts + 1,
      startedAt: at,
    };
    this.state.effects[plan.key] = attempting;
    this.persist(); // WRITE-AHEAD: the attempt (and everything before it) is durable first
    const result = await this.callAdapter(() => adapter.execute(plan.key, plan.params), "adapter");
    return this.conclude(attempting, result, "direct-response");
  }

  /**
   * Record an effect's conclusion. The receipt owed to the peer (if any) is emitted into
   * the outbox in the SAME snapshot as the conclusion, so a crash leaves either both or
   * neither; recover() re-derives whichever is missing.
   */
  private async conclude(
    effect: EffectState,
    result: EffectResult,
    method: "direct-response" | "reconciliation" | "recovery",
  ): Promise<OutboundMessage[]> {
    const at = this.now();
    this.record({
      type: "outcome",
      activity: effect.activity,
      conclusion: result.conclusion,
      ...(result.conclusion === "completed"
        ? { observed: result.observed }
        : { reason: result.reason }),
      method,
      at,
    });
    const challenge = effect.emailChallenge;
    if (challenge && result.conclusion === "completed")
      this.state.emailChallenges[canonicalJson([challenge.to, challenge.purpose])] =
        challenge.nonce;
    const status = result.conclusion === "uncertain" ? "attempting" : "concluded";
    let updated: EffectState = {
      ...effect,
      status,
      conclusion: result.conclusion,
      ...(result.conclusion === "completed" ? { observed: result.observed } : {}),
      ...(status === "concluded" ? { endedAt: at } : {}),
    };
    const out: OutboundMessage[] = [];
    const conv = this.state.conversations[effect.conversation];
    if (!updated.receiptSent && conv && !isTerminal(conv.phase)) {
      const final = result.conclusion !== "uncertain";
      if (final || !updated.uncertainReported) {
        const body = {
          ref: effect.basis,
          activity: effect.activity,
          outcome: result.conclusion,
          ...(result.conclusion === "completed" ? { observed: result.observed } : {}),
          final,
        };
        out.push(await this.emit(conv.id, "receipt", body, {}));
        updated = final
          ? { ...updated, receiptSent: true }
          : { ...updated, uncertainReported: true };
      }
    }
    this.state.effects[effect.key] = updated;
    const task = this.state.tasks[effect.conversation];
    if (task) {
      this.state.tasks[task.id] = {
        ...task,
        status: status === "concluded" ? "concluded" : "running",
        conclusion: result.conclusion,
        updatedAt: at,
      };
    }
    this.persist();
    return out;
  }

  private async reconcileOne(effect: EffectState): Promise<OutboundMessage[]> {
    const adapter = this.effectAdapters.get(effect.adapter);
    if (!adapter) return [];
    const result = await this.callAdapter(
      () => adapter.reconcile(effect.key, effect.params as JsonObject),
      "reconcile",
    );
    this.record({
      type: "reconciliation",
      effectKey: effect.key,
      activity: effect.activity,
      finding: result.conclusion,
      at: this.now(),
    });
    const max = this.options.maxEffectAttempts ?? 3;
    if (result.conclusion === "not-executed" && effect.attempts < max) {
      // Authoritatively absent: safe to attempt again under the SAME idempotency key,
      // after re-checking authorisation (mutable conditions may have changed).
      const intent = this.findEffectIntent(effect);
      const plan = intent && {
        key: effect.key,
        adapter: effect.adapter,
        intent,
        params: effect.params as JsonObject,
        activityType: effect.activityType ?? "",
      };
      let decision: AuthorisationDecision | undefined;
      if (plan && (await this.publicationMatches(adapter, plan))) {
        const evidence = adapter.releasesRecord && (await this.recordEvidenceFor(adapter, plan));
        const recordMatches =
          !adapter.releasesRecord ||
          (evidence &&
            adapter.recordRecipient === intent.recipient &&
            digestOf(plan.params) === digestOf(intent.parameters) &&
            digestOf(evidence) === digestOf(plan.params.evidence ?? null));
        const withdrawal =
          plan.adapter === POD_ACCESS_ADAPTER ? this.withdrawalEffectDuty(plan) : undefined;
        if (recordMatches && (plan.adapter !== POD_ACCESS_ADAPTER || withdrawal)) {
          this.recordReleaseDigest =
            adapter.releasesRecord || adapter.purposeScoped ? actionDigest(intent) : undefined;
          try {
            decision = this.authorise(
              intent,
              true,
              [],
              withdrawal?.grant && {
                grant: withdrawal.grant,
                reason: plan.params.reason === "expiry" ? "expiry" : "principal",
              },
            );
          } finally {
            this.recordReleaseDigest = undefined;
          }
        }
      }
      if (decision?.outcome === "permit") {
        const retrying: EffectState = { ...effect, attempts: effect.attempts + 1 };
        this.state.effects[effect.key] = retrying;
        this.persist();
        const retry = await this.callAdapter(
          () => adapter.execute(effect.key, effect.params as JsonObject),
          "adapter",
        );
        return this.conclude(retrying, retry, "reconciliation");
      }
      return this.conclude(
        effect,
        {
          conclusion: "not-executed",
          reason: `absent at reconciliation; not re-attempted (${decision?.reason ?? "no intent"})`,
        },
        "reconciliation",
      );
    }
    return this.conclude(effect, result, "reconciliation");
  }

  private findEffectIntent(effect: EffectState): ActionIntent | undefined {
    return this.getDomain(`_effectIntent:${effect.key}`) as unknown as ActionIntent | undefined;
  }

  /** Alias of {@link recover} (kept for existing callers). */
  reconcile(): Promise<StepResult> {
    return this.recover();
  }

  /**
   * Complete work a crash, timeout or restart left open. Never re-executes blindly:
   *  - `planned` effects (never attempted) run now, after re-authorisation, unless an owner
   *    approval is pending for them or their conversation has closed;
   *  - `attempting` effects are reconciled with the adapter first;
   *  - concluded effects whose receipt never reached the outbox get it now;
   *  - replay entries still `processing` are marked `interrupted` (duplicates return the
   *    responses recorded so far; the message is not dispatched a second time).
   */
  recover(): Promise<StepResult> {
    return this.exclusive(async () => {
      await this.reconcilePodGrants();
      this.notificationDuties();
      const outbound: OutboundMessage[] = [];
      for (const effect of Object.values(this.state.effects)) {
        const owner = this.state.conversations[effect.conversation];
        const ownerClosed = owner
          ? isTerminal(owner.phase)
          : !this.state.tasks[effect.conversation];
        if (effect.status === "planned") {
          const plan = this.planOf(effect);
          const parked = Object.values(this.state.pending).some(
            (p) => p.actionDigest === effect.intentDigest,
          );
          if (parked) continue;
          const pendingExpiry =
            plan?.adapter === POD_ACCESS_ADAPTER &&
            plan.params.reason === "expiry" &&
            this.withdrawalEffectDuty(plan);
          if (!plan || (ownerClosed && !pendingExpiry)) {
            outbound.push(
              ...(await this.conclude(
                effect,
                {
                  conclusion: "not-executed",
                  reason: plan ? "owner conversation closed before the attempt" : "plan lost",
                },
                "recovery",
              )),
            );
            continue;
          }
          outbound.push(...(await this.runEffect(effect.conversation, plan, effect.basis)));
        } else if (effect.status === "attempting") {
          outbound.push(...(await this.reconcileOne(effect)));
        } else if (!effect.receiptSent && owner && !isTerminal(owner.phase) && effect.conclusion) {
          const body = {
            ref: effect.basis,
            activity: effect.activity,
            outcome: effect.conclusion,
            ...(effect.conclusion === "completed" && effect.observed
              ? { observed: effect.observed }
              : {}),
            final: true,
          };
          outbound.push(await this.emit(owner.id, "receipt", body, {}));
          this.state.effects[effect.key] = { ...effect, receiptSent: true };
          this.persist();
        }
      }
      let interrupted = 0;
      for (const [id, s] of Object.entries(this.state.seen)) {
        if (s.disposition === "processing") {
          this.state.seen[id] = { ...s, disposition: "interrupted" };
          interrupted++;
        }
      }
      if (interrupted > 0)
        this.record({ type: "recovery", interruptedMessages: interrupted, at: this.now() });
      this.persist();
      return this.result("local", { outbound });
    });
  }

  // ---------------------------------------------------------------- hand-off & retention

  /** Outbox entries a binding has not yet confirmed taking (hand-off tracking only). */
  undeliveredOutbound(): OutboundMessage[] {
    if (!this.options.trackHandOff) return [];
    return Object.values(this.state.outbox)
      .filter((e) => !e.handedOff)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => this.outboundFromEntry(e));
  }

  /** A binding confirms it durably took these outbound messages. */
  markHandedOff(ids: readonly Iri[]): Promise<void> {
    return this.exclusive(async () => {
      const at = this.now();
      for (const id of ids) {
        const e = this.state.outbox[id];
        if (e && !e.handedOff) this.state.outbox[id] = { ...e, handedOff: at };
      }
      this.persist();
    });
  }

  // ---------------------------------------------------------------- provider transmission

  /** Durable provider-transmission records (see `transmit`). */
  transmissions(): readonly TransmissionRecord[] {
    return Object.values(this.state.transmissions);
  }

  /**
   * Transmit one outbound message through an external provider: the effect boundary for
   * email. Re-decides at send time (authentic outbox entry, unexpired, the emission's
   * authorised intent re-authorised under the current mandate/revocations/approvals), keeps
   * a durable per-message record, persists `attempting` before calling the provider, and
   * never re-attempts an attempting/uncertain send without positive evidence or a
   * declared-final absence, nor while a timed-out request of its own is still pending.
   * See `runtime/transmission.ts` (this is not an exactly-once delivery guarantee).
   *
   * Phases: (1) serial — check the record, re-authorise NOW, write `attempting` ahead;
   * (2) the provider/peer request (and any lookup) with NO runtime lock held, so inbound
   * processing — e.g. a peer that is sending to this agent at the same moment — is never
   * queued behind this agent's network call; (3) serial — record the outcome. The decision in
   * (1) is the last one before the request leaves; a revocation that lands during (2) applies
   * to every later attempt.
   */
  async transmit(req: TransmitRequest, io: TransmissionIo): Promise<TransmitResult> {
    let step = await this.exclusive(async () => {
      const s = this.transmitStart(req, io);
      this.persist();
      return s;
    });
    if ("lookup" in step) {
      const found = await this.lookupOutside(io);
      step = await this.exclusive(async () => {
        const s = this.transmitAfterLookup(req, io, found);
        this.persist();
        return s;
      });
    }
    if ("result" in step) return step.result;
    if ("lookup" in step) throw new Error("transmission: lookup requested twice");
    return this.sendOutside(req, io, step.send, step.resend);
  }

  /** Update (or create) the durable record for `req` and log it. */
  private noteTransmission(
    req: TransmitRequest,
    status: TransmissionRecord["status"],
    extra: Partial<TransmissionRecord>,
  ): TransmissionRecord {
    const prior = this.state.transmissions[req.messageId];
    const at = this.now();
    const rec: TransmissionRecord = {
      messageId: req.messageId,
      binding: req.binding,
      externalId: req.externalId,
      wireDigest: req.wireDigest,
      attempts: prior?.attempts ?? 0,
      createdAt: prior?.createdAt ?? at,
      ...(prior?.providerRef ? { providerRef: prior.providerRef } : {}),
      ...extra,
      status,
      updatedAt: at,
    };
    this.state.transmissions[req.messageId] = rec;
    this.record({
      type: "transmission",
      message: req.messageId,
      binding: req.binding,
      externalId: req.externalId,
      status,
      attempts: rec.attempts,
      ...(rec.providerRef ? { providerRef: rec.providerRef } : {}),
      ...(rec.detail ? { detail: rec.detail } : {}),
      at,
    });
    return rec;
  }

  /**
   * Record the late settlement of a provider send that had timed out. Runs in the serial
   * queue (outside the original call's context); only an unresolved record is changed.
   */
  private settleLate(
    req: TransmitRequest,
    outcome: ProviderSendResult | undefined,
    why: string,
    attempt: { readonly number: number; readonly resend: boolean },
  ) {
    this.inside.exit(() => {
      void this.exclusive(async () => {
        this.inFlight.delete(req.messageId);
        if (this.closed) return; // the durable record stays unresolved
        const rec = this.state.transmissions[req.messageId];
        const open = rec && (rec.status === "attempting" || rec.status === "uncertain");
        // Only the latest attempt may move the record; and a late REFUSAL of a resend says
        // nothing about an EARLIER request, which stays unresolved (positive evidence only).
        const current = rec?.attempts === attempt.number;
        if (open && outcome?.outcome === "accepted")
          this.noteTransmission(req, "sent", {
            providerRef: outcome.providerRef,
            detail: "provider accepted after the effect timeout (late response)",
          });
        else if (open && current && outcome?.outcome === "rejected" && attempt.resend)
          this.noteTransmission(req, "uncertain", {
            detail: `resend refused after the effect timeout (${outcome.detail.slice(0, 160)}); an earlier request remains unresolved`,
          });
        else if (open && current && outcome?.outcome === "rejected")
          this.noteTransmission(req, "not-sent", {
            detail: `provider refused after the effect timeout: ${outcome.detail.slice(0, 200)}`,
          });
        else if (open && current && !outcome)
          this.noteTransmission(req, "uncertain", { detail: `late settlement: ${why}` });
        else
          this.record({
            type: "transmission-late-response",
            attempt: attempt.number,
            message: req.messageId,
            binding: req.binding,
            outcome: outcome?.outcome ?? "unknown",
            ...(outcome?.outcome === "accepted" ? { providerRef: outcome.providerRef } : {}),
            at: this.now(),
          });
        this.persist();
      }).catch(() => undefined);
    });
  }

  private refuseTransmission(
    req: TransmitRequest,
    reason: TransmissionRefusal,
    detail: string,
  ): TransmitResult {
    this.record({
      type: "transmission-refused",
      message: req.messageId,
      binding: req.binding,
      reason,
      detail,
      at: this.now(),
    });
    return { status: "refused", reason, detail };
  }

  /** Phase 1 (serial): what to do with this request now. */
  private transmitStart(req: TransmitRequest, io: TransmissionIo): TransmitStep {
    const rec = this.state.transmissions[req.messageId];
    if (
      rec &&
      (rec.binding !== req.binding ||
        rec.externalId !== req.externalId ||
        rec.wireDigest !== req.wireDigest)
    ) {
      return {
        result: this.refuseTransmission(
          req,
          "wire-mismatch",
          "a different payload is already recorded for this message",
        ),
      };
    }
    if (rec?.status === "sent") {
      this.record({
        type: "transmission-duplicate",
        message: req.messageId,
        binding: req.binding,
        at: this.now(),
      });
      return {
        result: {
          status: "duplicate",
          ...(rec.providerRef ? { providerRef: rec.providerRef } : {}),
        },
      };
    }
    // Never two concurrent requests from this process for one message.
    if (this.inFlight.has(req.messageId) && !io.lookup)
      return {
        result: {
          status: "uncertain",
          detail: "a request for this message from this process is still pending",
        },
      };
    if (rec && (rec.status === "attempting" || rec.status === "uncertain")) {
      // Never retry blindly. A receiver that deduplicates by the signed message id makes an
      // identical resend safe (it cannot duplicate a business effect) — re-authorised first;
      // otherwise positive evidence reconciles and only a declared-final absence permits
      // another attempt.
      if (io.idempotentResend) return this.transmitAttempt(req, io, true);
      if (!io.lookup) {
        const detail = "no provider lookup available";
        this.noteTransmission(req, "uncertain", { detail: `unresolved: ${detail}` });
        return { result: { status: "uncertain", detail } };
      }
      return { lookup: true };
    }
    return this.transmitAttempt(req, io, false);
  }

  /** Lookup of an earlier request (no runtime lock held); malformed/failed → unknown. */
  private async lookupOutside(io: TransmissionIo): Promise<ProviderLookupResult> {
    if (!io.lookup) return { outcome: "unknown", detail: "no provider lookup available" };
    try {
      return (
        providerLookupResultOf(await this.bounded(io.lookup(), "provider lookup")) ?? {
          outcome: "unknown",
          detail: "malformed provider lookup result",
        }
      );
    } catch (error) {
      return { outcome: "unknown", detail: (error as Error).message.slice(0, 200) };
    }
  }

  /** Phase 1b (serial): act on a lookup result. */
  private transmitAfterLookup(
    req: TransmitRequest,
    io: TransmissionIo,
    lookup: ProviderLookupResult,
  ): TransmitStep {
    const rec = this.state.transmissions[req.messageId];
    if (rec?.status === "sent")
      return {
        result: {
          status: "duplicate",
          ...(rec.providerRef ? { providerRef: rec.providerRef } : {}),
        },
      };
    let found = lookup;
    if (found.outcome === "found") {
      this.noteTransmission(req, "sent", {
        providerRef: found.providerRef,
        detail: "reconciled by provider lookup",
      });
      return { result: { status: "sent", providerRef: found.providerRef, reconciled: true } };
    }
    if (found.outcome === "absent" && this.inFlight.has(req.messageId))
      found = { outcome: "unknown", detail: "an earlier request is still in flight" };
    else if (found.outcome === "absent" && io.finalAbsence !== true)
      found = {
        outcome: "unknown",
        detail: "absence reported, but the provider does not declare it final",
      };
    if (found.outcome === "unknown") {
      this.noteTransmission(req, "uncertain", { detail: `unresolved: ${found.detail}` });
      return { result: { status: "uncertain", detail: found.detail } };
    }
    this.noteTransmission(req, "not-sent", {
      detail: "provider reports the operation absent and final",
    });
    return this.transmitAttempt(req, io, false);
  }

  /**
   * Re-decide NOW and write the attempt ahead. A refusal leaves an unresolved record
   * unresolved: refusing a resend is not evidence that the earlier request was not delivered.
   */
  private transmitAttempt(req: TransmitRequest, io: TransmissionIo, resend: boolean): TransmitStep {
    const refusal = this.transmissionRefusal(req);
    if (refusal) return { result: this.refuseTransmission(req, refusal[0], refusal[1]) };
    const attempts = this.state.transmissions[req.messageId]?.attempts ?? 0;
    const max = io.maxAttempts ?? MAX_TRANSMISSION_ATTEMPTS;
    if (attempts >= max)
      return {
        result: this.refuseTransmission(
          req,
          "attempt-limit",
          `${attempts} provider attempts already made`,
        ),
      };
    // Write-ahead: the attempt is durable before the provider sees anything.
    this.noteTransmission(req, "attempting", {
      attempts: attempts + 1,
      ...(resend
        ? { detail: "identical resend after an unresolved attempt (receiver deduplicates)" }
        : {}),
    });
    this.inFlight.add(req.messageId);
    return { send: attempts + 1, resend };
  }

  /** Phase 2 (no lock) + phase 3 (serial): perform the request and record its outcome. */
  private async sendOutside(
    req: TransmitRequest,
    io: TransmissionIo,
    attempt: number,
    resend: boolean,
  ): Promise<TransmitResult> {
    // A timeout does not cancel the request: keep observing it and record its settlement.
    let settled = false;
    const call = Promise.resolve()
      .then(() => io.send())
      .finally(() => {
        settled = true;
      });
    let sent: ProviderSendResult | undefined;
    let failure: string | undefined;
    try {
      sent = providerSendResultOf(await this.bounded(call, "provider send"));
      if (!sent) failure = "malformed provider send result";
    } catch (error) {
      failure = `provider error: ${(error as Error).message.slice(0, 200)}`;
    }
    if (failure && !settled) {
      const ctx = { number: attempt, resend };
      call.then(
        (v) => this.settleLate(req, providerSendResultOf(v), "malformed provider result", ctx),
        (e: unknown) => this.settleLate(req, undefined, `provider error: ${String(e)}`, ctx),
      );
    } else this.inFlight.delete(req.messageId);
    return this.exclusive(async () => {
      // A closed runtime no longer owns the state: the durable record stays `attempting`
      // (unresolved) and is reconciled by the next owner.
      if (this.closed)
        return {
          status: "uncertain",
          detail: "the runtime closed before the outcome was recorded",
        } as TransmitResult;
      let result: TransmitResult;
      if (failure || !sent) {
        const detail = failure ?? "malformed provider send result";
        this.noteTransmission(req, "uncertain", { detail });
        result = { status: "uncertain", detail };
      } else if (sent.outcome === "accepted") {
        this.noteTransmission(req, "sent", { providerRef: sent.providerRef });
        result = { status: "sent", providerRef: sent.providerRef, reconciled: false };
      } else if (resend) {
        // This attempt was refused, but an EARLIER request may have been delivered.
        const detail = `resend refused (${sent.detail.slice(0, 160)}); an earlier request remains unresolved`;
        this.noteTransmission(req, "uncertain", { detail });
        result = { status: "uncertain", detail };
      } else {
        this.noteTransmission(req, "not-sent", { detail: sent.detail.slice(0, 200) });
        result = { status: "not-sent", detail: sent.detail };
      }
      this.persist();
      return result;
    });
  }

  /** Why a (re)transmission must not happen now, or undefined if it may. */
  private transmissionRefusal(req: TransmitRequest): [TransmissionRefusal, string] | undefined {
    const entry = this.state.outbox[req.messageId];
    if (!entry) return ["unknown-message", "not a message in this agent's outbox"];
    if (wireDigest(entry.wire) !== req.wireDigest)
      return ["wire-mismatch", "payload differs from the outbox entry"];
    const message = this.outboundFromEntry(entry).message;
    if (Date.parse(message.expiresAt) <= Date.parse(this.now()))
      return ["expired", `message expired at ${message.expiresAt}`];
    const condition = this.conditionFailure(entry);
    if (condition) return ["condition-failed", condition];
    if (!entry.intent) return undefined; // declared metadata rule: authentic + unexpired
    const decision = this.authorise(entry.intent, true, message.evidence);
    if (decision.outcome === "permit") return undefined;
    if (decision.outcome === "approval-required")
      return ["approval-required", "the action needs a current owner approval"];
    return ["not-authorised", `${decision.outcome}: ${decision.reason}`];
  }

  /**
   * Re-evaluate a protected disclosure's conditions NOW with the role's checkers (no handler is
   * re-run). Returns why the disclosure must not happen, or undefined. Fails closed on an
   * unknown kind or a checker error; every evaluation is recorded (payload-free).
   */
  private conditionFailure(entry: OutboxEntry, record = true): string | undefined {
    for (const c of entry.conditions ?? []) {
      const check = this.options.disclosureChecks?.[c.kind];
      let result: ReturnType<DisclosureCheck>;
      try {
        result = check
          ? check(c.ref, this.now())
          : { ok: false, reason: `no checker for condition ${c.kind} (fails closed)` };
      } catch (error) {
        result = { ok: false, reason: `checker failed: ${(error as Error).message.slice(0, 160)}` };
      }
      if (record)
        this.record({
          type: "disclosure-condition",
          messageId: entry.id,
          kind: c.kind,
          ref: c.ref,
          outcome: result.ok ? "holds" : "fails",
          ...(result.ok ? {} : { reason: result.reason }),
          at: this.now(),
        });
      if (!result.ok) return `${c.kind}: ${result.reason}`;
    }
    return undefined;
  }

  /**
   * Would the protected content of this outbox entry be disclosable NOW? (For local renderings
   * such as the operator's outbound list, which must not show a disclosure that no longer
   * holds.) Messages without conditions are not protected by this mechanism. Not recorded (a
   * rendering is not a transmission).
   */
  disclosureHold(messageId: Iri): { protected: boolean; holds: boolean; reason?: string } {
    const entry = this.state.outbox[messageId];
    if (!entry?.conditions?.length) return { protected: false, holds: true };
    const failure = this.conditionFailure(entry, false);
    return failure
      ? { protected: true, holds: false, reason: failure }
      : { protected: true, holds: true };
  }

  /** Bound a provider call by the effect timeout (a timeout is treated as uncertain). */
  private bounded<T>(p: Promise<T>, what: string): Promise<T> {
    const ms = this.options.effectTimeoutMs ?? DEFAULT_EFFECT_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  /** Apply the retention policy now (it also runs before new conversations are opened). */
  compact(): Promise<CompactionReport> {
    return this.exclusive(async () => {
      const report = this.compactNow();
      this.persist();
      return report;
    });
  }

  private compactNow(): CompactionReport {
    const report = compactState(this.state, Date.parse(this.now()), this.retention, {
      trackHandOff: this.options.trackHandOff ?? false,
      maxClockSkewMs: this.limits.maxClockSkewMs,
    });
    if (report.removedConversations > 0 || report.removedApprovals > 0 || report.removedTasks > 0) {
      this.record({ type: "retention-compaction", ...report, at: this.now() });
    }
    return report;
  }

  // ---------------------------------------------------------------- local tasks

  tasks(): readonly TaskState[] {
    return Object.values(this.state.tasks);
  }

  /**
   * Run one local effect with no peer conversation (e.g. a booking through a remembered
   * conventional service). Same executor rules: mandate check, owner approval, write-ahead,
   * idempotency key, reconciliation. Calling again with the same task id is idempotent.
   */
  runTask(input: {
    taskId: Iri;
    kind: string;
    plan: EffectPlan;
    /** Where the core took this task from, when it came from a received message. */
    origin?: ProposalOrigin;
  }) {
    return this.runLocalTask(input);
  }

  private runLocalTask(
    input: {
      taskId: Iri;
      kind: string;
      plan: EffectPlan;
      /** Where the core took this task from, when it came from a received message. */
      origin?: ProposalOrigin;
    },
    challenge?: EmailChallenge,
  ): Promise<{
    task: TaskState;
    effect?: EffectState;
    decisions: readonly AuthorisationDecision[];
    pendingApproval?: string;
  }> {
    input = copyData(input);
    return this.exclusive(async () => {
      const at = this.now();
      let task = this.state.tasks[input.taskId];
      if (!task) {
        this.guardCapacity();
        task = {
          id: input.taskId,
          kind: input.kind,
          effectKey: input.plan.key,
          status: "running",
          createdAt: at,
          updatedAt: at,
        };
        this.state.tasks[task.id] = task;
      }
      if (task.effectKey !== input.plan.key)
        throw new Error("task id reused for a different effect");
      const effect = this.state.effects[input.plan.key];
      if (task.status !== "concluded" && !(effect?.status === "concluded")) {
        this.proposalOrigin = input.origin;
        try {
          await this.runEffect(task.id, input.plan, task.id, challenge);
        } finally {
          this.proposalOrigin = undefined;
        }
      }
      let after = this.state.tasks[task.id] as TaskState;
      const pending = Object.values(this.state.pending).find((p) => p.conversation === task.id);
      if (
        pending &&
        after.status === "running" &&
        this.state.effects[input.plan.key]?.status === "planned"
      ) {
        after = { ...after, status: "pending-approval", updatedAt: this.now() };
        this.state.tasks[task.id] = after;
      }
      this.persist();
      return {
        task: after,
        ...(this.state.effects[input.plan.key]
          ? { effect: this.state.effects[input.plan.key] as EffectState }
          : {}),
        decisions: [...this.decisions],
        ...(pending ? { pendingApproval: pending.actionDigest } : {}),
      };
    });
  }

  // ---------------------------------------------------------------- approvals

  private park(
    ownerId: Iri,
    intent: ActionIntent,
    continuation: Continuation,
    changePhase = false,
  ) {
    const digest = actionDigest(intent);
    this.state.pending[digest] = {
      actionDigest: digest,
      intent: copyData(intent),
      conversation: ownerId,
      continuation: copyData(continuation) as unknown as Json,
      releaseBinding: snapshotApprovalRelease(
        intent,
        continuation,
        this.state.conversations[ownerId]?.openProposal,
        this.state.conversations[ownerId]?.openProposal
          ? this.getDomain(`_offer:${this.state.conversations[ownerId]!.openProposal!.id}`)
          : undefined,
      ),
      createdAt: this.now(),
    };
    if (continuation.type === "effect")
      this.setDomain(`_effectIntent:${continuation.plan.key}`, intent as unknown as Json, ownerId);
    const conv = this.state.conversations[ownerId];
    if (changePhase && conv) this.apply(conv, { type: "approval-pending", at: this.now() });
    this.record({
      type: "approval-requested",
      actionDigest: digest,
      conversation: ownerId,
      at: this.now(),
    });
    return { actionDigest: digest, intent };
  }

  /** Directory roles have already passed inbound checks; approvals carry only exact action signatures. */
  submitOrganisationApproval(jws: string): Promise<StepResult> {
    return this.exclusive(async () => {
      try {
        const check = await verifyStatement(jws, {
          trust: this.trust,
          typ: "awp-organisation-approval+jws",
          role: "issuer",
          schema: organisationApprovalSchema,
          limits: this.limits,
          verifier: this.identity.actor,
          at: this.now(),
        });
        this.record(check.verification);
        const a = check.payload;
        const waiting = a ? this.state.pending[a.actionDigest] : undefined;
        if (
          !a ||
          !waiting ||
          !check.signer ||
          check.signer.subject !== a.signer ||
          a.actor !== this.identity.actor ||
          a.conversation !== waiting.conversation ||
          Date.parse(a.validUntil) <= Date.parse(this.now()) ||
          Date.parse(a.issuedAt) > Date.parse(this.now()) ||
          this.state.usedApprovals[a.id]
        )
          return this.result("rejected", { reason: "not-authorised", outbound: [] });
        const approvals = this.state.organisationApprovals[a.actionDigest] ?? [];
        if (approvals.some((prior) => prior.id === a.id))
          return this.result("rejected", { reason: "not-authorised", outbound: [] });
        this.state.organisationApprovals[a.actionDigest] = [
          ...approvals,
          {
            ...a,
            kid: check.signer.kid,
            jws,
            ...(waiting.releaseBinding ? { releaseBinding: copyData(waiting.releaseBinding) } : {}),
          },
        ];
        this.record({
          type: "organisation-approval",
          id: a.id,
          actionDigest: a.actionDigest,
          signer: a.signer,
          kid: check.signer.kid,
          jws,
          at: this.now(),
        });
        const decision = this.authorise(waiting.intent);
        this.persist();
        if (decision.outcome !== "permit")
          return this.result(
            decision.outcome === "approval-required" ? "pending-approval" : "rejected",
            {
              reason:
                decision.outcome === "approval-required" ? "approval-required" : "not-authorised",
              outbound: [],
            },
          );
        const result = await this.resumeApproved(waiting, {
          id: a.id,
          actionDigest: a.actionDigest,
          decision: "approve",
        });
        for (const approval of this.state.organisationApprovals[a.actionDigest] ?? [])
          this.state.usedApprovals[approval.id] = true;
        this.persist();
        return result;
      } finally {
        this.resuming = false;
      }
    });
  }

  /** Submit an owner approval (or denial) JWS; resumes the matching pending action. */
  submitApproval(
    jws: string,
    extra: {
      /** Statements that show the approval was given in a stronger form (CORE-OUT-8). */
      evidence?: readonly EvidenceItem[];
    } = {},
  ): Promise<StepResult> {
    return this.exclusive(async () => {
      try {
        return await this.submitApprovalInner(jws, extra);
      } finally {
        this.resuming = false;
      }
    });
  }

  private async submitApprovalInner(
    jws: string,
    extra: { evidence?: readonly EvidenceItem[] } = {},
  ): Promise<StepResult> {
    const v = await verifyApproval(jws, {
      trust: this.trust,
      actor: this.identity.actor,
      limits: this.limits,
      at: this.now(),
    });
    this.record(v.verification);
    if (!v.ok) {
      this.persist();
      return this.result("rejected", { reason: "approval-denied", detail: v.reason, outbound: [] });
    }
    const a = v.approval;
    if (this.state.usedApprovals[a.id])
      return this.result("rejected", {
        reason: "approval-denied",
        detail: "approval already used",
        outbound: [],
      });
    const waiting = this.state.pending[a.actionDigest];
    if (!waiting)
      return this.result("rejected", {
        reason: "approval-denied",
        detail: "no action is waiting with this digest",
        outbound: [],
      });
    if (waiting && a.conversation !== waiting.conversation)
      return this.result("rejected", {
        reason: "approval-denied",
        detail: "approval names another conversation",
        outbound: [],
      });
    if (waiting.intent.action === "pay") {
      const expected = this.paymentApprovalBinding(a.actionDigest);
      if (
        !expected ||
        a.payment?.termsDigest !== expected.termsDigest ||
        a.payment?.orderDigest !== expected.orderDigest
      )
        return this.result("rejected", {
          reason: "approval-denied",
          detail: "Payment approval must cover the agreed terms and exact order.",
          outbound: [],
        });
    }
    this.state.approvals[a.actionDigest] = {
      id: a.id,
      decision: a.decision,
      validUntil: a.validUntil,
      jws,
      ...(a.payment ? { payment: a.payment } : {}),
      ...(this.state.pending[a.actionDigest]?.releaseBinding
        ? { releaseBinding: copyData(this.state.pending[a.actionDigest]!.releaseBinding) }
        : {}),
    };
    const proofDigest = digestOf(jws);
    this.state.auditApprovalProofs[proofDigest] = jws;
    this.record({
      type: "approval",
      id: a.id,
      actionDigest: a.actionDigest,
      decision: a.decision,
      issuer: a.issuer,
      proofDigest,
      at: this.now(),
    });
    const pending = this.state.pending[a.actionDigest];
    this.outbound.principal(
      a.note ?? (a.decision === "approve" ? "Yes, go ahead." : "No."),
      `${a.decision === "approve" ? "Approves" : "Declines"} by signing an answer bound to the exact action${
        pending ? "" : " (no action is waiting with that digest, so nothing is released)"
      }${
        extra.evidence && extra.evidence.length > 0
          ? "; an attestation of the stronger approval goes with the request"
          : ""
      }.`,
      { actionDigest: a.actionDigest, decision: a.decision },
    );
    if (pending && extra.evidence && extra.evidence.length > 0) {
      const key = `_start:${pending.conversation}`;
      const plan = this.getDomain(key) as unknown as StartPlan | undefined;
      if (plan)
        this.setDomain(
          key,
          { ...plan, evidence: [...(plan.evidence ?? []), ...extra.evidence] } as unknown as Json,
          pending.conversation,
        );
    }
    if (!pending) {
      this.persist();
      return this.result("local", {
        detail: "approval stored; no pending action with that digest",
        outbound: [],
      });
    }
    return this.resumeApproved(pending, a);
  }

  private async resumeApproved(
    pending: PendingAction,
    a: { id: Iri; actionDigest: string; decision: "approve" | "deny" },
  ): Promise<StepResult> {
    delete this.state.pending[a.actionDigest];
    if (a.decision === "deny") this.outbound.declined(pending.intent);
    this.resuming = true;
    this.resumingDigest = a.actionDigest;
    const cont = pending.continuation as unknown as Continuation;
    if (a.decision === "approve" && cont.type !== "release-message") {
      const carriedIntent =
        cont.type === "reply" && "intent" in cont.reply
          ? cont.reply.intent
          : cont.type === "message" || cont.type === "effect"
            ? cont.plan.intent
            : pending.intent;
      if (
        !carriedIntent ||
        actionDigest(pending.intent) !== a.actionDigest ||
        actionDigest(carriedIntent) !== a.actionDigest
      )
        return this.result("rejected", { reason: "approval-mismatch", outbound: [] });
    }
    const task = this.state.tasks[pending.conversation];
    if (task && cont.type === "effect") {
      let outbound: OutboundMessage[] = [];
      if (a.decision === "deny") {
        const effect = this.state.effects[cont.plan.key];
        if (effect)
          outbound = await this.conclude(
            effect,
            { conclusion: "not-executed", reason: "owner declined" },
            "direct-response",
          );
        this.state.tasks[task.id] = {
          ...(this.state.tasks[task.id] as TaskState),
          status: "denied",
          updatedAt: this.now(),
        };
      } else {
        this.state.tasks[task.id] = { ...task, status: "running", updatedAt: this.now() };
        outbound = await this.runEffect(task.id, cont.plan, task.id);
      }
      this.persist();
      return this.result("accepted", { outbound });
    }
    const conv = this.state.conversations[pending.conversation];
    if (!conv || isTerminal(conv.phase)) {
      this.persist();
      return this.result("local", {
        detail: "conversation closed; approval not used",
        outbound: [],
      });
    }
    if (cont.type === "release-message") {
      let prepared: import("../wire/attachments.js").AttachmentDocument;
      try {
        prepared = cont.document
          ? await readHeldMessagePacket(cont.document, nativeDocumentLimits(this.limits))
          : await writeAttachmentDocument(MessageNode.toNode(cont.message), {
              limits: nativeDocumentLimits(this.limits),
            });
      } catch {
        this.persist();
        return this.result("rejected", {
          reason: "approval-denied",
          detail: "held document is no longer intact",
          outbound: [],
        });
      }
      const root = cont.document
        ? String(prepared.document.id ?? prepared.document["@id"])
        : cont.message.id;
      const message = new MessageNode(root, prepared.dataset).live;
      const config = configurationById(message.configuration);
      const suite =
        config?.integrity.status === "selected" && config.integrity.mechanism === "data-integrity"
          ? "data-integrity"
          : "jws";
      const resumedDigest = await documentDigest(prepared.document, suite);
      if (
        resumedDigest !== pending.intent.parameters.messageDigest ||
        actionDigest(pending.intent) !== a.actionDigest
      ) {
        this.persist();
        return this.result("rejected", {
          reason: "approval-denied",
          detail: "held message does not match the approved digest",
          outbound: [],
        });
      }
      if (a.decision === "deny") {
        this.state.usedApprovals[a.id] = true;
        this.persist();
        return this.result("local", { reason: "approval-denied", outbound: [] });
      }
      if (Date.parse(message.expiresAt) <= Date.parse(this.now())) {
        this.persist();
        return this.result("rejected", { reason: "expired", outbound: [] });
      }
      // Brief 31 §2.1: an undecided use of the principal's own statement has no mandate rule
      // to permit it; the digest-bound approval is its only basis, so the mandate is not
      // re-evaluated as a grant. It must still be current and not withdrawn, and the resumed
      // gate run below re-checks it for a prohibition.
      const mandate = this.mandate;
      const at = Date.parse(this.now());
      const permitted =
        cont.undecidedUse === true
          ? !!mandate &&
            !this.mandateFailure &&
            !this.isRevoked(mandate) &&
            Date.parse(mandate.mandate.validFrom) <= at &&
            Date.parse(mandate.mandate.validUntil) > at
          : this.authorise(pending.intent, true).outcome === "permit";
      if (!permitted) {
        this.persist();
        return this.result("rejected", {
          reason: "not-authorised",
          detail: "the current mandate no longer permits this release",
          outbound: [],
        });
      }
      const out = await this.emit(conv.id, message.kind, message.body, {
        resume: message,
        ...(cont.document ? { resumePacket: cont.document } : {}),
        approved: true,
        ...(cont.intent ? { intent: cont.intent } : {}),
        ...(cont.force ? { force: true } : {}),
        ...(cont.conditions ? { conditions: cont.conditions } : {}),
      });
      this.state.usedApprovals[a.id] = true;
      if (message.kind === "receipt")
        for (const [key, effect] of Object.entries(this.state.effects)) {
          if (effect.activity === message.body.activity)
            this.state.effects[key] = { ...effect, receiptSent: true };
        }
      this.persist();
      const rest = cont.after
        ? await this.executeAgreementPlan(conv.id, cont.after.plan, cont.after.agreement)
        : undefined;
      this.persist();
      return this.result("accepted", {
        conversation: conv.id,
        outbound: [out, ...(rest?.outbound ?? [])],
      });
    }
    const resumed = this.apply(conv, { type: "approval-resolved", at: this.now() });
    let outbound: OutboundMessage[] = [];
    if (cont.type === "reply") {
      const handler = resumed.operation
        ? this.handlers.get(operationKey(resumed.operation))
        : undefined;
      if (!handler) throw new Error("handler vanished");
      if (a.decision === "deny") {
        outbound = (
          await this.replyClose(
            resumed,
            { id: cont.inReplyTo } as AnyMessage,
            "refuse",
            "approval-denied",
            "the represented party declined",
          )
        ).outbound;
      } else {
        const r = await this.applyReply(
          resumed,
          { id: cont.inReplyTo } as AnyMessage,
          cont.reply,
          handler,
          cont.operation,
        );
        outbound = r.outbound;
      }
    } else if (cont.type === "propose" || cont.type === "invoke") {
      if (a.decision === "deny") this.closeLocally(resumed, "refused", "owner declined");
      else outbound = (await this.continueStart(resumed.id)).messages;
    } else if (cont.type === "message") {
      if (a.decision !== "deny") outbound = await this.performPlanMessage(resumed.id, cont.plan);
    } else if (cont.type === "effect") {
      const effect = this.state.effects[cont.plan.key];
      if (a.decision === "deny") {
        if (effect)
          outbound = await this.conclude(
            effect,
            { conclusion: "not-executed", reason: "owner declined" },
            "direct-response",
          );
      } else {
        outbound = await this.runEffect(
          resumed.id,
          cont.plan,
          cont.basis ?? resumed.agreement ?? resumed.id,
        );
      }
    }
    this.persist();
    const after = this.state.conversations[resumed.id];
    return this.result("accepted", {
      conversation: resumed.id,
      ...(after ? { phase: after.phase } : {}),
      outbound,
    });
  }

  // ---------------------------------------------------------------- representation

  private async checkRepresentation(
    conv: ConversationState,
    msg: AnyMessage,
    handler: OperationHandler,
  ): Promise<RepresentationAssessment | undefined> {
    const kid = this.kidOf(msg);
    return this.admission
      ? this.admission.authority(conv, msg, handler, kid)
      : this.inbound.checkRepresentation(conv, msg, handler, kid);
  }

  /** The pinned key that signed the message currently being processed. */
  private kidOf(msg: AnyMessage): string | undefined {
    return this.current?.id === msg.id ? this.current.kid : undefined;
  }

  private current: { id: Iri; kid?: string } | undefined;

  // ---------------------------------------------------------------- emit

  private ownEvidence(): EvidenceItem[] {
    if (this.options.authorityChainJws)
      return [
        {
          role: "representation",
          format: "mandate-chain+jws",
          value: this.options.authorityChainJws,
        },
      ];
    if (this.options.gates?.organizations)
      return this.options.organizationMandateJws
        ? [
            {
              role: "representation",
              format: "organization-mandate+jws",
              value: this.options.organizationMandateJws,
            },
          ]
        : [];
    return this.options.representationJws
      ? [{ role: "representation", format: "jws-compact", value: this.options.representationJws }]
      : [];
  }

  private async emit<K extends MessageKind>(
    conversationId: Iri,
    kind: K,
    /** Validated against the message schema before signing. */
    body: BodyByKind[K] | Record<string, unknown>,
    opts: {
      id?: Iri;
      inReplyTo?: Iri;
      evidence?: readonly EvidenceItem[];
      content?: readonly import("../core/types.js").ContentPart[];
      configuration?: string;
      force?: boolean;
      /** The action authorised for this message; re-authorised at provider transmission. */
      intent?: ActionIntent;
      /** Authorisation basis of a protected disclosure; re-checked at every transmission. */
      conditions?: readonly DisclosureCondition[];
      resume?: AnyMessage;
      resumePacket?: MessagePacket;
      approved?: boolean;
    },
  ): Promise<OutboundMessage> {
    const proposedTerms =
      kind === "propose" ? ((body as JsonObject).terms as JsonObject | undefined) : undefined;
    if (
      proposedTerms?.duties !== undefined &&
      !dutyRuleSchema.array().safeParse(proposedTerms.duties).success
    ) {
      const intent = opts.intent ?? {
        action: "use",
        operation: "urn:op:agreement",
        conversation: conversationId,
        target: "urn:op:agreement",
        parameters: {},
      };
      for (const verdict of this.outbound.rejectEffect(intent, "unsupported-term"))
        this.record(verdict);
      throw new MessageReleaseError(
        this.result("rejected", {
          conversation: conversationId,
          reason: "unsupported-term",
          outbound: [],
        }),
      );
    }
    const conv = this.mustConversation(conversationId);
    const configuration = opts.configuration ?? conv.configuration;
    if (!configuration) throw new Error("no configuration selected");
    this.carriage = configuration;
    const cfg = configurationById(configuration);
    if (cfg?.integrity.status !== "selected")
      throw new Error(`configuration ${configuration} is not executable`);
    const at = this.clock();
    const lifetime = Math.min(
      this.options.messageLifetimeMs ?? DEFAULT_LIFETIME_MS,
      this.limits.maxMessageLifetimeMs,
    );
    const anonymousRequester =
      cfg.requesterAuthentication === "not-applicable" && conv.role === "initiator";
    const operation =
      (body as { operation?: OperationRef }).operation ??
      conv.operation ??
      (this.getDomain(`_start:${conv.id}`) as unknown as StartPlan | undefined)?.operation;
    const content: ContentProfile | undefined =
      (operation ? this.contentProfiles.get(operationKey(operation)) : undefined) ??
      (kind === "description"
        ? {
            vocabulary: Object.assign(
              {},
              ...[...this.contentProfiles.values()].map((p) => p.vocabulary),
            ),
            identifiers: [...this.contentProfiles.values()].flatMap((p) => p.identifiers ?? []),
          }
        : undefined);
    const vocabulary: Record<string, import("../profile/content.js").ContentType> = {
      ...content?.vocabulary,
      ...this.options.gates?.vocabulary,
    };
    const known = {
      identifiers: this.gateMemory.knownIdentifiers(
        this.options.gates?.taskId ?? conv.id,
        conv.id,
        { gate: this.options.gates, content },
      ),
      terms: new Set(this.trust.data.keys.map((key) => key.kid)),
    };
    if (kind === "description") Object.assign(vocabulary, this.protocolVocabulary);
    for (const [path, term] of Object.entries(content?.protectedTerms ?? {})) {
      // A protected position cannot fall back to another known term when verification fails.
      vocabulary[path] = { type: "term", values: [] };
      const value = path
        .split(".")
        .reduce<unknown>(
          (item, key) =>
            item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined,
          body,
        );
      if (typeof value !== "string") continue;
      const check = await verifyStatement(value, {
        ...term,
        trust: this.trust,
        limits: this.limits,
        verifier: this.identity.actor,
        at: this.now(),
      });
      this.record(check.verification);
      if (check.payload && !dataClaims(check.payload, term.vocabulary, "", known).unknown) {
        vocabulary[path] = { type: "term", values: [value] };
        known.terms.add(value);
      }
    }
    let references: ReturnType<typeof referencesIn>;
    try {
      references = referencesIn(body);
    } catch {
      this.outbound.stopEvidence(conversationId);
      throw new MessageReleaseError(
        this.result("rejected", { reason: "evidence-invalid", outbound: [] }),
      );
    }
    for (const { reference, path } of references) {
      const checked = await verifyResourceGrant(
        reference.grant,
        this.trust,
        this.now(),
        this.identity.actor,
      );
      this.record(checked.verification);
      const grant = checked.payload;
      if (
        !grant ||
        grant.ref !== reference.ref ||
        grant.reader.actor !== conv.peer.actor ||
        grant.reader.party !== conv.peer.party ||
        grant.purpose !== (opts.intent?.purpose ?? this.purposeOf(conv.id)) ||
        Date.parse(grant.validUntil) <= Date.parse(this.now()) ||
        digestOf([...new Set(reference.claimTypes)].sort()) !==
          digestOf([...new Set(grant.items.map((i) => i.claimType))].sort()) ||
        (reference.digest && reference.digest !== grant.digest)
      ) {
        this.outbound.stopEvidence(conversationId);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "evidence-invalid", outbound: [] }),
        );
      }
      if (
        this.options.gates?.referenceAction &&
        (!opts.intent ||
          opts.intent.action !== this.options.gates.referenceAction ||
          opts.intent.operation !== operation?.id)
      ) {
        this.outbound.stopEvidence(conversationId);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "evidence-invalid", outbound: [] }),
        );
      }
      if (
        opts.intent &&
        ((this.options.gates?.referenceAction &&
          opts.intent.parameters.grantDigest !== digestBytes(reference.grant)) ||
          opts.intent.parameters.resource !== grant.ref ||
          !Array.isArray(opts.intent.parameters.items) ||
          digestOf(opts.intent.parameters.items) !== digestOf(grant.items.map((i) => i.id)))
      ) {
        this.outbound.stopEvidence(conversationId);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "evidence-invalid", outbound: [] }),
        );
      }
      vocabulary[`${path}.grant`] = { type: "term", values: [reference.grant] };
      vocabulary[`${path}.ref`] = { type: "identifier" };
      known.identifiers.add(reference.ref);
      reference.claimTypes.forEach((claimType, index) => {
        vocabulary[`${path}.claimTypes.${index}`] = {
          type: "code",
          values: [claimType],
          claimType,
        };
      });
      if (reference.digest)
        vocabulary[`${path}.digest`] = { type: "code", values: [reference.digest] };
    }
    if (kind === "propose" && proposedTerms?.compensation) {
      const offer = await readPaymentOffer(proposedTerms);
      this.paymentOffers.set(String((body as JsonObject).termsDigest), offer);
      const classifyOffer = (value: unknown, path: string): void => {
        if (Array.isArray(value)) {
          value.forEach((v, i) => {
            classifyOffer(v, `${path}.${i}`);
          });
          return;
        }
        if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) classifyOffer(child, `${path}.${key}`);
          return;
        }
        if (typeof value === "string") {
          vocabulary[path] = { type: "term", values: [value] };
          known.terms.add(value);
        }
      };
      classifyOffer(proposedTerms.payment, "terms.payment");
    }
    if (!opts.resume && opts.intent?.action === "pay" && kind === "invoke") {
      let document: unknown;
      try {
        document = await this.outbound.paymentOrder(opts.intent);
      } catch (error) {
        if (error instanceof SettlementError)
          throw new MessageReleaseError(
            this.result("rejected", { reason: error.reason, outbound: [] }),
          );
        throw error;
      }
      body = { ...body, input: document };
      const classify = (value: unknown, path: string): void => {
        if (Array.isArray(value)) {
          value.forEach((v, i) => {
            classify(v, `${path}.${i}`);
          });
          return;
        }
        if (value && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) classify(child, `${path}.${key}`);
          return;
        }
        if (typeof value === "string") {
          vocabulary[path] = { type: "term", values: [value] };
          known.terms.add(value);
        } else if (typeof value === "number")
          vocabulary[path] = { type: "number", values: [value] };
      };
      classify(document, "input");
    }
    const supplementaryEvidence = [
      ...(opts.evidence ?? []),
      ...(this.options.gates?.supplementaryEvidence ?? []),
    ];
    const free = freeStrings(body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }, known);
    let message =
      opts.resume ??
      ({
        profile: PILOT_PROFILE,
        configuration,
        id: opts.id ? this.registerIdentifier(opts.id) : this.newId(),
        conversation: conversationId,
        kind,
        from: anonymousRequester ? {} : this.selfRef(),
        ...(conv.peer.actor
          ? {
              to: {
                actor: conv.peer.actor,
                ...(conv.peer.party ? { party: conv.peer.party } : {}),
              },
            }
          : {}),
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + lifetime).toISOString(),
        ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
        body: copyData(body),
        ...(opts.content ? { content: copyData(opts.content) } : {}),
        ...(free.length > 0 && this.identity.party
          ? { authorship: { method: "model-output", onBehalfOf: this.identity.party } }
          : {}),
        ...(supplementaryEvidence.length > 0 ? { evidence: copyData(supplementaryEvidence) } : {}),
      } as unknown as AnyMessage);
    if (
      !opts.resume &&
      this.identity.party &&
      freeMessageStrings(message, vocabulary, known).length > 0
    ) {
      message = {
        ...message,
        authorship: { method: "model-output", onBehalfOf: this.identity.party },
      };
    }
    if (opts.intent && this.standingAccess(opts.intent)?.ok) {
      const output = message.kind === "deliver" ? message.body.output : undefined;
      const items = output?.items;
      if (
        !output ||
        Object.keys(output).some((key) => key !== "items") ||
        !items ||
        typeof items !== "object" ||
        Array.isArray(items) ||
        digestOf(Object.keys(items).sort()) !==
          digestOf((opts.intent.parameters.items as string[]).toSorted())
      ) {
        this.outbound.stopDisclosure(message.id);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "excessive-scope", outbound: [] }),
        );
      }
    }
    // Resumed native views already passed full wire/shape admission. Zod's record
    // projection is only the construction boundary for a core's object proposal.
    if (!(message instanceof MessageNode)) {
      const checked = validateMessage(message);
      if (!checked.ok) throw new Error(`internal: outbound ${kind} invalid: ${checked.detail}`);
    }
    const pod = this.options.gates?.accessPod;
    for (const evidence of message.evidence ?? []) {
      if (pod && isAccessPointer(evidence)) {
        this.outbound.stopDisclosure(message.id);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "excessive-scope", outbound: [] }),
        );
      }
      if (!isClaimEvidence(evidence)) continue;
      const checkedEvidence = await this.inbound.assessClaim(evidence, this.identity.party);
      if (
        !checkedEvidence.claim ||
        checkedEvidence.reason === "evidence-invalid" ||
        checkedEvidence.reason === "unknown-key"
      ) {
        this.outbound.stopEvidence(message.id);
        throw new MessageReleaseError(
          this.result("rejected", {
            reason: "evidence-invalid",
            conversation: conv.id,
            outbound: [],
          }),
        );
      }
      if (
        pod?.actor === this.identity.actor &&
        kind === "deliver" &&
        pod.stored(String(checkedEvidence.claim.id)) &&
        opts.intent?.parameters.access === undefined
      ) {
        this.outbound.stopDisclosure(message.id);
        throw new MessageReleaseError(
          this.result("rejected", { reason: "excessive-scope", outbound: [] }),
        );
      }
    }
    for (const evidence of message.evidence ?? []) {
      if (!isClaimEvidence(evidence)) continue;
      const claim = unverifiedEvidenceClaim(evidence);
      if (claim.claimType !== "joint.message") continue;
      const parsed = jointPayloadSchema.safeParse(claim.value);
      let ok = parsed.success,
        partyAtFault: string | undefined;
      let backendFailure: JsonObject = {};
      if (parsed.success && "outcome" in parsed.data) {
        const fixed = (
          this.state.domain.fixedJointSessions as unknown as Record<string, FixedJointSession>
        )[parsed.data.sessionId];
        const protocol = fixed && this.options.gates?.jointProtocols?.get(fixed.method);
        const entry =
          fixed &&
          this.options.gates?.acceptedJoint?.find(
            (a) =>
              a.rule === fixed.rule &&
              a.method === fixed.method &&
              a.purposes.includes(fixed.purpose),
          );
        ok = !!fixed && !!protocol && !!entry;
        if (fixed && protocol && entry) {
          try {
            const checked = await protocol.verifyOutcome({
              session: fixed.session,
              outcome: parsed.data.outcome,
              contributions: parsed.data.contributions,
            });
            const suppressed = ["below-minimum-group", "too-few-contributors"].includes(
              parsed.data.outcome.type,
            );
            ok =
              checked.ok &&
              (suppressed ||
                contributorUpperBound(fixed, checked.contributors) >= entry.minimumContributors);
            if (!checked.ok) {
              partyAtFault = checked.partyAtFault;
              backendFailure = {
                reason: checked.reason,
                check: checked.check ?? "unknown",
                index: checked.index ?? null,
              };
            }
          } catch {
            ok = false;
          }
        }
      }
      if (!ok) {
        this.outbound.checkDerivationRelease({
          subject: message.id,
          purpose: opts.intent?.purpose ?? this.purposeOf(conv.id) ?? "",
          recipient: conv.peer.party ?? "",
          inputs: [],
          way: "joint outcome",
          evidenceOk: false,
          ...(partyAtFault ? { partyAtFault } : {}),
          record: { ...claim, ...backendFailure },
        });
        throw new MessageReleaseError(
          this.result("rejected", {
            reason: "derivation-not-verified",
            conversation: conv.id,
            outbound: [],
          }),
        );
      }
      this.record({
        type: "joint-message-evidence",
        message: message.id,
        statement: claim,
        verified: true,
      });
    }
    for (const part of message.content ?? []) {
      const binding = [...this.gateMemory.facts.values()].find(
        (f) => f.statement?.contentDigest === part.digest,
      );
      const intact = digestContent(part.bytes) === part.digest;
      if (
        !intact ||
        !binding ||
        !(message.evidence ?? []).some((e) => {
          try {
            return digestOf(decodeCompactPayload(e.value)) === binding.digest;
          } catch {
            return false;
          }
        })
      ) {
        const reason =
          intact &&
          !binding &&
          opts.intent &&
          this.outbound.needsStructuredClaim(opts.intent, content)
            ? "structured-form-required"
            : "evidence-invalid";
        this.outbound.stopEvidence(message.id, reason);
        throw new MessageReleaseError(this.result("rejected", { reason, outbound: [] }));
      }
    }
    let credentialMessage: MessageNode | undefined;
    if (!opts.resumePacket && this.options.gates?.agreementCredential) {
      const credentialKey = this.keysByAlg.get("EdDSA");
      if (!credentialKey) throw new Error("The agreement credential needs an Ed25519 actor key.");
      credentialMessage = agreementMessageNode(message)!;
      const credential = await this.options.gates.agreementCredential.offer(
        credentialMessage,
        credentialKey,
      );
      if (credential)
        credentialMessage.evidence = [...(credentialMessage.evidence ?? []), credential];
      message = credentialMessage.live;
    }
    if (this.options.gates?.agreementCredential) {
      credentialMessage ??= agreementMessageNode(message)!;
      const offered =
        message.kind === "accept"
          ? agreementMessageNode(this.retainedMessageViews.get(message.body.proposal))
          : undefined;
      if (!(await this.outbound.checkAgreementCredential(credentialMessage, offered, this.trust)))
        throw new MessageReleaseError(
          this.result("rejected", { reason: "evidence-invalid", outbound: [] }),
        );
    }
    let prepared = opts.resumePacket
      ? await readHeldMessagePacket(opts.resumePacket, nativeDocumentLimits(this.limits))
      : await writeAttachmentDocument(credentialMessage ?? MessageNode.toNode(message), {
          limits: nativeDocumentLimits(this.limits),
        });
    message = new MessageNode(message.id, prepared.dataset).live;
    const suite = cfg.integrity.mechanism === "data-integrity" ? "data-integrity" : "jws";
    const ownerApproval = opts.intent ? this.state.approvals[actionDigest(opts.intent)] : undefined;
    const approvals = opts.intent
      ? [
          ...(ownerApproval?.decision === "approve" ? [ownerApproval] : []),
          ...(this.state.organisationApprovals[actionDigest(opts.intent)] ?? []),
        ]
      : [];
    const approval = approvals.find((a) => a.releaseBinding);
    let approvalBindingRecord: object | undefined;
    if (opts.intent && approvals.length && !approval)
      throw new MessageReleaseError(
        this.result("rejected", { reason: "approval-mismatch", outbound: [] }),
      );
    if (opts.intent && approval?.releaseBinding) {
      const offerId = message.kind === "accept" ? message.body.proposal : undefined;
      const basis = (message.body as { basis?: { agreement?: string } }).basis;
      const terms = offerId
        ? this.getDomain(`_offer:${offerId}`)
        : basis?.agreement
          ? this.state.agreements[basis.agreement]?.terms
          : undefined;
      let paymentMatches: boolean | undefined;
      if (opts.intent.action === "pay" && message.kind === "invoke") {
        try {
          const objects =
            this.options.settlement?.id !== "rdf-order" && this.options.settlement
              ? readCarried(message.body.input, this.options.settlement)
              : await readPaymentObjects(message.body.input);
          const facts = this.options.settlement
            ? this.options.settlement.lift(objects)
            : liftPaymentObjects(objects);
          paymentMatches =
            paymentDigest(facts) ===
            paymentDigest(
              PaymentFacts.fromIntent(
                opts.intent,
                this.identity.party ?? this.identity.actor,
                this.now(),
              ),
            );
        } catch {
          paymentMatches = false;
        }
      }
      const matches = checkApprovalRelease({
        message: new MessageNode(message.id, prepared.dataset),
        intent: ActionIntentNode.toNode(opts.intent),
        binding: approval.releaseBinding,
        ...(terms ? { termsDigest: digestOf(terms) } : {}),
        ...(paymentMatches === undefined ? {} : { paymentMatches }),
        sink: this.options.gates?.sink,
      });
      if (!matches)
        throw new MessageReleaseError(
          this.result("rejected", { reason: "approval-mismatch", outbound: [] }),
        );
      approvalBindingRecord = {
        type: "approval-message-binding",
        approval: approval.id,
        approvals: approvals.map((a) => a.id),
        intentDigest: actionDigest(opts.intent),
        termsDigest: approval.releaseBinding.termsDigest ?? null,
        message: message.id,
        messageDigest: await documentDigest(prepared.document, suite),
        at: this.now(),
      };
    }
    const release = this.outbound.checkMessage(message, {
      documentDigest: await documentDigest(prepared.document, suite),
      content: { ...content, vocabulary },
      knownTerms: known.terms,
      ...(opts.intent ? { intent: opts.intent } : {}),
      ...(this.operationOf(conv) ? { operation: this.operationOf(conv) } : {}),
      ...(opts.approved ? { approved: true } : {}),
    });
    if (release.outcome !== "go") {
      const pending =
        release.outcome === "ask-principal"
          ? this.park(conv.id, release.intent, {
              type: "release-message",
              ...(release.undecidedUse ? { undecidedUse: true } : {}),
              message,
              document: {
                format: "awp-jsonld/0.1",
                jsonld: JSON.stringify(prepared.document),
                attachments: prepared.attachments,
              },
              ...(opts.intent ? { intent: opts.intent } : {}),
              ...(opts.force ? { force: true } : {}),
              ...(opts.conditions ? { conditions: opts.conditions } : {}),
            })
          : undefined;
      this.record({
        type: "message-held",
        conversation: conv.id,
        digest: release.digest,
        reason: release.reason,
        at: this.now(),
      });
      throw new MessageReleaseError(
        this.result(pending ? "pending-approval" : "rejected", {
          conversation: conv.id,
          reason: release.reason,
          outbound: [],
          ...(pending ? { pendingApproval: pending } : {}),
        }),
      );
    }
    const recipientIdentityFailure = await this.outbound.webIdRecipient(
      conv.peer.actor,
      message.configuration,
      message.id,
    );
    if (recipientIdentityFailure)
      throw new MessageReleaseError(
        this.result("rejected", { reason: recipientIdentityFailure, outbound: [] }),
      );
    // Brief 26b seam: gate-owned evidence readiness before any conversation transition or outbox release.
    if (!(await this.outbound.ensureRecord(message.id)))
      throw new MessageReleaseError(
        this.result("rejected", { reason: "record-unavailable", outbound: [] }),
      );
    const signing = cfg.integrity;
    let announceReference: (() => void) | undefined;
    let recordApprovalConsumption: (() => void) | undefined;
    const prepareRelease = async (pointers?: ReadonlyMap<string, EvidenceItem>) => {
      if (pointers) {
        let count = 0;
        const evidence = (message.evidence ?? []).map((item) => {
          if (!isClaimEvidence(item)) return item;
          const id = String(unverifiedEvidenceClaim(item).id);
          const pointer = pointers.get(id);
          if (!pointer) return item;
          if (digestBytes(item.value) !== this.options.gates?.accessPod?.stored(id)?.digest)
            throw new Error("The protected item differs from the stored statement");
          count++;
          return pointer;
        });
        if (count !== pointers.size || evidence.filter(isAccessPointer).length !== pointers.size)
          throw new Error("The delivery does not match the checked grants");
        message = { ...copyData(message), evidence: copyData(evidence) };
        prepared = await writeAttachmentDocument(MessageNode.toNode(message), {
          limits: nativeDocumentLimits(this.limits),
        });
        message = new MessageNode(message.id, prepared.dataset).live;
        if (approvalBindingRecord)
          approvalBindingRecord = {
            ...approvalBindingRecord,
            messageDigest: await documentDigest(prepared.document, suite),
          };
      }
      if (!pointers && opts.intent?.purpose)
        this.setDomain(`_purpose:${conv.id}`, opts.intent.purpose, conv.id);
      let nextConversation: ConversationState | undefined;
      if (!opts.force || !isTerminal(conv.phase)) {
        const next = transition(
          conv,
          {
            type: "message",
            direction: "out",
            message,
            at: message.createdAt,
            agreementDelivery: conv.operation
              ? this.handlers.get(operationKey(conv.operation))?.agreementDelivery
              : undefined,
          },
          this.limits,
        );
        if (!next.ok) {
          if (next.reason === "round-limit") {
            this.outbound.stopLimit(message.id, "round-limit");
            throw new MessageReleaseError(
              this.result("rejected", {
                reason: "round-limit",
                conversation: conv.id,
                outbound: [],
              }),
            );
          }
          if (!opts.force)
            throw new Error(`internal: outbound ${kind} violates state machine: ${next.detail}`);
        } else if (pointers) nextConversation = next.state;
        else this.saveConversation(next.state);
      }
      let wire: WireMessage;
      if (anonymousRequester) {
        if (!cfg.unsignedRequestKinds.includes(kind))
          throw new Error(`internal: anonymous requester cannot send ${kind}`);
        wire = {
          format: "awp-jsonld/0.1",
          jsonld: JSON.stringify(prepared.document),
          attachments: prepared.attachments,
        };
      } else {
        if (signing.status !== "selected") throw new Error("No selected message signature");
        const key = this.keysByAlg.get(signing.alg);
        if (!key) throw new Error(`no actor key for ${signing.alg}`);
        const signed = await signDocument(prepared.document, {
          suite,
          key,
          verificationMethod: "urn:awp:key:" + key.kid,
          created: message.createdAt,
          limits: nativeDocumentLimits(this.limits),
        });
        wire = {
          format: "awp-jsonld/0.1",
          jsonld: JSON.stringify(signed),
          attachments: prepared.attachments,
        };
      }
      if (isMessagePacket(wire)) {
        const read = await readAttachmentDocument(wire.jsonld, wire.attachments, {
          suite,
          limits: nativeDocumentLimits(this.limits),
        });
        if (!read.ok) throw new Error(`internal: signed document refused: ${read.detail}`);
        await rememberMessagePacket(wire, new MessageNode(read.root, read.dataset));
      }
      if (kind === "propose")
        this.setDomain(`_offer:${message.id}`, (body as JsonObject).terms as Json, conversationId);
      const entry: OutboxEntry = {
        id: message.id,
        conversation: conversationId,
        kind,
        ...(conv.peer.actor ? { toActor: conv.peer.actor } : {}),
        wire,
        message: copyData(message),
        createdAt: message.createdAt,
        ...(opts.intent ? { intent: opts.intent } : {}),
        ...(opts.conditions ? { conditions: opts.conditions } : {}),
      };
      const deliveryRecord = {
        id: message.id,
        kind,
        conversation: conversationId,
        digest: digestOf(message),
        at: message.createdAt,
        // Bind the approved scope to this exact release without adding a separate ledger event.
        ...(approvalBindingRecord ? { approvalBinding: approvalBindingRecord } : {}),
        // The payload-free authorisation basis of a protected disclosure (kind + reference).
        ...(opts.conditions ? { conditions: opts.conditions } : {}),
      };
      if (pointers) {
        this.record({ type: "message-release-intended", ...deliveryRecord });
        if (!(await this.outbound.ensureRecord(message.id)))
          throw new Error("The reference delivery record is unavailable");
      } else this.record({ type: "message-out", ...deliveryRecord });
      // Evidence and the write-ahead record must succeed before the outbox can expose it.
      const announce = this.outbound.seal(message, wire, {
        vocabulary,
        known,
        ...(opts.intent ? { intent: opts.intent } : {}),
        ...(this.operationOf(conv) ? { operation: this.operationOf(conv) as Iri } : {}),
      });
      if (pointers) {
        this.record({
          type: "message-release-sealed",
          ...deliveryRecord,
          wireDigest: digestOf(wire),
        });
        announceReference = () => {
          this.record({ type: "message-out", ...deliveryRecord });
          announce(() => recordApprovalConsumption?.());
        };
      } else announce();
      this.gateMemory.rememberIdentifiers(message.conversation, message);
      if (opts.intent) {
        const standing = this.standingAccess(opts.intent);
        if (standing?.ok)
          for (const duty of standing.rule.duties)
            for (const recipient of duty.notify) {
              const id = digestOf({ use: message.id, rule: standing.rule.id, recipient });
              if (!this.state.notificationDuties[id]) {
                this.state.notificationDuties[id] = {
                  id,
                  rule: standing.rule.id,
                  use: message.id,
                  recipient,
                  due: new Date(Date.parse(this.now()) + 3600000).toISOString(),
                  status: "pending",
                };
                this.record({
                  type: "duty-created",
                  ...this.state.notificationDuties[id],
                  at: this.now(),
                });
              }
            }
      }
      if (isMessagePacket(wire))
        this.state.recordMessages[message.id] = {
          direction: "out",
          conversation: message.conversation,
          digest: digestOf(message),
          jws: encodeMessageProof(wire),
        };
      this.retainedMessageViews.set(message.id, message);
      this.recordItemTransfer(message, conv, false);
      // Mirror the staged records before exposing the message to carriage.
      if (!(await this.outbound.ensureRecord(message.id)))
        throw new MessageReleaseError(
          this.result("rejected", { reason: "record-unavailable", outbound: [] }),
        );
      if (pointers) {
        if (opts.intent?.purpose)
          this.setDomain(`_purpose:${conv.id}`, opts.intent.purpose, conv.id);
        if (nextConversation) this.saveConversation(nextConversation);
      }
      return entry;
    };

    const publish = (entry: OutboxEntry) => {
      this.state.outbox[message.id] = entry;
      // Associate the response with the inbound message being processed NOW, so any
      // mid-dispatch snapshot already links them (a replay then returns this response).
      const seen = this.current ? this.state.seen[this.current.id] : undefined;
      if (this.current && seen && !seen.responses.includes(message.id)) {
        this.state.seen[this.current.id] = { ...seen, responses: [...seen.responses, message.id] };
      }
      return this.outboundFromEntry(entry, message);
    };

    if (!pod || kind !== "deliver" || !opts.intent || opts.intent.parameters.access === undefined)
      return publish(await prepareRelease());

    const grants = copyData(this.outbound.accessGrants(opts.intent));
    let out: OutboundMessage;
    try {
      if (
        !grants?.length ||
        message.kind !== "deliver" ||
        message.body.basis.kind !== "agreement" ||
        grants.some(
          ({ pointer }) =>
            message.kind !== "deliver" ||
            message.body.basis.kind !== "agreement" ||
            pointer.agreement !== message.body.basis.agreement ||
            pointer.reader.actor !== message.to?.actor ||
            pointer.reader.party !== message.to?.party ||
            Date.parse(pointer.validUntil) <= Date.parse(this.now()),
        )
      )
        throw new Error("The delivery does not match the authorized pod grants");
      const entry = await pod.grantAndRelease(
        grants,
        actionDigest(opts.intent),
        (event) => this.record(event),
        prepareRelease,
        {
          prepare: (attempt) => {
            const id = attempt.grant.pointer.id;
            if (this.state.pendingPodGrants[id]) throw new Error("An earlier grant needs cleanup");
            this.state.pendingPodGrants[id] = attempt;
            this.persist(); // The rule and its cleanup are durable before the conditional PUT.
          },
          clear: (id) => {
            delete this.state.pendingPodGrants[id];
            this.persist();
          },
        },
      );
      const duties = grants.map((grant) =>
        this.dutyExecutor().add({
          kind: "withdraw-access",
          grant,
          source: grant.pointer.agreement,
          items: [grant.pointer.item.id],
          due: grant.pointer.validUntil,
        }),
      );
      out = publish(entry);
      const pendingPodGrants = { ...this.state.pendingPodGrants };
      const usedApprovals = { ...this.state.usedApprovals };
      for (const { pointer } of grants) delete this.state.pendingPodGrants[pointer.id];
      try {
        recordApprovalConsumption = this.markApprovalConsumed(opts.intent);
        this.persist(); // Publish the outbox, expiry duties and approval use in the same snapshot.
      } catch (error) {
        delete this.state.outbox[entry.id];
        const seen = this.current && this.state.seen[this.current.id];
        if (this.current && seen) {
          this.state.seen[this.current.id] = {
            ...seen,
            responses: seen.responses.filter((id) => id !== entry.id),
          };
        }
        for (const duty of duties) delete this.state.duties.work[duty.id];
        this.state.pendingPodGrants = pendingPodGrants;
        this.state.usedApprovals = usedApprovals;
        throw error;
      }
    } catch {
      this.saveConversation(conv);
      delete this.state.recordMessages[message.id];
      this.retainedMessageViews.delete(message.id);
      this.state.duties.transfers = this.state.duties.transfers.filter(
        (transfer) => transfer.message !== message.id,
      );
      this.record({ type: "message-release-aborted", id: message.id, reason: "execution-failed" });
      this.outbound.stopAccessRelease();
      throw new MessageReleaseError(
        this.result("rejected", {
          reason: "execution-failed",
          conversation: conv.id,
          outbound: [],
        }),
      );
    }
    announceReference?.();
    return out;
  }

  private purposeOf(id: Iri): Iri | undefined {
    const conv = this.state.conversations[id];
    const agreement = conv?.agreement ? this.state.agreements[conv.agreement] : undefined;
    const plan = this.getDomain(`_start:${id}`) as unknown as StartPlan | undefined;
    const purpose =
      agreement?.terms.purpose ??
      plan?.purpose ??
      plan?.terms?.purpose ??
      this.getDomain(`_purpose:${id}`);
    return typeof purpose === "string" ? purpose : undefined;
  }

  /** The operation a conversation is about (the start plan's, before the first proposal). */
  private operationOf(conv: ConversationState): Iri | undefined {
    if (conv.operation) return conv.operation.id;
    const plan = this.getDomain(`_start:${conv.id}`) as unknown as StartPlan | undefined;
    return plan?.operation.id;
  }

  private outboundFromEntry(entry: OutboxEntry, message?: AnyMessage): OutboundMessage {
    let msg = message ?? peekWire(entry.wire) ?? entry.message;
    if (!msg && isMessagePacket(entry.wire)) throw new Error("Missing retained document rendering");
    if (!msg) {
      const text =
        entry.wire.format === "awp-unsigned-json/0.1"
          ? entry.wire.payload
          : Buffer.from(
              (entry.wire as { jws: string }).jws.split(".")[1] ?? "",
              "base64url",
            ).toString("utf8");
      msg = decodeAdapterJson(text) as AnyMessage;
    }
    return {
      id: entry.id,
      conversation: entry.conversation,
      kind: entry.kind as MessageKind,
      ...(entry.toActor ? { toActor: entry.toActor } : {}),
      endpoints: entry.toActor ? this.trust.actorEndpoints(entry.toActor) : [],
      wire: entry.wire,
      message: copyData(msg!),
    };
  }

  private async replyClose(
    conv: ConversationState,
    msg: AnyMessage,
    kind: "refuse" | "unsupported" | "indeterminate",
    reason: ReasonCode,
    detail?: string,
  ) {
    this.admission?.refuse(reason, detail);
    this.record({
      type: "refusal",
      conversation: conv.id,
      kind,
      reason,
      ...(detail ? { detail } : {}),
      ref: msg.id,
      at: this.now(),
    });
    const local = { reason, ...(detail ? { detail } : {}) };
    if (isTerminal(conv.phase)) return { disposition: "accepted" as const, outbound: [], ...local };
    const current = this.mustConversation(conv.id);
    if (current.phase === "open" || current.phase === "discovering") {
      this.closeLocally(current, kind === "refuse" ? "refused" : kind, reason);
      return { disposition: "accepted" as const, outbound: [], ...local };
    }
    // Diagnostic prose stays local. A registry code is enough for a peer to act on.
    const out = await this.emit(conv.id, kind, { ref: msg.id, reason }, { inReplyTo: msg.id });
    return { disposition: "accepted" as const, outbound: [out], ...local };
  }

  private async replyClaimChallenge(
    conv: ConversationState,
    msg: AnyMessage,
    reason: ReasonCode,
    detail: string,
  ) {
    const out = await this.emit(
      conv.id,
      "challenge",
      {
        ref: msg.id,
        reason,
        detail,
        needs: {
          claim: detail,
          id: this.newId(),
          nonce: this.newId(),
          expiresAt: new Date(this.clock().getTime() + 5 * 60_000).toISOString(),
        },
      },
      { inReplyTo: msg.id },
    );
    return { disposition: "accepted" as const, outbound: [out], reason, detail };
  }

  /** Answer a request with a challenge: what more would let it be admitted (CORE-IN-8). */
  private async replyChallenge(
    conv: ConversationState,
    msg: AnyMessage,
    needs: { approval: Iri; label: string },
  ) {
    const reason = "assurance-insufficient" as const;
    const detail = `needs ${needs.label}`;
    const challenge = {
      ...needs,
      id: this.newId(),
      nonce: this.newId(),
      expiresAt: new Date(this.clock().getTime() + 5 * 60_000).toISOString(),
    };
    this.record({
      type: "challenge",
      conversation: conv.id,
      reason,
      approval: needs.approval,
      ref: msg.id,
      at: this.now(),
    });
    const out = await this.emit(
      conv.id,
      "challenge",
      { ref: msg.id, reason, detail, needs: challenge },
      { inReplyTo: msg.id },
    );
    return { disposition: "accepted" as const, outbound: [out], reason, detail };
  }

  private closeLocally(
    conv: ConversationState,
    phase: "refused" | "unsupported" | "indeterminate" | "failed",
    reason: string,
  ): void {
    this.saveConversation({ ...conv, phase, closedReason: reason, updatedAt: this.now() });
    this.record({ type: "closed-locally", conversation: conv.id, phase, reason, at: this.now() });
  }

  // ---------------------------------------------------------------- helpers

  private coreEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
    return items.filter((item) => {
      if (this.options.gates?.accessPod && isAccessPointer(item)) return false;
      if (!isClaimEvidence(item)) return true;
      try {
        const claim = unverifiedEvidenceClaim(item);
        return this.gateMemory.facts.get(String(claim.id))?.digest === digestOf(claim);
      } catch {
        return false;
      }
    });
  }

  /**
   * What the gate tells a handler about evidence it did not admit: whether the signature
   * verified, the labels of a statement whose signature did, and the gate's reason. The
   * claim's value is never included.
   */
  private async refusedEvidence(
    conversation: Iri,
    items: readonly EvidenceItem[],
  ): Promise<RefusedEvidence[]> {
    const kept = new Set(this.coreEvidence(items));
    const out: RefusedEvidence[] = [];
    for (const item of items) {
      if (kept.has(item) || !isClaimEvidence(item)) continue;
      let protectedObject: string;
      let valid: boolean;
      if (item.format === "selective-disclosure+jws") {
        const check = await verifySelectivePresentation(
          item,
          this.trust,
          this.now(),
          this.identity.actor,
        );
        protectedObject = check.verification.protectedObject;
        valid = check.verification.outcome === "valid";
      } else {
        const v = await verifyCompact(item.value, {
          resolve: this.trust.resolver("issuer"),
          typ: TYP.statement,
          allowedAlgs: ["EdDSA", "ES256"],
          limits: this.limits,
        });
        protectedObject = v.digest;
        valid = v.outcome === "valid";
      }
      let claim: JsonObject | undefined;
      try {
        claim = valid ? unverifiedEvidenceClaim(item) : undefined;
      } catch {
        claim = undefined;
      }
      if (!claim) {
        out.push({ integrity: "invalid", protectedObject, reason: "evidence-invalid" });
        continue;
      }
      const reason =
        this.gateMemory.refusals[`statement:${String(claim.id ?? digestOf(claim))}`] ??
        "evidence-invalid";
      out.push({
        integrity: "valid",
        protectedObject,
        reason,
        ...(typeof claim.id === "string" ? { id: claim.id as Iri } : {}),
        ...(typeof claim.claimType === "string" ? { claimType: claim.claimType } : {}),
        ...(typeof claim.issuer === "string" ? { issuer: claim.issuer as Iri } : {}),
        ...(reason === "source-not-authoritative" || reason === "source-unknown"
          ? { sourceAuthority: "not-accepted" as const }
          : {}),
      });
    }
    // The summaries are gate output: a receipt may carry their labels back to the sender.
    this.gateMemory.rememberIdentifiers(conversation, out as unknown as Json);
    return out;
  }

  private context(
    conv: ConversationState,
    message?: AnyMessage,
    representation?: RepresentationAssessment,
  ): HandlerContext {
    const opKey = conv.operation ? operationKey(conv.operation) : "_";
    return {
      self: this.identity,
      peer: conv.peer,
      conversation: conv,
      now: this.now(),
      ...(message
        ? { message: { ...message, evidence: this.coreEvidence(message.evidence ?? []) } }
        : {}),
      ...(message && this.kidOf(message) ? { signerKid: this.kidOf(message) as string } : {}),
      ...(representation ? { representation } : {}),
      trust: this.trust,
      mintIdentifier: () => this.newId(),
      admittedStatement: (id, digest) => this.gateMemory.facts.get(id)?.digest === digest,
      ...(this.options.gates?.accessPod
        ? {
            referenceResource: (id: string, agreedDays: number) => {
              const pod = this.options.gates!.accessPod!;
              const stored = pod.actor === this.identity.actor ? pod.stored(id) : undefined;
              return (
                stored && {
                  resource:
                    this.options.gates?.referenceResource?.(stored.resource) ?? stored.resource,
                  retentionDays: this.outbound.referenceRetentionDays(agreedDays),
                }
              );
            },
            pendingReferences: Object.keys(this.state.domain)
              .filter((key) => key.startsWith("_reference:"))
              .map(
                (key) =>
                  this.getDomain(key) as unknown as {
                    pointer: AccessPointer;
                    conversation: string;
                  },
              )
              .filter((entry) => entry.conversation === conv.id)
              .map((entry) => entry.pointer),
          }
        : {}),
      refusedEvidence: () => this.refusedEvidence(conv.id, message?.evidence ?? []),
      evaluateRule: (rule, subject, purpose) => {
        const result = evaluateRule({
          rules: this.options.gates?.rules ?? [],
          rule,
          memory: this.gateMemory,
          task: this.options.gates?.taskId ?? conv.id,
          subject,
          purpose,
          deriver: this.identity.actor,
          at: this.now(),
          reliance: this.options.gates?.reliance,
          sources: this.options.gates?.sourceAliases,
        });
        this.record({
          type: "rule-evaluation",
          rule,
          subject,
          purpose,
          result: result.ok
            ? {
                ok: true,
                statement: result.statement,
                inputs: result.inputs.map((i) => ({ id: i.id, digest: i.digest })),
              }
            : result,
          at: this.now(),
        });
        return result;
      },
      identifierFor: (value) => this.registerIdentifier(derivedUrn("domain-item", value)),
      assessRepresentation: (jws, expect) => this.inbound.assessRepresentation(jws, expect),
      getState: <T extends Json>(key: string) => {
        const value = this.getDomain(`${opKey}:${key}`);
        if (value !== undefined)
          this.gateMemory.enter(this.options.gates?.taskId ?? conv.id, {
            id: derivedUrn("memory", { operation: opKey, key, digest: digestOf(value) }),
            kind: "memory",
            identifiers: identifiersIn(value),
            digest: digestOf(value),
            label: `Memory entry ${key}`,
            claimType: `memory:${key}`,
            source: this.identity.actor,
            subject: this.identity.party ?? "unknown",
          });
        return copyData(value) as T | undefined;
      },
      setState: (key: string, value: Json, owner?: Iri | null) =>
        this.setDomain(`${opKey}:${key}`, value, owner === null ? undefined : (owner ?? conv.id)),
      record: (r) => this.record({ ...r, producer: "core" }),
      verify: async (jws, o) => {
        const selective =
          this.options.gates?.selectiveAnnual &&
          o.typ === TYP.statement &&
          o.role === "issuer" &&
          jws.startsWith("{")
            ? await verifySelectivePresentation(
                { role: "credential", format: "selective-disclosure+jws", value: jws },
                this.trust,
                this.now(),
                this.identity.actor,
              )
            : undefined;
        const projected = selective?.payload ? o.schema.safeParse(selective.payload) : undefined;
        const check = selective
          ? { ...selective, payload: projected?.success ? projected.data : undefined }
          : await verifyStatement(jws, {
              trust: this.trust,
              typ: o.typ,
              role: o.role,
              schema: o.schema,
              limits: this.limits,
              verifier: this.identity.actor,
              at: this.now(),
            });
        this.record(check.verification);
        this.gateMemory.rememberIdentifiers(conv.id, check.verification);
        if (check.payload) this.gateMemory.rememberIdentifiers(conv.id, check.payload);
        return check;
      },
      assessSource: (input) => {
        const a = this.trust.assessSource({
          evaluator: this.identity.actor,
          at: this.now(),
          ...input,
        });
        this.record(a);
        this.admission?.sourceAssessed(a);
        return a;
      },
    };
  }

  /** Mint outside a handler without giving the caller a way to choose identifier words. */
  mintIdentifier(): Promise<Iri> {
    return this.exclusive(async () => {
      const id = this.newId();
      this.persist();
      return id;
    });
  }

  private registerIdentifier(id: Iri): Iri {
    this.gateMemory.rememberIdentifiers("*", [id]);
    return id;
  }

  private selfRef() {
    return {
      actor: this.identity.actor,
      ...(this.identity.party ? { onBehalfOf: this.identity.party } : {}),
      ...(this.identity.operator ? { operator: this.identity.operator } : {}),
    };
  }

  private agreementId(proposal: Iri, termsDigest: string, selection?: JsonObject): Iri {
    return this.registerIdentifier(
      derivedUrn("agreement", { proposal, termsDigest, selection: selection ?? null }),
    );
  }

  private mustConversation(id: Iri): ConversationState {
    const c = this.state.conversations[id];
    if (!c) throw new Error(`unknown conversation ${id}`);
    return c;
  }

  private saveConversation(c: ConversationState): ConversationState {
    this.state.conversations[c.id] = c;
    return c;
  }

  private apply(conv: ConversationState, event: ConversationEvent): ConversationState {
    const r = transition(conv, event, this.limits);
    if (!r.ok) throw new Error(`internal transition failure: ${r.detail}`);
    return this.saveConversation(r.state);
  }

  private guardCapacity(): void {
    // Sweep idle conversations first. Anonymous (public) peers get a short idle limit so
    // unauthenticated traffic cannot pin the open-conversation budget.
    const now = Date.parse(this.now());
    for (const c of Object.values(this.state.conversations)) {
      if (isTerminal(c.phase)) continue;
      const idleLimit = c.peer.actor ? this.limits.conversationTtlMs : ANONYMOUS_IDLE_MS;
      if (now - Date.parse(c.updatedAt) > idleLimit)
        this.apply(c, { type: "expire", at: this.now() });
    }
    const open = Object.values(this.state.conversations).filter((c) => !isTerminal(c.phase)).length;
    if (open >= this.limits.maxOpenConversations)
      this.reject("capacity", "too many open conversations");
    // Retained history is bounded too: compact, and if protected (unresolved) state still
    // exceeds the budget, refuse new work rather than dropping anything unresolved.
    const report = this.compactNow();
    if (report.overCapacity)
      this.reject("capacity", `retained state over capacity: ${report.overCapacity}`);
    const retained =
      Object.keys(this.state.conversations).length + Object.keys(this.state.tasks).length;
    if (retained >= this.retention.maxRetainedConversations) {
      this.reject(
        "capacity",
        "no room for another conversation within the retention budget (unresolved state is never dropped)",
      );
    }
  }

  private pruneSeen(now: number): void {
    for (const [id, s] of Object.entries(this.state.seen)) {
      if (Date.parse(s.expiresAt) + this.limits.maxClockSkewMs < now) delete this.state.seen[id];
    }
  }

  private getDomain(key: string): Json | undefined {
    return domainValue(this.state.domain[key]);
  }

  private setDomain(key: string, value: Json, owner?: Iri): void {
    this.state.domain[key] = owner === undefined ? value : { owner, value };
  }

  private record<T extends LedgerRecord>(record: T): void {
    this.ledger.append(jointLogView(record), this.now());
  }

  private trustedAuditHead(): LedgerHead | undefined {
    return this.ledgerAuditTrusted ? this.ledger.head?.() : undefined;
  }

  private persist(): void {
    if (this.ledger.requiresTrustedCheckpoint && this.ledgerAuditTrusted)
      this.state.ledgerAuditHead = this.trustedAuditHead();
    this.store.save(copyData(this.state));
  }

  private result(
    disposition: Disposition,
    fields: Omit<StepResult, "disposition" | "decisions">,
  ): StepResult {
    return { disposition, decisions: [...this.decisions], ...fields };
  }

  /** Public key material for introduction cards (no private components). */
  publicKeys(): ReadonlyArray<{ kid: string; alg: KeyAlg; publicJwk: JWK }> {
    return [...this.keysByAlg.values()].map((k) => ({
      kid: k.kid,
      alg: k.alg,
      publicJwk: k.publicJwk,
    }));
  }
}

/** Register entries carried by admitted `register.entry` statements; malformed ones are skipped. */
function registerAnswers(
  facts: Iterable<import("../gates/common.js").AdmittedFact>,
): import("../trust/resolver.js").AnsweredEntry[] {
  const out: import("../trust/resolver.js").AnsweredEntry[] = [];
  for (const fact of facts) {
    const s = fact.statement;
    if (fact.claimType !== "register.entry" || !s || !fact.subject) continue;
    const strings = (v: unknown) =>
      Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
    const authorizedFor = strings(s.authorizedFor);
    const claimTypes = s.claimTypes === undefined ? [] : strings(s.claimTypes);
    const status = s.status;
    const signedAt = typeof s.issuedAt === "string" ? s.issuedAt : fact.asOf;
    if (
      !signedAt ||
      !authorizedFor ||
      !claimTypes ||
      (status !== "authorized" && status !== "suspended" && status !== "withdrawn")
    )
      continue;
    out.push({
      register: fact.source,
      signedAt,
      ...(typeof s.validUntil === "string" ? { validUntil: s.validUntil } : {}),
      entry: {
        party: fact.subject,
        authorizedFor,
        claimTypes,
        status,
        id: typeof s.entry === "string" ? s.entry : fact.id,
      },
    });
  }
  return out;
}
