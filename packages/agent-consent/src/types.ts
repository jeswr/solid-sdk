// AUTHORED-BY Claude Opus 5.5
/**
 * The engine/UI contract of a consumer Answerable agent (design of record:
 * consumer-agent/design.md section 9). Amounts are integer minor units (money.ts).
 */
import type { Money } from "./money.js";
import type { BudgetPeriod, RuleScope, SpendingRuleKind } from "./rules.js";

export type OutboundCheck =
  | "mandate"
  | "recipient"
  | "disclosure"
  | "data-terms"
  | "limits-and-approval"
  | "evidence";
export type InboundCheck = "integrity" | "source" | "authority" | "terms" | "fitness";
export type CheckResult = "pass" | "ask" | "fail" | "not-applicable" | "pending";
export type Outcome = "go" | "ask" | "stop";
export type Sensitivity = "none" | "personal" | "financial" | "special";
export type Reversibility = "reversible" | "refundable" | "costly" | "irreversible";
export type Confirm = "tap" | "hold" | "step-up";
export type Origin = "principal-request" | "agent-plan" | "content";

export type ApprovalKind =
  | "purchase"
  | "new-recipient"
  | "disclosure"
  | "data-terms"
  | "limit-exceeded"
  | "step-up"
  | "ask-for-more"
  | "sign-in";

export interface Party {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly established: "own-list" | "root" | "register" | "not-established";
  /** How the party was looked up (own list, then a root, then a register); kept with the decision. */
  readonly lookupPath?: readonly string[];
  readonly history: { readonly purchases: number; readonly shares: number };
}

export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: "changed" | "over";
}

export interface LineItem {
  readonly name: string;
  readonly variant?: string;
  readonly qty: number;
  readonly price: Money;
  readonly image?: string;
}

export interface DataField {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly preview: string;
  readonly source: string;
  readonly sensitivity: Sensitivity;
  readonly required: boolean;
  readonly state: "offered" | "withheld-by-gate";
  readonly withheldReason?: string;
}

export interface DataTerms {
  readonly purpose: string;
  readonly retentionDays?: number;
  readonly onwardSharing?: string;
  readonly prohibitedUses?: readonly string[];
}

export interface PurchaseAction {
  readonly type: "purchase";
  readonly recipient: Party;
  readonly category: string;
  readonly items: readonly LineItem[];
  readonly fees: readonly { readonly label: string; readonly amount: Money }[];
  readonly total: Money;
  readonly paymentLabel: string;
  readonly delivery?: string;
  readonly returns?: string;
  readonly reversibility: Reversibility;
  readonly origin: Origin;
}

export interface ShareAction {
  readonly type: "share";
  readonly recipient: Party;
  readonly fields: readonly DataField[];
  readonly terms: DataTerms;
  readonly origin: Origin;
  /** The sector profile requires the principal to approve each sharing. */
  readonly eachTimeApproval?: boolean;
}

export interface StepUpAction {
  readonly type: "step-up";
  readonly recipient: Party;
  /** What the recipient releases once the step-up is done. */
  readonly releases: string;
  readonly goesTo: string;
  readonly method: "face-check" | "passkey";
  readonly performedBy: string;
  readonly validMinutes: number;
  readonly origin: Origin;
}

export type ProposedAction = PurchaseAction | ShareAction | StepUpAction;

export interface CheckLine {
  readonly check: OutboundCheck | InboundCheck;
  readonly result: CheckResult;
  readonly plain: string;
  readonly code?: string;
}

export interface MeterState {
  readonly ruleId: string;
  readonly label: string;
  readonly used: Money;
  readonly limit: Money;
  /** Used after this action, which may exceed the limit. */
  readonly after: Money;
  readonly resetsAt?: string;
}

/** A spending rule the principal is about to set (no id or timestamps yet). */
export interface RuleDraft {
  readonly kind: SpendingRuleKind;
  readonly limit: Money;
  readonly period?: BudgetPeriod;
  readonly perPurchaseMax?: Money;
  readonly scope: RuleScope;
  /** ISO instant, or absent for "until I turn it off" / "when used up". */
  readonly expiresAt?: string;
}

export type ResponseType =
  | "approve-once"
  | "deny"
  | "set-limit"
  | "raise-limit"
  | "trust-recipient"
  | "share-less"
  | "step-up-done";

export interface OfferedResponse {
  readonly id: string;
  readonly type: ResponseType;
  /** Button text, written by the gate. */
  readonly label: string;
  readonly role: "primary" | "standing" | "deny";
  readonly confirm: Confirm;
  /** For set-limit / raise-limit: the editor's starting point. */
  readonly draft?: RuleDraft;
  /** For set-limit / raise-limit: amount chips, in minor units. */
  readonly suggested?: readonly number[];
  /** For raise-limit: the rule being changed. */
  readonly replacesRuleId?: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly kind: ApprovalKind;
  readonly gate: "outbound" | "inbound";
  readonly askingCheck: OutboundCheck | InboundCheck;
  readonly reason: string;
  readonly title: string;
  readonly plainReason: string;
  readonly facts: readonly Fact[];
  readonly action: ProposedAction;
  readonly digest: string;
  readonly meter?: MeterState;
  readonly checks: readonly CheckLine[];
  readonly sensitivity: Sensitivity;
  readonly reversibility: Reversibility;
  readonly binding: boolean;
  readonly origin: Origin;
  /** Shown as a caption when no standing option is offered. */
  readonly standingWithheldReason?: string;
  /** "You have approved Stride & Co 2 times." when that changed the emphasis. */
  readonly historyNote?: string;
  readonly offered: readonly OfferedResponse[];
}

export type PrincipalResponse =
  | { readonly type: "approve-once"; readonly offeredId: string }
  | { readonly type: "deny"; readonly offeredId: string }
  | {
      readonly type: "set-limit" | "raise-limit";
      readonly offeredId: string;
      readonly draft: RuleDraft;
    }
  | { readonly type: "trust-recipient"; readonly offeredId: string }
  | { readonly type: "share-less"; readonly offeredId: string; readonly keep: readonly string[] }
  | { readonly type: "step-up-done"; readonly offeredId: string; readonly attestation: string };
