// AUTHORED-BY Claude Opus 5.5
/** Shared fixtures for the gate and approval tests. */
import type { GateInput, PrincipalPolicy } from "../src/gate.js";
import { money } from "../src/money.js";
import type { SpendingRule } from "../src/rules.js";
import type { DataField, Party, PurchaseAction, ShareAction, StepUpAction } from "../src/types.js";

export const NOW = new Date("2026-11-13T12:00:00.000Z");
export const usd = (n: number | string) => money(n, "USD");

export const POLICY: PrincipalPolicy = {
  purchaseCategories: ["shoes", "clothing"],
  singleActionCeiling: usd(500),
  neverShare: ["identity-document"],
  maxRetentionDays: 90,
};

export function party(over: Partial<Party> = {}): Party {
  return {
    id: "store:stride",
    name: "Stride & Co",
    established: "own-list",
    history: { purchases: 0, shares: 0 },
    ...over,
  };
}

export function purchase(over: Partial<PurchaseAction> = {}): PurchaseAction {
  return {
    type: "purchase",
    recipient: party(),
    category: "shoes",
    items: [{ name: "Roadrunner Lite", variant: "size 9, grey", qty: 1, price: usd(20) }],
    fees: [],
    total: usd(20),
    paymentLabel: "Card ending 4417",
    reversibility: "refundable",
    origin: "principal-request",
    ...over,
  };
}

export function field(over: Partial<DataField> = {}): DataField {
  return {
    id: "income",
    kind: "income",
    label: "Income",
    preview: "Net pay",
    source: "From Paywell",
    sensitivity: "financial",
    required: true,
    state: "offered",
    ...over,
  };
}

export function share(over: Partial<ShareAction> = {}): ShareAction {
  return {
    type: "share",
    recipient: party({ id: "lender:north", name: "North Bank", established: "register" }),
    fields: [field(), field({ id: "balance", kind: "balance", label: "Bank balance" })],
    terms: { purpose: "Mortgage application", retentionDays: 90 },
    origin: "principal-request",
    ...over,
  };
}

export function stepUp(over: Partial<StepUpAction> = {}): StepUpAction {
  return {
    type: "step-up",
    recipient: party({ id: "bank:harbour", name: "Harbour Bank", established: "root" }),
    releases: "your bank balance",
    goesTo: "Your agent, then North Bank",
    method: "face-check",
    performedBy: "The identity provider",
    validMinutes: 15,
    origin: "agent-plan",
    ...over,
  };
}

export const budget: SpendingRule = {
  id: "rule:budget",
  kind: "budget",
  period: "month",
  limit: usd(100),
  scope: { kind: "merchant", merchant: "store:stride", label: "Stride & Co" },
  createdAt: "2026-11-01T00:00:00.000Z",
};

export function input(over: Partial<GateInput> = {}): GateInput {
  return {
    action: purchase(),
    digest: "sha256:abc",
    policy: POLICY,
    rules: [],
    records: [],
    approvals: new Set(),
    attestations: new Set(),
    now: NOW,
    ...over,
  };
}
