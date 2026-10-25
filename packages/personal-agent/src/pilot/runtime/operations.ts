/**
 * Domain adapters plug into the runtime as OPERATION HANDLERS.
 *
 * The split preserved from the M1 Reader / Actor / outbox design:
 *  - the runtime's inbound pipeline is the READER: it verifies, bounds and validates
 *    input and holds no effect credentials;
 *  - a handler is the PROPOSER: pure domain logic that turns verified input into a
 *    reply or a plan, each consequential step carrying an {@link ActionIntent};
 *  - the runtime's executor is the EXECUTOR: it evaluates every intent against the owner
 *    mandate (and approvals) and alone holds the {@link EffectAdapter}s.
 * A handler cannot send, sign or execute anything itself.
 */
import type { z } from "zod";
import type { ConversationState, Side } from "../core/conversation.js";
import type {
  ActionIntent,
  Agreement,
  AnyMessage,
  DeliverBody,
  EvidenceItem,
  InvokeBody,
  Iri,
  Json,
  JsonObject,
  OperationRef,
  OutcomeConclusion,
  ProposeBody,
  ReasonCode,
  ReceiptBody,
  RepresentationAssessment,
  SourceAuthorityAssessment,
  VerificationResult,
} from "../core/types.js";
import type { StatementCheck } from "../mechanisms/statements.js";
import type { KeyRole, TrustStore } from "../mechanisms/trust.js";
import type { OperationDescription } from "../profile/description.js";

/**
 * The AUTHORISATION BASIS of a protected disclosure, kept with the outbound message: a typed,
 * payload-free, durable reference (e.g. an access-grant id and expiry, a purpose-store release).
 * Every transmission re-evaluates it through the checker the hosting role registered for
 * `kind` (see {@link DisclosureCheck}); an unknown kind fails closed. Public metadata (a
 * description, a public catalogue, a refusal) carries no condition.
 */
export interface DisclosureCondition {
  readonly kind: string;
  readonly ref: JsonObject;
}

/**
 * Re-decides one condition NOW. MUST NOT create effects (it may record decision evidence).
 * Never implemented by re-running the handler that produced the message.
 */
