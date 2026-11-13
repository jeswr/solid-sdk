// AUTHORED-BY Codex GPT-6
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
import { AsyncLocalStorage } from "node:async_hooks";
import type { JWK } from "jose";
import { derivedUrn, digestBytes, digestOf, newUrn } from "../core/canonical.js";
import {
  type ConversationEvent,
  type ConversationState,
  isTerminal,
  openConversation,
  transition,
} from "../core/conversation.js";
import { BoundsError, type PilotLimits, parseBoundedJson, resolveLimits } from "../core/limits.js";
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
  VerificationResult,
} from "../core/types.js";
import { type KeyAlg, type SigningKey, signCompact, verifyCompact } from "../mechanisms/jws.js";
import {
  actionDigest,
  evaluateIntent,
  type LoadedMandate,
  loadMandate,
  verifyApproval,
} from "../mechanisms/mandate.js";
import { type PolicyEngine, solidOdrlEngine } from "../mechanisms/policy-engine.js";
import {
  MECHANISM_ID,
  representationSchema,
  TYP,
  verifyStatement,
} from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { CONFIGURATIONS, configurationById, POLICY_PROFILE } from "../profile/configurations.js";
import {
  buildDescription,
  type ConformanceClaim,
  type DescribedPolicyModule,
  type ImplementationDescription,
  readPeerDescription,
  selectConfiguration,
} from "../profile/description.js";
import { PILOT_PROFILE } from "../profile/vocabulary.js";
import type { EvidenceLedger, LedgerRecord } from "../store/ledger.js";
import type {
  EffectState,
  OutboxEntry,
  RuntimeState,
  StateStore,
  TaskState,
  WireMessage,
} from "../store/state.js";
import { domainValue } from "../store/state.js";
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
  readonly identity: AgentIdentity;
  /** Actor signing keys (one per algorithm). Absent for an anonymous public client. */
  readonly actorKeys?: readonly SigningKey[];
  readonly trust: TrustStore;
  /** Owner-signed mandate (JWS). Absent → every consequential action is denied. */
  readonly mandateJws?: string;
  /** Owner-signed representation statement presented to peers (JWS). */
  readonly representationJws?: string;
  /** Accepted configuration ids, in preference order. */
  readonly accepted: readonly string[];
  readonly handlers: readonly OperationHandler[];
  readonly effects?: readonly EffectAdapter[];
  readonly store: StateStore;
  readonly ledger: EvidenceLedger;
  readonly now?: () => Date;
  readonly newId?: () => string;
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
  | { type: "effect"; plan: EffectPlan; basis?: Iri };

interface StartPlan {
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

export class AgentRuntime {
  readonly identity: AgentIdentity;
  readonly limits: PilotLimits;
  private readonly trust: TrustStore;
  private readonly store: StateStore;
  private readonly ledger: EvidenceLedger;
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly handlers = new Map<string, OperationHandler>();
  private readonly effectAdapters = new Map<string, EffectAdapter>();
  private readonly keysByAlg = new Map<KeyAlg, SigningKey>();
  private state: RuntimeState;
  private mandate: LoadedMandate | undefined;
  private mandateFailure: string | undefined;
  private decisions: AuthorisationDecision[] = [];
  private readonly retention: RetentionPolicy;
  /** Serial executor: every state-changing entrypoint runs one at a time, in call order. */
  private queue: Promise<void> = Promise.resolve();
  private readonly inside = new AsyncLocalStorage<true>();
  /** Provider sends from this process that timed out but have not settled (not cancelled). */
  private readonly inFlight = new Set<Iri>();
  private closed = false;

