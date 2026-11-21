// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Approval, Mandate, MandateVerifier, PolicyEngine } from "@jeswr/agent-mandate";
import type {
  ActionProposal,
  AnyMessage,
  ControlStatement,
  TransmissionSettlement,
} from "@jeswr/agent-model";

export type { TransmissionSettlement } from "@jeswr/agent-model";

// Send-only projection with action validation: channel root imports are forbidden by layer lint.
export interface Wire {
  readonly bytes: string;
  readonly mediaType: string;
  readonly digest: string;
}
export interface RenderableProposal {
  readonly message: AnyMessage;
  readonly compactJws: string;
}
export interface AccountRef {
  readonly id: string;
}
export interface SendGrant {
  readonly access: "send";
  readonly accessToken: string;
}
/** Deliberately has no read capability. Compatible with the channels send token projection. */
export interface TokenProvider {
  send(account: AccountRef): Promise<SendGrant>;
}
export type SendResult =
  | { readonly outcome: "accepted"; readonly providerRef: string }
  | { readonly outcome: "rejected"; readonly detail: string };
export type LookupResult =
  | { readonly outcome: "found"; readonly providerRef: string }
  | { readonly outcome: "absent" }
  | { readonly outcome: "unknown"; readonly detail: string };
export interface SendBinding {
  readonly id: string;
  readonly carriage: {
    readonly id: string;
    readonly structured:
      | "mime-part"
      | "metadata-field"
      | "event-content"
      | "footer-url-only"
      | "native";
    readonly envelopeMediaType?: string;
    readonly footer: "required" | "optional" | "none";
    readonly maxBytes: number;
  };
  readonly send: {
    /** Pure, bounded wire parser: exact human-visible text, never re-rendered from the proposal. */
    preview(wire: Wire): Promise<string>;
    render(proposal: RenderableProposal, carriage: SendBinding["carriage"]): Promise<Wire>;
    /** Trusted validator must bind every intent term and account to the signed wire/destination. */
    validate(
      wire: Wire,
      context: {
        readonly renderable: RenderableProposal;
        readonly intent: ActionProposal["intent"];
        readonly account: AccountRef;
      },
    ): Promise<{ ok: true } | { ok: false; reason: string }>;
    transmit(
      wire: Wire,
      io: {
        readonly account: AccountRef;
        readonly tokens: TokenProvider;
        /** Required immediately before each effect, with no intervening await. */
        readonly assertAuthority: () => void;
        readonly dryRun: boolean;
      },
    ): Promise<SendResult>;
    lookup?(wire: Wire): Promise<LookupResult>;
    readonly finalAbsence?: true;
    /** Honoured exclusively for id === "a2a". */
    readonly idempotentResend?: true;
  };
}
export interface OutboxEntry {
  readonly proposal: ActionProposal;
  readonly renderable: RenderableProposal;
  readonly account: AccountRef;
  readonly wire: Wire;
  readonly wireDigest: string;
}
export type Disposition =
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "prohibited"; readonly reason: "prohibition" }
  | { readonly status: "awaiting-approval" | "confirm-required" | "ready"; readonly reason: string }
  | { readonly status: "sent" | "not-sent" | "uncertain"; readonly reason: string };
/** Actor statuses confer no authority. This adapter writes only executor-owned outbox resources. */
export interface ProposalStore {
  get(id: string): Promise<OutboxEntry | undefined>;
  queued(): Promise<readonly string[]>;
  writeDisposition(id: string, result: Disposition): Promise<void>;
  /** Idempotent local event upsert keyed by proposal + status; never a protocol receipt. */
  emitTransmission(settlement: TransmissionSettlement): Promise<void>;
}
export interface ApprovalContext {
  readonly proposal: string;
  readonly termsDigest: string;
  readonly ownerWebId: string;
  readonly now: Date;
}
/**
 * Must verify owner WebID assertionMethod proofs (agent-mandate.verifyApproval), never parse-only.
 * The host MUST call onApprovalChange for every detected approval-store change (including
 * denials, removals and availability changes) to invalidate in-flight authority snapshots.
 */
export interface ApprovalStore {
  findVerified(context: ApprovalContext): Promise<readonly Approval[]>;
}
/** listVerified must verify owner proofs before returning any control statement. */
export interface ControlStore {
  listVerified(ownerWebId: string): Promise<readonly ControlStatement[]>;
  /** Check the local HALT file on EVERY gate pass; errors fail closed. */
  haltFileExists(): Promise<boolean>;
  /** Synchronous local-file check at the final dispatch fence; throw on halt or read failure. */
  assertNotHalted(): void;
}
export interface Clock {
  now(): Date;
}
export type TransmissionStatus = "attempting" | "sent" | "not-sent" | "uncertain";
export interface TransmissionRecord {
  readonly proposal: string;
  readonly binding: string;
  readonly account: string;
  readonly wireDigest: string;
  readonly termsDigest: string;
  readonly status: TransmissionStatus;
  readonly attempts: number;
  /** Monotonic per-proposal durable write sequence. Missing on legacy records (zero). */
  readonly sequence?: number;
  readonly startedAt: string;
  readonly committedAt: string;
  readonly updatedAt: string;
  readonly underMandate: string;
  readonly underApproval?: string;
  readonly providerRef?: string;
  readonly conversation: string;
  readonly recipientHash: string;
  /** The committed obligation, including invoke amounts, never just settled payments. */
  readonly amount: { readonly value: number; readonly currency: string };
}
/**
 * Executor-owned, never Actor-writable. exclusive must serialize ALL executors sharing the
 * store (including accounting and claims). put must atomically replace AND fsync before
 * resolving. A crash after put leaves attempting, which is unresolved on restart.
 */
export interface TransmissionStore {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  get(proposal: string): Promise<TransmissionRecord | undefined>;
  list(): Promise<readonly TransmissionRecord[]>;
  put(record: TransmissionRecord): Promise<void>;
}
export interface AuditRecord {
  readonly type: "decision" | "tamper-suspected" | "transmission";
  readonly proposal: string;
  readonly at: string;
  readonly outcome: string;
  readonly wireDigest?: string;
  readonly underMandate?: string;
  readonly underApproval?: string;
  readonly transmission?: TransmissionRecord;
}
/** System-only writer; listCommitted returns historical transmission records, never message bodies. */
export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
  listCommitted(): Promise<readonly TransmissionRecord[]>;
}
/** Extensions must come from the signed credential, never daemon configuration. */
export interface AccountingMandate extends Mandate {
  readonly currency?: string;
}
export interface ExecutorOptions {
  readonly ownerWebId: string;
  readonly agentWebId: string;
  readonly proposals: ProposalStore;
  readonly approvals: ApprovalStore;
  readonly mandates: MandateVerifier & { load(): Promise<AccountingMandate | undefined> };
  readonly policy: PolicyEngine;
  readonly controls: ControlStore;
  readonly clock: Clock;
  readonly tokens: TokenProvider;
  readonly bindings: Readonly<Record<string, SendBinding>>;
  readonly transmissions: TransmissionStore;
  readonly audit: AuditSink;
  /** Both executor and binding default to dry-run. */
  readonly dryRun?: boolean;
  readonly timeoutMs?: number;
}
export type TransmitResult =
  | Disposition
  | { readonly status: "duplicate"; readonly providerRef?: string };
