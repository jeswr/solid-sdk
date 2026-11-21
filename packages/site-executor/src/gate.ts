// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// The approval gate seam. The executor asks the host's Gate before it sends any
// request; the gate allows, asks the user (an ApprovalRequest) or denies. An
// approval is bound to a digest of exactly what will run (site, target, effect,
// resolved inputs, money fields); the executor recomputes the digest on retry and
// never honours an approval issued for different inputs.

import { createHash, randomUUID } from "node:crypto";
import type { ActionRequest, EffectClass, Operation } from "@jeswr/site-model";
import { SCHEMA } from "@jeswr/site-model";
import type { Target } from "./match.js";
import { BindingError } from "./values.js";

export interface GateRequest {
  site: string;
  target: Target;
  effect: EffectClass;
  /** Concrete operation inputs; flows also include $input.<name> and $step. */
  inputs: Record<string, string>;
  /** Authorized monetary total from wire mappings or trusted site facts (lexical decimal). */
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

function canonicalDecimal(value: string): string {
  const [whole = "0", fraction = ""] = value.replace(/^\+/, "").split(".");
  const negative = whole.startsWith("-");
  const digits = (negative ? whole.slice(1) : whole).replace(/^0+/, "") || "0";
  const tail = fraction.replace(/0+$/, "");
  const normalized = digits + (tail ? `.${tail}` : "");
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

/** Planner monetary claims; reject conflicting amounts or currencies across all common paths. */
export function moneyFields(request: ActionRequest): { amount?: string; currency?: string } {
  let amount: string | undefined;
  for (const path of MONEY_AMOUNT_PATHS) {
    for (const v of request
      .values(path.map((p) => SCHEMA + p))
      .filter((x) => DECIMAL.test(x.trim()))) {
      if (amount !== undefined && canonicalDecimal(amount) !== canonicalDecimal(v.trim()))
        throw new BindingError("conflicting planner monetary amounts");
      amount = v.trim();
    }
  }
  let currency: string | undefined;
  for (const path of MONEY_CURRENCY_PATHS) {
    for (const v of request
      .values(path.map((p) => SCHEMA + p))
      .filter((x) => /^[A-Za-z]{3}$/.test(x.trim()))) {
      const next = v.trim().toUpperCase();
      if (currency !== undefined && currency !== next)
        throw new BindingError("conflicting planner currencies");
      currency = next;
    }
  }
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
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
  /** Concrete request, execution position and session fingerprint (executor supplied). */
  binding?: unknown;
}): string {
  return createHash("sha256").update(canonicalJson(fields)).digest("hex");
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

/** Escape controls and bidi characters, after redaction, before capping display text. */
function clean(text: string, max = 80): string {
  const t = text
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: escape controls in approval text
      /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)} (truncated)` : t;
}

function formatAmount(amount: string): string {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount)) return amount;
  const [whole = "0", fraction = ""] = canonicalDecimal(amount).split(".");
  return `${whole || "0"}.${fraction.padEnd(2, "0")}`;
}

/** Plain-English summary, e.g. "Buy Trail Runner sneakers for GBP 20.00 on shop.test". */
export function summarise(
  request: ActionRequest,
  target: Target,
  site: string,
  money: { amount?: string; currency?: string },
  redact: (value: string) => string = (value) => value,
  context: {
    names?: string[];
    inputs?: Record<string, string>;
    operation?: Operation;
    selection?: boolean;
    identifiers?: [string, string][];
    targets?: Array<{ name: string; id: string }>;
  } = {},
): string {
  const host = new URL(site).host;
  const objectName = request.values([`${SCHEMA}object`, `${SCHEMA}name`])[0];
  const quote = (value: string) => JSON.stringify(clean(redact(value)));
  const verb = clean(verbFor(redact(target.actionType)));
  const names = context.names ?? [];
  const targetDisplays =
    context.targets?.map(({ name, id }) => `${quote(name)} (id ${quote(id)})`) ?? names.map(quote);
  const resolved =
    targetDisplays.slice(0, 5).join(", ") +
    (targetDisplays.length > 5 ? ` and ${targetDisplays.length - 5} more` : "");
  const identifying = Object.entries(context.inputs ?? {}).filter(([name]) => {
    const p = context.operation?.inputs.find((p) => p.name === name);
    return (
      /(?:^|[_[])(?:id|ids|sku|identifier|productID|orderNumber)(?:\]|$)/i.test(name) ||
      p?.path.some((iri) => /(?:object|identifier|sku|productID|orderNumber)$/.test(iri))
    );
  });
  const identifiers = context.identifiers ?? identifying;
  const fallback = identifiers.length ? identifiers : Object.entries(context.inputs ?? {});
  let what = objectName
    ? `${verb} ${quote(objectName)}`
    : resolved
      ? `${verb} ${resolved}`
      : `${quote(target.label)}${
          fallback.length
            ? ` (${fallback
                .slice(0, 5)
                .map(([name, value]) => `${quote(name)}=${quote(value)}`)
                .join(", ")})`
            : ""
        }`;
  if (context.selection && objectName && names.some((name) => name !== objectName))
    what += ` (resolved: ${resolved})`;
  if ((objectName || resolved) && identifiers.length)
    what += ` (${identifiers
      .slice(0, 5)
      .map(([name, value]) => `${quote(name)}=${quote(value)}`)
      .join(", ")})`;
  const price =
    money.amount !== undefined
      ? ` for ${money.currency ? `${clean(redact(money.currency))} ` : ""}${clean(formatAmount(redact(money.amount)), 120)}`
      : "";
  return `${what}${price} on ${clean(redact(host), 255)}`;
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