  private constructor(private readonly options: AgentRuntimeOptions) {
    this.retention = { ...DEFAULT_RETENTION, ...(options.retention ?? {}) };
    this.identity = options.identity;
    this.limits = resolveLimits(options.limits);
    this.trust = options.trust;
    this.store = options.store;
    this.ledger = options.ledger;
    this.clock = options.now ?? (() => new Date());
    this.newId = options.newId ?? newUrn;
    for (const h of options.handlers) this.handlers.set(operationKey(h.description), h);
    for (const e of options.effects ?? []) this.effectAdapters.set(e.id, e);
    for (const k of options.actorKeys ?? []) this.keysByAlg.set(k.alg, k);
    this.state = this.store.load();
  }

  static async create(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    const rt = new AgentRuntime(options);
    await rt.loadMandateInto();
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
        return fn();
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
    const result = await loadMandate(source, {
      trust: this.trust,
      actor: this.identity.actor,
      limits: this.limits,
      at: this.now(),
    });
    this.record(result.ok ? result.loaded.verification : result.verification);
    if (result.ok) {
      this.mandate = result.loaded;
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
      intent: p.intent,
      conversation: p.conversation,
    }));
  }

  domainState(key: string): Json | undefined {
    return this.getDomain(key);
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
      jws: string,
    ): Promise<{ ok: boolean; audienceActor?: Iri; messageId?: Iri; detail: string }>;
    endpointsFor(actor: Iri): readonly string[];
    transmit(req: TransmitRequest, io: TransmissionIo): Promise<TransmitResult>;
    checkTransmission(req: TransmitRequest): Promise<{ ok: true } | TransmitResult>;
  } {
    const own = [...this.keysByAlg.values()];
    return {
      verifyOwnEnvelope: async (jws) => {
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
    /**
     * Caller-chosen conversation id (must be new). Lets a caller record its intent BEFORE the
     * call and later prove from this runtime's state whether the negotiation was started.
     */
    conversation?: Iri;
  }): Promise<StepResult> {
    return this.exclusive(() =>
      this.start({
        ...input,
        plan: {
          type: "propose",
          operation: input.operation,
          terms: input.terms,
          models: input.models,
          ...(input.evidence ? { evidence: input.evidence } : {}),
        },
      }),
    );
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
  ): Promise<StepResult> {
    return this.exclusive(async () => {
      const conv = this.mustConversation(conversationId);
      const out = await this.emit(
        conv.id,
        "receipt",
        { ref: conv.agreement ?? conv.id, ...body },
        {},
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
    if (!plan) return { messages: [] };
    const handler = this.handlers.get(operationKey(plan.operation));
    if (!handler) throw new Error(`no local handler for ${operationKey(plan.operation)}`);
    const ctx = this.context(conv);
    if (plan.type === "propose" && plan.terms) {
      const intent = handler.intentForProposal?.(ctx, plan.terms);
      if (!intent) throw new Error("handler provides no proposal intent");
      const decision = this.authorise(intent);
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
        termsDigest: digestOf(plan.terms),
        round: 1,
      };
      return {
        messages: [
          await this.emit(conversationId, "propose", body, {
            evidence: [...this.ownEvidence(), ...(plan.evidence ?? [])],
            intent,
          }),
        ],
      };
    }
    const intent = handler.intentForInvoke?.(ctx, plan.input ?? {});
    if (intent) {
      const decision = this.authorise(intent);
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
    const body = {
      operation: plan.operation,
      input: plan.input ?? {},
      basis: plan.basis ?? { kind: "public" },
      ...(plan.purpose ? { purpose: plan.purpose } : {}),
    };
    const anonymous =
      configurationById(conv.configuration ?? "")?.requesterAuthentication === "not-applicable";
    return {
      messages: [
        await this.emit(conversationId, "invoke", body, {
          evidence: anonymous ? [] : [...this.ownEvidence(), ...(plan.evidence ?? [])],
          ...(intent ? { intent } : {}),
        }),
      ],
    };
  }

  /**
   * Continue an existing agreed conversation with an invocation (e.g. a transfer request
   * under an agreement). The intent is authorised before sending.
   */
  async invokeUnderAgreement(input: {
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
      if (intent) {
        const decision = this.authorise(intent);
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
        evidence: this.ownEvidence(),
        ...(intent ? { intent } : {}),
      });
      this.persist();
      return this.result("local", { conversation: conv.id, outbound: [out] });
    });
  }

  // ---------------------------------------------------------------- inbound

  /** Process one inbound wire message. Never throws on hostile input. */
  receive(wire: unknown, meta: { binding?: string } = {}): Promise<StepResult> {
    return this.exclusive(() => this.receiveGuarded(wire, meta));
  }

  private async receiveGuarded(wire: unknown, meta: { binding?: string }): Promise<StepResult> {
    try {
      return await this.receiveInner(wire, meta);
    } catch (error) {
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
    }
  }

  private reject(reason: ReasonCode, detail: string, extra: JsonObject = {}): never {
    this.record({ type: "rejection", reason, detail, ...extra, at: this.now() });
    throw new RejectError(reason, detail);
  }

  private async receiveInner(wire: unknown, meta: { binding?: string }): Promise<StepResult> {
    const at = this.now();
    if (!wire || typeof wire !== "object")
      this.reject("malformed", "wire message is not an object");
    const w = wire as Record<string, unknown>;
    let payload: unknown;
    let verification: VerificationResult;
    let signedBy: { subject: Iri; alg: KeyAlg; kid: string } | undefined;
    const rawDigest = digestBytes(JSON.stringify(w).slice(0, this.limits.maxEnvelopeBytes * 2));

    if (w.format === "awp-jws-compact/0.1" && typeof w.jws === "string") {
      const v = await verifyCompact(w.jws, {
        resolve: this.trust.resolver("actor"),
        typ: TYP.message,
        allowedAlgs: ["EdDSA", "ES256"],
        limits: this.limits,
      });
      verification = {
        type: "verification",
        protectedObject: v.digest,
        property: "integrity-and-key-attribution",
        mechanism: `${MECHANISM_ID} typ=${TYP.message}`,
        verifier: this.identity.actor,
        at,
        ...(v.kid ? { verificationMaterial: v.kid } : {}),
        ...(v.outcome === "valid" ? { attributedTo: v.pinned.subject } : {}),
        outcome: v.outcome,
        limitations:
          v.outcome === "valid"
            ? ["integrity + attribution to a pinned actor key only; not authority or truth"]
            : [v.detail],
      };
      this.record(verification);
      if (v.outcome !== "valid") {
        this.reject(v.reason === "bounds-exceeded" ? "bounds-exceeded" : v.reason, v.detail, {
          binding: meta.binding ?? "unknown",
          digest: v.digest,
        });
      }
      payload = v.payload;
      signedBy = { subject: v.pinned.subject, alg: v.alg, kid: v.kid };
    } else if (w.format === "awp-unsigned-json/0.1" && typeof w.payload === "string") {
      try {
        payload = parseBoundedJson(w.payload, this.limits);
      } catch (error) {
        this.reject(
          error instanceof BoundsError && error.code !== "not-json"
            ? "bounds-exceeded"
            : "malformed",
          "unsigned payload rejected",
        );
      }
      verification = {
        type: "verification",
        protectedObject: digestBytes(w.payload),
        property: "none-unsigned",
        mechanism: "none",
        verifier: this.identity.actor,
        at,
        outcome: "not-applicable",
        limitations: [
          "unsigned: no integrity or attribution; acceptable only for anonymous public requests",
        ],
      };
      this.record(verification);
    } else {
      this.reject("malformed", "unknown wire format", { digest: rawDigest });
    }

    const checked = validateMessage(payload);
    if (!checked.ok) this.reject(checked.reason, checked.detail);
    const msg = checked.message;
    const msgDigest = digestOf(msg);
    this.current = { id: msg.id, ...(signedBy ? { kid: signedBy.kid } : {}) };

    // Sender ↔ key binding and configuration ↔ mechanism binding.
    const config = configurationById(msg.configuration);
    if (signedBy) {
      if (msg.from.actor !== signedBy.subject) {
        this.reject(
          "sender-key-mismatch",
          "message names a different actor than the pinned key's subject",
        );
      }
      if (
        config &&
        config.integrity.status === "selected" &&
        config.integrity.alg !== signedBy.alg
      ) {
        this.reject(
          "configuration-mismatch",
          `configuration requires ${config.integrity.alg}, message used ${signedBy.alg}`,
        );
      }
    } else {
      if (!config?.unsignedRequestKinds.includes(msg.kind)) {
        this.reject(
          "unsigned-not-allowed",
          `unsigned ${msg.kind} not permitted by ${msg.configuration}`,
        );
      }
      if (msg.from.actor || msg.from.onBehalfOf || (msg.evidence ?? []).length > 0) {
        this.reject(
          "unsigned-not-allowed",
          "an unsigned message cannot claim an identity or carry evidence",
        );
      }
    }

    // Audience.
    if (msg.to) {
      if (msg.to.actor !== this.identity.actor)
        this.reject("wrong-audience", `addressed to ${msg.to.actor}`);
    } else {
      const answersOurs = msg.inReplyTo ? Boolean(this.state.outbox[msg.inReplyTo]) : false;
      const publicConfig = config?.requesterAuthentication === "not-applicable";
      if (!(publicConfig && (answersOurs || !signedBy))) {
        this.reject("wrong-audience", "message has no audience");
      }
    }

    // Time window.
    const now = Date.parse(at);
    const created = Date.parse(msg.createdAt);
    const expires = Date.parse(msg.expiresAt);
    if (created > now + this.limits.maxClockSkewMs)
      this.reject("not-yet-valid", "createdAt is in the future");
    if (expires <= now - this.limits.maxClockSkewMs) this.reject("expired", "message expired");
    if (expires - created > this.limits.maxMessageLifetimeMs || expires <= created) {
      this.reject("lifetime-too-long", "message lifetime out of bounds");
    }
    if ((msg.evidence ?? []).length > this.limits.maxEvidenceItems) {
      this.reject("bounds-exceeded", "too many evidence items");
    }

    // Replay / idempotency.
    this.pruneSeen(now);
    const seen = this.state.seen[msg.id];
    if (seen) {
      if (seen.digest !== msgDigest)
        this.reject("replay-conflict", "message id reused with different content");
      const responses = seen.responses
        .map((id) => this.state.outbox[id])
        .filter((e): e is OutboxEntry => Boolean(e))
        .map((e) => this.outboundFromEntry(e));
      // An entry still `processing`/`interrupted` means a crash cut dispatch short after a
      // write-ahead snapshot. The message is NOT re-dispatched (its partial effects are
      // durable); recover() completes the recorded work, and the responses recorded so far
      // are returned here.
      const interrupted = seen.disposition === "processing" || seen.disposition === "interrupted";
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
      this.reject("capacity", "replay set is full; refusing new input");
    }
    this.state.seen[msg.id] = {
      digest: msgDigest,
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

    const outbound = await this.dispatch(msg);
    const conv = this.state.conversations[msg.conversation];
    const recorded = this.state.seen[msg.id]?.responses ?? [];
    this.state.seen[msg.id] = {
      digest: msgDigest,
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
        message: msg,
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
        { ref: msg.id, reason: selection.reason, detail: selection.detail },
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
        { ref: msg.id, reason: vet.reason, detail: vet.detail },
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
    msg: Message<"refuse" | "unsupported" | "indeterminate">,
  ) {
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
      if (rep && rep.outcome !== "accepted") {
        return this.replyClose(
          conv,
          msg,
          "refuse",
          rep.reason ?? "representation-invalid",
          "representation not accepted",
        );
      }
    }
    const reply = await handler.onInvoke(
      this.context(conv, msg, rep),
      msg.body,
      msg.evidence ?? [],
    );
    return this.applyReply(conv, msg, reply, handler);
  }

  private async onDeliver(conv: ConversationState, msg: Message<"deliver">) {
    const request = conv.requests?.[msg.body.ref];
    if (!request) this.reject("protocol-violation", "delivery request is not recorded");
    const handler = this.handlers.get(operationKey(request.operation));
    if (!handler?.onDeliver) return { disposition: "accepted" as const, outbound: [] };
    const reply = await handler.onDeliver(this.context(conv, msg), msg.body, msg.evidence ?? []);
    return this.applyReply(this.mustConversation(conv.id), msg, reply, handler);
  }

  private async onReceipt(conv: ConversationState, msg: Message<"receipt">) {
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
      const decision = this.authorise(intent);
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
        const out = await this.emit(conv.id, "accept", body, {
          inReplyTo,
          evidence: [...this.ownEvidence(), ...(reply.evidence ?? [])],
          ...authorised,
        });
        const terms = this.getDomain(`_offer:${open.id}`) as JsonObject;
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
          termsDigest: digestOf(reply.terms),
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
      case "receipt": {
        const body = {
          ref: conv.agreement ?? inReplyTo,
          activity: reply.activity,
          outcome: reply.outcome,
          ...(reply.observed ? { observed: reply.observed } : {}),
          final: reply.final,
        };
        return [await this.emit(conv.id, "receipt", body, { inReplyTo })];
      }
      default:
        return [];
    }
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
    for (const m of plan.messages ?? []) {
      outbound.push(...(await this.performPlanMessage(conversationId, m)));
    }
    for (const e of plan.effects ?? []) {
      outbound.push(...(await this.runEffect(conversationId, e, agreement.id)));
    }
    return { disposition: "accepted" as const, outbound };
  }

  private async performPlanMessage(
    conversationId: Iri,
    m: OutboundPlan,
  ): Promise<OutboundMessage[]> {
    if (m.intent) {
      const decision = this.authorise(m.intent);
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

  private authorise(intent: ActionIntent): AuthorisationDecision {
    const at = this.now();
    const approvals = new Map<string, { id: Iri; decision: "approve" | "deny" }>();
    for (const [digest, a] of Object.entries(this.state.approvals)) {
      if (Date.parse(a.validUntil) > Date.parse(at))
        approvals.set(digest, { id: a.id, decision: a.decision });
    }
    const revoked = this.mandate ? this.isRevoked(this.mandate) : false;
    const decision = evaluateIntent({
      loaded: revoked ? undefined : this.mandate,
      loadFailure: revoked ? "revoked by owner (persisted revocation)" : this.mandateFailure,
      intent,
      decider: this.identity.actor,
      at,
      approvals,
      ...(this.options.policyEngine ? { engine: this.options.policyEngine } : {}),
    });
    this.record(decision);
    this.decisions.push(decision);
    return decision;
  }

  /** Record an effect as `planned` (definitely not attempted) if not already known. */
  private planEffect(ownerId: Iri, plan: EffectPlan, basis: Iri): EffectState {
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

  private async runEffect(ownerId: Iri, plan: EffectPlan, basis: Iri): Promise<OutboundMessage[]> {
    const existing = this.state.effects[plan.key];
    if (existing?.status === "concluded") return []; // idempotent: already done
    if (existing?.status === "attempting") return this.reconcileOne(existing);
    const planned = this.planEffect(ownerId, plan, basis);
    const decision = this.authorise(plan.intent);
    if (decision.outcome === "approval-required") {
      this.park(ownerId, plan.intent, { type: "effect", plan, basis });
      return [];
    }
    const adapter = this.effectAdapters.get(plan.adapter);
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
      const decision = intent ? this.authorise(intent) : undefined;
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
          if (!plan || ownerClosed) {
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
    const decision = this.authorise(entry.intent);
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
  runTask(input: { taskId: Iri; kind: string; plan: EffectPlan }): Promise<{
    task: TaskState;
    effect?: EffectState;
    decisions: readonly AuthorisationDecision[];
    pendingApproval?: string;
  }> {
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
        await this.runEffect(task.id, input.plan, task.id);
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
      intent,
      conversation: ownerId,
      continuation: continuation as unknown as Json,
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

  /** Submit an owner approval (or denial) JWS; resumes the matching pending action. */
  submitApproval(jws: string): Promise<StepResult> {
    return this.exclusive(() => this.submitApprovalInner(jws));
  }

  private async submitApprovalInner(jws: string): Promise<StepResult> {
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
    this.state.approvals[a.actionDigest] = {
      id: a.id,
      decision: a.decision,
      validUntil: a.validUntil,
      jws,
    };
    this.record({
      type: "approval",
      id: a.id,
      actionDigest: a.actionDigest,
      decision: a.decision,
      issuer: a.issuer,
      at: this.now(),
    });
    const pending = this.state.pending[a.actionDigest];
    if (!pending) {
      this.persist();
      return this.result("local", {
        detail: "approval stored; no pending action with that digest",
        outbound: [],
      });
    }
    delete this.state.pending[a.actionDigest];
    const cont = pending.continuation as unknown as Continuation;
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
    if (!handler.requiresRepresentation) return undefined;
    const at = this.now();
    const base = {
      type: "representation-assessment" as const,
      evaluator: this.identity.actor,
      actor: msg.from.actor ?? "anonymous",
      party: msg.from.onBehalfOf ?? "unknown",
      operation: handler.description.id,
      at,
    };
    const done = (a: RepresentationAssessment) => {
      this.record(a);
      return a;
    };
    if (!msg.from.actor || !msg.from.onBehalfOf)
      return done({ ...base, outcome: "not-accepted", reason: "representation-missing" });
    const items = (msg.evidence ?? []).filter(
      (e) => e.role === "representation" && e.format === "jws-compact",
    );
    if (items.length === 0)
      return done({ ...base, outcome: "not-accepted", reason: "representation-missing" });
    if (conv.peer.party && conv.peer.party !== msg.from.onBehalfOf) {
      return done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
    }
    const kid = this.kidOf(msg);
    let last: RepresentationAssessment | undefined;
    for (const item of items) {
      last = await this.assessRepresentationJws(item.value, {
        actor: msg.from.actor,
        party: msg.from.onBehalfOf,
        operation: handler.description.id,
        ...(kid ? { actorKid: kid } : {}),
      });
      if (last.outcome === "accepted") return last;
    }
    return last ?? done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
  }

  /**
   * Assess one representation statement: verified against the PINNED party key, and it
   * must name this actor (and key), this party, this operation, and be currently valid.
   * Records and returns the assessment. Establishes representation only — no permission.
   */
  private async assessRepresentationJws(
    jws: string,
    expect: { actor: Iri; party?: Iri; operation: Iri; actorKid?: string },
  ): Promise<RepresentationAssessment> {
    const at = this.now();
    const base = {
      type: "representation-assessment" as const,
      evaluator: this.identity.actor,
      actor: expect.actor,
      party: expect.party ?? "unknown",
      operation: expect.operation,
      at,
    };
    const done = (a: RepresentationAssessment) => {
      this.record(a);
      return a;
    };
    const check = await verifyStatement(jws, {
      trust: this.trust,
      typ: TYP.representation,
      role: "party",
      schema: representationSchema,
      limits: this.limits,
      verifier: this.identity.actor,
      at,
    });
    this.record(check.verification);
    const s = check.payload;
    if (!s || check.verification.outcome !== "valid")
      return done({ ...base, outcome: "not-accepted", reason: "representation-invalid" });
    const wrongParty = expect.party !== undefined && s.party !== expect.party;
    if (check.signer?.subject !== s.party || wrongParty || s.actor !== expect.actor) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-invalid",
      });
    }
    if (expect.actorKid && s.actorKid !== expect.actorKid) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-invalid",
      });
    }
    const now = Date.parse(at);
    if (now < Date.parse(s.validFrom) || now >= Date.parse(s.validUntil)) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-expired",
      });
    }
    if (!s.operations.includes(expect.operation)) {
      return done({
        ...base,
        party: s.party,
        statement: s.id,
        outcome: "not-accepted",
        reason: "representation-out-of-scope",
      });
    }
    return done({ ...base, party: s.party, statement: s.id, outcome: "accepted" });
  }

  /** The pinned key that signed the message currently being processed. */
  private kidOf(msg: AnyMessage): string | undefined {
    return this.current?.id === msg.id ? this.current.kid : undefined;
  }

  private current: { id: Iri; kid?: string } | undefined;

  // ---------------------------------------------------------------- emit

  private ownEvidence(): EvidenceItem[] {
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
      inReplyTo?: Iri;
      evidence?: readonly EvidenceItem[];
      configuration?: string;
      force?: boolean;
      /** The action authorised for this message; re-authorised at provider transmission. */
      intent?: ActionIntent;
      /** Authorisation basis of a protected disclosure; re-checked at every transmission. */
      conditions?: readonly DisclosureCondition[];
    },
  ): Promise<OutboundMessage> {
    const conv = this.mustConversation(conversationId);
    const configuration = opts.configuration ?? conv.configuration;
    if (!configuration) throw new Error("no configuration selected");
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
    const message = {
      profile: PILOT_PROFILE,
      configuration,
      id: this.newId(),
      conversation: conversationId,
      kind,
      from: anonymousRequester ? {} : this.selfRef(),
      ...(conv.peer.actor
        ? { to: { actor: conv.peer.actor, ...(conv.peer.party ? { party: conv.peer.party } : {}) } }
        : {}),
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + lifetime).toISOString(),
      ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      body,
      ...(opts.evidence && opts.evidence.length > 0 ? { evidence: opts.evidence } : {}),
    } as unknown as AnyMessage;
    const checked = validateMessage(message);
    if (!checked.ok) throw new Error(`internal: outbound ${kind} invalid: ${checked.detail}`);
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
        if (!opts.force)
          throw new Error(`internal: outbound ${kind} violates state machine: ${next.detail}`);
      } else {
        this.saveConversation(next.state);
      }
    }
    let wire: WireMessage;
    if (anonymousRequester) {
      if (!cfg.unsignedRequestKinds.includes(kind))
        throw new Error(`internal: anonymous requester cannot send ${kind}`);
      wire = { format: "awp-unsigned-json/0.1", payload: JSON.stringify(message) };
    } else {
      const key = this.keysByAlg.get(cfg.integrity.alg);
      if (!key) throw new Error(`no actor key for ${cfg.integrity.alg}`);
      wire = { format: "awp-jws-compact/0.1", jws: await signCompact(key, TYP.message, message) };
    }
    if (kind === "propose")
      this.setDomain(`_offer:${message.id}`, (body as JsonObject).terms as Json, conversationId);
    const entry: OutboxEntry = {
      id: message.id,
      conversation: conversationId,
      kind,
      ...(conv.peer.actor ? { toActor: conv.peer.actor } : {}),
      wire,
      createdAt: message.createdAt,
      ...(opts.intent ? { intent: opts.intent } : {}),
      ...(opts.conditions ? { conditions: opts.conditions } : {}),
    };
    this.state.outbox[message.id] = entry;
    // Associate the response with the inbound message being processed NOW, so any
    // mid-dispatch snapshot already links them (a replay then returns this response).
    const seen = this.current ? this.state.seen[this.current.id] : undefined;
    if (this.current && seen && !seen.responses.includes(message.id)) {
      this.state.seen[this.current.id] = { ...seen, responses: [...seen.responses, message.id] };
    }
    this.record({
      type: "message-out",
      id: message.id,
      kind,
      conversation: conversationId,
      digest: digestOf(message),
      at: message.createdAt,
      // The payload-free authorisation basis of a protected disclosure (kind + reference).
      ...(opts.conditions ? { conditions: opts.conditions } : {}),
    });
    return this.outboundFromEntry(entry, message);
  }

  private outboundFromEntry(entry: OutboxEntry, message?: AnyMessage): OutboundMessage {
    let msg = message;
    if (!msg) {
      const text =
        entry.wire.format === "awp-unsigned-json/0.1"
          ? entry.wire.payload
          : Buffer.from(entry.wire.jws.split(".")[1] ?? "", "base64url").toString("utf8");
      msg = JSON.parse(text) as AnyMessage;
    }
    return {
      id: entry.id,
      conversation: entry.conversation,
      kind: entry.kind as MessageKind,
      ...(entry.toActor ? { toActor: entry.toActor } : {}),
      endpoints: entry.toActor ? this.trust.actorEndpoints(entry.toActor) : [],
      wire: entry.wire,
      message: msg,
    };
  }

  private async replyClose(
    conv: ConversationState,
    msg: AnyMessage,
    kind: "refuse" | "unsupported" | "indeterminate",
    reason: ReasonCode,
    detail?: string,
  ) {
    this.record({
      type: "refusal",
      conversation: conv.id,
      kind,
      reason,
      ...(detail ? { detail } : {}),
      ref: msg.id,
      at: this.now(),
    });
    if (isTerminal(conv.phase))
      return {
        disposition: "accepted" as const,
        outbound: [],
        reason,
        ...(detail ? { detail } : {}),
      };
    const body = { ref: msg.id, reason, ...(detail ? { detail: detail.slice(0, 1000) } : {}) };
    const current = this.mustConversation(conv.id);
    if (current.phase === "open" || current.phase === "discovering") {
      this.closeLocally(current, kind === "refuse" ? "refused" : kind, reason);
      return {
        disposition: "accepted" as const,
        outbound: [],
        reason,
        ...(detail ? { detail } : {}),
      };
    }
    const out = await this.emit(conv.id, kind, body, { inReplyTo: msg.id });
    return {
      disposition: "accepted" as const,
      outbound: [out],
      reason,
      ...(detail ? { detail } : {}),
    };
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
      ...(message ? { message } : {}),
      ...(message && this.kidOf(message) ? { signerKid: this.kidOf(message) as string } : {}),
      ...(representation ? { representation } : {}),
      trust: this.trust,
      assessRepresentation: (jws, expect) => this.assessRepresentationJws(jws, expect),
      getState: <T extends Json>(key: string) => this.getDomain(`${opKey}:${key}`) as T | undefined,
      setState: (key: string, value: Json, owner?: Iri | null) =>
        this.setDomain(`${opKey}:${key}`, value, owner === null ? undefined : (owner ?? conv.id)),
      record: (r) => this.record(r),
      verify: async (jws, o) => {
        const check = await verifyStatement(jws, {
          trust: this.trust,
          typ: o.typ,
          role: o.role,
          schema: o.schema,
          limits: this.limits,
          verifier: this.identity.actor,
          at: this.now(),
        });
        this.record(check.verification);
        return check;
      },
      assessSource: (input) => {
        const a = this.trust.assessSource({
          evaluator: this.identity.actor,
          at: this.now(),
          ...input,
        });
        this.record(a);
        return a;
      },
    };
  }

  private selfRef() {
    return {
      actor: this.identity.actor,
      ...(this.identity.party ? { onBehalfOf: this.identity.party } : {}),
      ...(this.identity.operator ? { operator: this.identity.operator } : {}),
    };
  }

  private agreementId(proposal: Iri, termsDigest: string, selection?: JsonObject): Iri {
    return derivedUrn("agreement", { proposal, termsDigest, selection: selection ?? null });
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
    this.ledger.append(record, this.now());
  }

  private persist(): void {
    this.store.save(this.state);
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
