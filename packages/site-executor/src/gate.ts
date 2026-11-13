// AUTHORED-BY Claude Opus 5.5
// The approval gate seam. The executor asks the host's Gate before it sends any
// request; the gate allows, asks the user (an ApprovalRequest) or denies. An
// approval is bound to a digest of exactly what will run (site, target, effect,
// resolved inputs, money fields); the executor recomputes the digest on retry and
// never honours an approval issued for different inputs.

import { createHash, randomUUID } from "node:crypto";
import type { ActionRequest, EffectClass } from "@jeswr/site-model";
import { SCHEMA } from "@jeswr/site-model";
import type { Target } from "./match.js";

export interface GateRequest {
  site: string;
  target: Target;
  effect: EffectClass;
  /** Resolved input values, keyed by parameter name (flow inputs for a flow). */
  inputs: Record<string, string>;
  /** Price or amount from the action request, when present (lexical decimal). */
  amount?: string;
  currency?: string;
  /** Plain-English description, e.g. "Buy Trail Runner sneakers for GBP 20.00 on shop.test". */
  summary: string;
  /** Binding digest of everything above except the summary. */
  digest: string;
  /** Set when the caller retries with an approval this executor issued for the same digest. */
  approvalId?: string;
}

export interface ApprovalRequest {
  id: string;
  summary: string;
  effect: EffectClass;
  site: string;
  target: Target;
  amount?: string;
  currency?: string;
  inputs: Record<string, string>;
  /** The binding digest the approval is valid for. */
  digest: string;
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "ask"; approval: ApprovalRequest }
  | { kind: "deny"; reason: string };

export interface Gate {
  authorize(req: GateRequest): Promise<GateDecision>;
}

const MONEY_AMOUNT_PATHS: readonly (readonly string[])[] = [
  ["price"],
  ["object", "offers", "price"],
  ["object", "price"],
  ["priceSpecification", "price"],
  ["priceSpecification", "maxPrice"],
  ["amount", "value"],
  ["amount"],
  ["totalPaymentDue", "value"],
  ["totalPaymentDue", "price"],
];

