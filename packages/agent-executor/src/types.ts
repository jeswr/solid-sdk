// AUTHORED-BY Codex GPT-6.1-Sol
import type { Approval, Mandate, MandateVerifier, PolicyEngine } from "@jeswr/agent-mandate";
import type { ActionProposal, AnyMessage, ControlStatement, ReceiptBody } from "@jeswr/agent-model";

// Structural send-only projection of ChannelBinding: importing its root is forbidden by layer lint.
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
/** Deliberately has no read capability. Compatible with the channels TokenProvider. */
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
    render(proposal: RenderableProposal, carriage: SendBinding["carriage"]): Promise<Wire>;
    validate(
      wire: Wire,
      proposal: RenderableProposal,
    ): Promise<{ ok: true } | { ok: false; reason: string }>;
    transmit(
      wire: Wire,
      io: {
        readonly account: AccountRef;
        readonly tokens: TokenProvider;
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
export interface Receipt {
  readonly proposal: string;
  readonly conversation: string;
  readonly kind: "receipt";
  readonly body: ReceiptBody;
}
/** Actor statuses confer no authority. This adapter writes only executor-owned outbox resources. */
export interface ProposalStore {
  get(id: string): Promise<OutboxEntry | undefined>;
  queued(): Promise<readonly string[]>;
  writeDisposition(id: string, result: Disposition): Promise<void>;
  /** Idempotent upsert keyed by proposal + outcome; does not bypass the transmission gate. */
  emitReceipt(receipt: Receipt): Promise<void>;
}
export interface ApprovalContext {
  readonly proposal: string;
  readonly termsDigest: string;
  readonly ownerWebId: string;
  readonly now: Date;
}
/** Must verify owner WebID assertionMethod proofs (agent-mandate.verifyApproval), never parse-only. */
export interface ApprovalStore {
  findVerified(context: ApprovalContext): Promise<readonly Approval[]>;
}
/** listVerified must verify owner proofs before returning any control statement. */
export interface ControlStore {
  listVerified(ownerWebId: string): Promise<readonly ControlStatement[]>;
  /** Check the local HALT file on EVERY gate pass; errors fail closed. */
  haltFileExists(): Promise<boolean>;
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
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly underMandate: string;
  readonly underApproval?: string;
  readonly providerRef?: string;
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