export type DisclosureCheck = (
  ref: JsonObject,
  at: string,
) => { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type HandlerReply =
  | {
      readonly type: "accept";
      readonly selection?: JsonObject;
      readonly intent: ActionIntent;
      readonly evidence?: readonly EvidenceItem[];
    }
  | { readonly type: "counter"; readonly terms: JsonObject; readonly intent: ActionIntent }
  | {
      readonly type: "refuse" | "unsupported" | "indeterminate";
      readonly reason: ReasonCode;
      readonly detail?: string;
    }
  | {
      readonly type: "deliver";
      readonly output: JsonObject;
      readonly intent?: ActionIntent;
      readonly evidence?: readonly EvidenceItem[];
      /** The authorisation basis re-checked before every transmission of this delivery. */
      readonly conditions?: readonly DisclosureCondition[];
    }
  | {
      readonly type: "receipt";
      readonly activity: Iri;
      readonly outcome: OutcomeConclusion;
      readonly observed?: JsonObject;
      readonly final: boolean;
    }
  | { readonly type: "none" };

/** An external effect the executor performs after authorising `intent`. */
export interface EffectPlan {
  readonly adapter: string;
  /** Stable idempotency key; the same key never produces a second effect. */
  readonly key: string;
  readonly params: JsonObject;
  readonly intent: ActionIntent;
  readonly activityType: string;
  /** Send a receipt to the peer when the effect concludes. */
  readonly receipt?: { readonly final: boolean };
}

/** A follow-up message the runtime should emit (after authorising its intent). */
export interface OutboundPlan {
  readonly kind: "deliver" | "invoke" | "receipt";
  readonly body: JsonObject;
  readonly intent?: ActionIntent;
  readonly evidence?: readonly EvidenceItem[];
}

export interface AgreementPlan {
  readonly requiredOutcomes: readonly Side[];
  readonly effects?: readonly EffectPlan[];
  readonly messages?: readonly OutboundPlan[];
}

export interface VerifiedEvidence {
  readonly item: EvidenceItem;
  readonly verification?: VerificationResult;
}

export interface HandlerContext {
  readonly self: { readonly actor: Iri; readonly party?: Iri; readonly operator?: Iri };
  readonly peer: { readonly actor?: Iri; readonly party?: Iri };
  readonly conversation: ConversationState;
  readonly now: string;
  readonly message?: AnyMessage;
  /** Thumbprint of the pinned key that signed `message` (for proof-of-possession checks). */
  readonly signerKid?: string;
  readonly representation?: RepresentationAssessment;
  readonly trust: TrustStore;
  /** Handler-owned persistent state for this operation (JSON only). */
  getState<T extends Json>(key: string): T | undefined;
  setState(key: string, value: Json): void;
  /** Append a handler-produced record (source authority, appraisal, access decision). */
  record<T extends { readonly type: string }>(record: T): void;
  /** Verify a protected statement against pinned keys of `role` (records the result). */
  verify<T>(
    jws: string,
    options: { typ: string; role: KeyRole; schema: z.ZodType<T> },
  ): Promise<StatementCheck<T>>;
  /** Source-authority assessment against the local rules (records the result). */
  assessSource(input: { source: Iri; claimType: string; subject?: Iri }): SourceAuthorityAssessment;
  /**
   * Assess a (possibly relayed) representation statement for a named actor and operation,
   * verified against the pinned PARTY key (records the result).
   */
  assessRepresentation(
    jws: string,
    expect: { actor: Iri; party?: Iri; operation: Iri; actorKid?: string },
  ): Promise<RepresentationAssessment>;
}

export interface OperationHandler {
  readonly description: OperationDescription;
  /** Validates proposal terms (negotiate) or invocation input (invoke). */
  readonly termsSchema?: z.ZodType<JsonObject>;
  readonly inputSchema?: z.ZodType<JsonObject>;
  /** Peer must present a representation statement covering this operation. */
  readonly requiresRepresentation: boolean;

  /** Initiator: the intent evaluated before sending an opening proposal. */
  intentForProposal?(ctx: HandlerContext, terms: JsonObject): ActionIntent;
  /** Initiator: the intent evaluated before sending an invocation. */
  intentForInvoke?(ctx: HandlerContext, input: JsonObject): ActionIntent | undefined;
  onProposal?(ctx: HandlerContext, body: ProposeBody): Promise<HandlerReply> | HandlerReply;
  /** Offeror: check the acceptor's selection is one the offer permitted. */
  validateSelection?(terms: JsonObject, selection: JsonObject | undefined): string | undefined;
  onAgreement?(
    ctx: HandlerContext,
    agreement: Agreement,
    role: "offeror" | "acceptor",
  ): Promise<AgreementPlan> | AgreementPlan;
  onInvoke?(
    ctx: HandlerContext,
    body: InvokeBody,
    evidence: readonly EvidenceItem[],
  ): Promise<HandlerReply> | HandlerReply;
  onDeliver?(
    ctx: HandlerContext,
    body: DeliverBody,
    evidence: readonly EvidenceItem[],
  ): Promise<HandlerReply> | HandlerReply;
  onReceipt?(ctx: HandlerContext, body: ReceiptBody): Promise<HandlerReply> | HandlerReply;
  onClosed?(
    ctx: HandlerContext,
    kind: "refuse" | "unsupported" | "indeterminate",
    reason: ReasonCode,
  ): void;
  /**
   * Initiator: inspect the peer's (untrusted, advisory) description before proceeding,
   * e.g. required discovery properties. Returns a problem to stop, or undefined.
   */
  vetDescription?(
    ctx: HandlerContext,
    description: JsonObject,
  ): { reason: ReasonCode; detail: string } | undefined;
  /** Extra description content visible to this requester (e.g. a restricted catalogue). */
  describeFor?(
    ctx: HandlerContext,
    evidence: readonly EvidenceItem[],
  ): Promise<JsonObject | undefined> | JsonObject | undefined;
}

export type EffectResult =
  | { readonly conclusion: "completed"; readonly observed: JsonObject }
  | { readonly conclusion: "not-executed"; readonly reason: string }
  | { readonly conclusion: "uncertain"; readonly reason: string };

/**
 * An external effect adapter. `execute` MUST be idempotent per key (a second call with a
 * key that already produced an effect returns that effect). `reconcile` MUST NOT create an
 * effect: it reports what exists for the key, or `not-executed` only when the adapter can
 * state authoritatively that nothing was done.
 */
export interface EffectAdapter {
  readonly id: string;
  execute(key: string, params: JsonObject): Promise<EffectResult>;
  /**
   * What exists for `key` at the provider. `params` are the planned effect's parameters, so
   * an adapter can check that a record it finds is the one this effect requested; missing or
   * contradictory evidence must be reported `uncertain`, never completed or not-executed.
   */
  reconcile(key: string, params?: JsonObject): Promise<EffectResult>;
}

export function operationKey(ref: OperationRef): string {
  return `${ref.id}@${ref.version}`;
}