const MONEY_CURRENCY_PATHS: readonly (readonly string[])[] = [
  ["priceCurrency"],
  ["object", "offers", "priceCurrency"],
  ["object", "priceCurrency"],
  ["priceSpecification", "priceCurrency"],
  ["amount", "currency"],
  ["currency"],
  ["totalPaymentDue", "currency"],
  ["totalPaymentDue", "priceCurrency"],
];

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Money fields from the action request (first path that yields a decimal amount / currency code). */
export function moneyFields(request: ActionRequest): { amount?: string; currency?: string } {
  let amount: string | undefined;
  for (const path of MONEY_AMOUNT_PATHS) {
    const v = request.values(path.map((p) => SCHEMA + p)).find((x) => DECIMAL.test(x.trim()));
    if (v !== undefined) {
      amount = v.trim();
      break;
    }
  }
  let currency: string | undefined;
  for (const path of MONEY_CURRENCY_PATHS) {
    const v = request
      .values(path.map((p) => SCHEMA + p))
      .find((x) => /^[A-Za-z]{3}$/.test(x.trim()));
    if (v !== undefined) {
      currency = v.trim().toUpperCase();
      break;
    }
  }
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over a canonical JSON encoding of what the approval covers. */
export function approvalDigest(fields: {
  site: string;
  modelVersion: string;
  target: Target;
  effect: EffectClass;
  inputs: Record<string, string>;
  amount?: string;
  currency?: string;
  persona?: string;
}): string {
  return createHash("sha256").update(canonical(fields)).digest("hex");
}

const VERBS: Readonly<Record<string, string>> = {
  BuyAction: "Buy",
  OrderAction: "Order",
  PayAction: "Pay for",
  AddToCartAction: "Add to cart",
  RentAction: "Rent",
  ReserveAction: "Reserve",
  DeleteAction: "Delete",
  CommentAction: "Post a comment on",
  ReviewAction: "Post a review of",
  SubscribeAction: "Subscribe to",
  RegisterAction: "Register for",
  SendAction: "Send",
  UpdateAction: "Update",
  CreateAction: "Create",
  SearchAction: "Search",
  ViewAction: "View",
  ApplyAction: "Apply for",
  DonateAction: "Donate to",
  CancelAction: "Cancel",
};

function verbFor(actionType: string): string {
  const local = actionType.startsWith(SCHEMA) ? actionType.slice(SCHEMA.length) : actionType;
  return VERBS[local] ?? local.replace(/Action$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Strip control characters and cap the length of text going into a summary. */
function clean(text: string, max = 80): string {
  const t = text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control and bidi characters is the point
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function formatAmount(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

/** Plain-English summary, e.g. "Buy Trail Runner sneakers for GBP 20.00 on shop.test". */
export function summarise(
  request: ActionRequest,
  target: Target,
  site: string,
  money: { amount?: string; currency?: string },
): string {
  const host = new URL(site).host;
  const objectName = request.values([`${SCHEMA}object`, `${SCHEMA}name`])[0];
  const subject = objectName ? clean(objectName) : clean(target.label);
  const verb = verbFor(target.actionType);
  const what = objectName ? `${verb} ${subject}` : subject;
  const price =
    money.amount !== undefined
      ? ` for ${money.currency ? `${money.currency} ` : ""}${formatAmount(money.amount)}`
      : "";
  return `${what}${price} on ${host}`;
}

export function newApprovalId(): string {
  return `urn:uuid:${randomUUID()}`;
}

export function approvalFor(req: GateRequest, id: string = newApprovalId()): ApprovalRequest {
  return {
    id,
    summary: req.summary,
    effect: req.effect,
    site: req.site,
    target: { ...req.target },
    inputs: { ...req.inputs },
    digest: req.digest,
    ...(req.amount !== undefined ? { amount: req.amount } : {}),
    ...(req.currency !== undefined ? { currency: req.currency } : {}),
  };
}

export interface ApprovalGate extends Gate {
  /** Record the user's yes for an approval this gate issued. */
  approve(approvalId: string): boolean;
  /** Record the user's no; a retry with this id is denied. */
  reject(approvalId: string, reason?: string): boolean;
  /** Approvals waiting for an answer. */
  pending(): ApprovalRequest[];
}

/**
 * The default gate: reads are allowed, everything else asks. Approvals are
 * single-use and bound to the request digest; `approve(id)` lets a retry through.
 */
export function createApprovalGate(options: { allowReads?: boolean } = {}): ApprovalGate {
  const allowReads = options.allowReads ?? true;
  const issued = new Map<
    string,
    { approval: ApprovalRequest; state: "pending" | "approved" | "rejected"; reason?: string }
  >();
  return {
    async authorize(req) {
      if (req.effect === "read" && allowReads) return { kind: "allow" };
      if (req.approvalId !== undefined) {
        const entry = issued.get(req.approvalId);
        if (entry && entry.approval.digest === req.digest) {
          if (entry.state === "approved") {
            issued.delete(req.approvalId);
            return { kind: "allow" };
          }
          if (entry.state === "rejected") {
            issued.delete(req.approvalId);
            return { kind: "deny", reason: entry.reason ?? "The user declined this action." };
          }
          return { kind: "ask", approval: entry.approval };
        }
      }
      const approval = approvalFor(req);
      issued.set(approval.id, { approval, state: "pending" });
      return { kind: "ask", approval };
    },
    approve(approvalId) {
      const entry = issued.get(approvalId);
      if (entry?.state !== "pending") return false;
      entry.state = "approved";
      return true;
    },
    reject(approvalId, reason) {
      const entry = issued.get(approvalId);
      if (entry?.state !== "pending") return false;
      entry.state = "rejected";
      if (reason !== undefined) entry.reason = reason;
      return true;
    },
    pending() {
      return [...issued.values()].filter((e) => e.state === "pending").map((e) => e.approval);
    },
  };
}
