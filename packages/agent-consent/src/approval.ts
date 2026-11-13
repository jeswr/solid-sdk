// AUTHORED-BY Claude Opus 5.5
/**
 * Dynamic approval requests. When the outbound gate asks the principal, this module writes
 * the request they see: the title, the facts and the responses on offer. All of it is
 * derived from the action and the gate's decision (CORE-OUT-7); the model only writes the
 * chat line before it. The rules for what is offered follow design section 3:
 *
 * - the responses come only from `offered`; the UI never invents one, and `checkResponse`
 *   refuses anything not offered, anything expired, and any malformed limit;
 * - standing permission (a spending limit) is withheld for irreversible or very large
 *   purchases, unestablished recipients, content-originated proposals, step-ups, sector
 *   profiles that need each approval, and after the principal declined it twice;
 * - confirmation strength is a tap only for small reversible purchases from a known store.
 */

import type { GateResult } from "./gate.js";
import { formatMoney, type Money } from "./money.js";
import { isSpendingRule, type SpendingRule } from "./rules.js";
import { defaultDraft, describeRule, raisedAmounts, suggestedAmounts } from "./summary.js";
import type {
  ApprovalRequest,
  CheckLine,
  Confirm,
  Fact,
  MeterState,
  OfferedResponse,
  PrincipalResponse,
  PurchaseAction,
  RuleDraft,
  Sensitivity,
  ShareAction,
  StepUpAction,
} from "./types.js";

export const APPROVAL_TTL_MS = 10 * 60_000;
/** Above this a purchase never gets a standing option (the profile's single-action ceiling). */
export const STANDING_CEILING_MINOR = 50_000;
/** Below this a reversible purchase from a known store is confirmed with a tap. */
export const TAP_CEILING_MINOR = 5_000;

export interface BuildContext {
  readonly id: string;
  readonly digest: string;
  readonly now: Date;
  /** How many times the principal declined a standing option in this conversation. */
  readonly declinedStanding?: number;
}

const DENY: OfferedResponse = {
  id: "deny",
  type: "deny",
  label: "Not now",
  role: "deny",
  confirm: "tap",
};

function itemsText(a: PurchaseAction): string {
  const names = a.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name));
  return names.length <= 2 ? names.join(" and ") : `${names.length} items`;
}

function purchaseFacts(a: PurchaseAction): Fact[] {
  const facts: Fact[] = [{ label: "Store", value: a.recipient.name }];
  for (const item of a.items)
    facts.push({
      label: "Item",
      value: `${item.qty > 1 ? `${item.qty} × ` : ""}${item.name}${item.variant ? `, ${item.variant}` : ""}`,
    });
  const subtotal = a.items.reduce((s, i) => s + i.price.minor * i.qty, 0);
  facts.push({
    label: "Price",
    value: formatMoney({ minor: subtotal, currency: a.total.currency }),
  });
  for (const fee of a.fees)
    if (fee.amount.minor > 0) facts.push({ label: fee.label, value: formatMoney(fee.amount) });
  if (a.delivery) facts.push({ label: "Delivery", value: a.delivery });
  facts.push({ label: "Total", value: formatMoney(a.total) });
  facts.push({ label: "Pay with", value: a.paymentLabel });
  if (a.returns) facts.push({ label: "Returns", value: a.returns });
  return facts;
}

function purchaseConfirm(a: PurchaseAction): Confirm {
  return a.total.minor < TAP_CEILING_MINOR &&
    (a.reversibility === "reversible" || a.reversibility === "refundable") &&
    a.recipient.established !== "not-established"
    ? "tap"
    : "hold";
}

/** Why no standing option is offered, or undefined when one may be. */
export function standingWithheld(a: PurchaseAction, declined: number): string | undefined {
  if (a.origin === "content")
    return "This came from page content, so it can only be approved once.";
  if (a.reversibility === "irreversible") return "This cannot be undone, so I will ask every time.";
  if (a.total.minor > STANDING_CEILING_MINOR)
    return `Purchases over ${formatMoney({ minor: STANDING_CEILING_MINOR, currency: a.total.currency })} always need your OK.`;
  if (a.recipient.established === "not-established")
    return `A limit can be set once ${a.recipient.name} is confirmed.`;
  if (declined >= 2)
    return "You chose not to set a limit here, so I will not offer it again in this chat.";
  return undefined;
}

function meterFrom(gate: GateResult, total: Money): MeterState | undefined {
  const spend = gate.spend;
  if (!spend || spend.outcome === "no-rule") return undefined;
  const u = spend.usage;
  return {
    ruleId: u.rule.id,
    label: describeRule(u.rule).replace(/^your /, ""),
    used: u.used,
    limit: u.rule.limit,
    after: { minor: u.used.minor + total.minor, currency: total.currency },
    ...(u.resetsAt ? { resetsAt: u.resetsAt } : {}),
  };
}

function base(ctx: BuildContext, gate: GateResult) {
  const decided = gate.decidedBy as NonNullable<GateResult["decidedBy"]>;
  return {
    id: ctx.id,
    createdAt: ctx.now.toISOString(),
    expiresAt: new Date(ctx.now.getTime() + APPROVAL_TTL_MS).toISOString(),
    gate: "outbound" as const,
    askingCheck: decided.check,
    reason: decided.reason,
    digest: ctx.digest,
    checks: gate.checks,
    binding: false,
  };
}

/** The asking check's sentence; buildApprovalRequest only runs when the gate asked. */
function plainOf(gate: GateResult): string {
  return (gate.checks.find((c) => c.result === "ask") as CheckLine).plain;
}

function purchaseRequest(a: PurchaseAction, gate: GateResult, ctx: BuildContext): ApprovalRequest {
  const confirm = purchaseConfirm(a);
  const withheld = standingWithheld(a, ctx.declinedStanding ?? 0);
  const meter = meterFrom(gate, a.total);
  const common = {
    ...base(ctx, gate),
    plainReason: plainOf(gate),
    action: a,
    sensitivity: "personal" as Sensitivity,
    reversibility: a.reversibility,
    origin: a.origin,
    ...(withheld ? { standingWithheldReason: withheld } : {}),
  };
  if (gate.kind === "limit-exceeded" && gate.spend?.outcome === "exceeds" && meter) {
    const rule = gate.spend.usage.rule;
    const needed =
      rule.kind === "per-purchase" ? a.total.minor : gate.spend.usage.used.minor + a.total.minor;
    const over = Math.max(0, needed - rule.limit.minor);
    const suggested = raisedAmounts(rule.limit, needed);
    const raise: OfferedResponse | undefined = withheld
      ? undefined
      : {
          id: "raise-limit",
          type: "raise-limit",
          label: "Raise limit",
          role: "standing",
          confirm: "hold",
          replacesRuleId: rule.id,
          suggested,
          draft: {
            kind: rule.kind,
            limit: { minor: suggested[0] as number, currency: rule.limit.currency },
            scope: rule.scope,
            ...(rule.period ? { period: rule.period } : {}),
            ...(rule.perPurchaseMax && rule.perPurchaseMax.minor >= a.total.minor
              ? { perPurchaseMax: rule.perPurchaseMax }
              : {}),
            ...(rule.expiresAt ? { expiresAt: rule.expiresAt } : {}),
          },
        };
    const left = Math.max(0, rule.limit.minor - gate.spend.usage.used.minor);
    const plainReason =
      rule.kind === "per-purchase"
        ? `Your limit is ${formatMoney(rule.limit)} for each purchase.`
        : `${formatMoney({ minor: left, currency: rule.limit.currency })} of your limit is left${rule.kind === "budget" ? ` this ${rule.period}` : ""}.`;
    return {
      ...common,
      plainReason,
      kind: "limit-exceeded",
      title: `This goes over ${describeRule(rule)}${over > 0 ? ` by ${formatMoney({ minor: over, currency: a.total.currency })}` : ""}`,
      facts: [
        ...a.items.map((i) => ({
          label: "Item",
          value: `${i.name}${i.variant ? `, ${i.variant}` : ""}`,
        })),
        { label: "Total", value: formatMoney(a.total) },
        ...(rule.kind === "per-purchase"
          ? [{ label: "Your limit", value: `${formatMoney(rule.limit)} per purchase` }]
          : [
              {
                label: `Used ${rule.kind === "budget" ? `this ${rule.period}` : "so far"}`,
                value: formatMoney(gate.spend.usage.used),
              },
              {
                label: "After this",
                value: formatMoney({ minor: needed, currency: a.total.currency }),
                emphasis: "over" as const,
              },
            ]),
      ],
      meter,
      offered: [
        {
          id: "once",
          type: "approve-once",
          label: "Just this once",
          role: "primary",
          confirm: "hold",
        },
        ...(raise ? [raise] : []),
        DENY,
      ],
    };
  }
  const known = a.recipient.history.purchases;
  const preferLimit = !withheld && known >= 2 && a.reversibility !== "irreversible";
  const setLimit: OfferedResponse | undefined =
    withheld || a.recipient.established === "not-established"
      ? undefined
      : {
          id: "set-limit",
          type: "set-limit",
          label: "Set a spending limit",
          role: preferLimit ? "primary" : "standing",
          confirm: "hold",
          draft: defaultDraft(
            a.total,
            { kind: "merchant", merchant: a.recipient.id, label: a.recipient.name },
            ctx.now,
          ),
          suggested: suggestedAmounts(a.total),
        };
  const kind = gate.kind === "new-recipient" ? "new-recipient" : "purchase";
  return {
    ...common,
    kind,
    title:
      kind === "new-recipient"
        ? `Deal with ${a.recipient.name} for the first time?`
        : `Buy ${itemsText(a)} for ${formatMoney(a.total)}?`,
    facts: purchaseFacts(a),
    ...(meter ? { meter } : {}),
    ...(preferLimit
      ? { historyNote: `You have approved ${a.recipient.name} ${known} times.` }
      : {}),
    offered: [
      {
        id: "once",
        type: "approve-once",
        label: kind === "new-recipient" ? "Allow this time" : "Approve once",
        role: preferLimit ? "standing" : "primary",
        confirm,
      },
      ...(setLimit ? [setLimit] : []),
      DENY,
    ],
  };
}

const SENSITIVITY_ORDER: readonly Sensitivity[] = ["none", "personal", "financial", "special"];

function shareRequest(a: ShareAction, gate: GateResult, ctx: BuildContext): ApprovalRequest {
  const offeredFields = a.fields.filter((f) => f.state === "offered");
  const sensitivity = offeredFields.reduce<Sensitivity>(
    (max, f) =>
      SENSITIVITY_ORDER.indexOf(f.sensitivity) > SENSITIVITY_ORDER.indexOf(max)
        ? f.sensitivity
        : max,
    "none",
  );
  const n = offeredFields.length;
  const optional = offeredFields.some((f) => !f.required);
  const facts: Fact[] = [{ label: "Purpose", value: a.terms.purpose }];
  if (a.terms.retentionDays !== undefined)
    facts.push({ label: "Kept for", value: `Up to ${a.terms.retentionDays} days, then deleted` });
  if (a.terms.onwardSharing) facts.push({ label: "Passed on to", value: a.terms.onwardSharing });
  if (a.terms.prohibitedUses?.length)
    facts.push({ label: "Not used for", value: a.terms.prohibitedUses.join(", ") });
  const withheld =
    a.eachTimeApproval === true
      ? "This kind of sharing needs your OK each time."
      : sensitivity === "financial" || sensitivity === "special"
        ? "Financial and sensitive data always needs your OK."
        : "Standing permission for sharing is not offered yet.";
  return {
    ...base(ctx, gate),
    kind: "disclosure",
    title: `Share ${n === 1 ? "1 thing" : `${n} things`} with ${a.recipient.name}?`,
    plainReason: plainOf(gate),
    facts,
    action: a,
    sensitivity,
    reversibility: "irreversible",
    origin: a.origin,
    standingWithheldReason: withheld,
    offered: [
      { id: "share", type: "approve-once", label: `Share ${n}`, role: "primary", confirm: "hold" },
      ...(optional
        ? [
            {
              id: "share-less",
              type: "share-less" as const,
              label: "Share fewer",
              role: "primary" as const,
              confirm: "hold" as const,
            },
          ]
        : []),
      DENY,
    ],
  };
}

const METHOD_WORDS = { "face-check": "face check", passkey: "passkey check" } as const;

function stepUpRequest(a: StepUpAction, gate: GateResult, ctx: BuildContext): ApprovalRequest {
  const method = METHOD_WORDS[a.method];
  return {
    ...base(ctx, gate),
    kind: "step-up",
    title: `${a.recipient.name} needs a ${method} before it releases ${a.releases}`,
    plainReason: plainOf(gate),
    facts: [
      { label: "Asked by", value: a.recipient.name },
      { label: "Releases", value: a.releases.charAt(0).toUpperCase() + a.releases.slice(1) },
      { label: "Goes to", value: a.goesTo },
      { label: "Check done by", value: a.performedBy },
      { label: "Valid for", value: `${a.validMinutes} minutes` },
    ],
    action: a,
    sensitivity: "special",
    reversibility: "reversible",
    origin: a.origin,
    standingWithheldReason: "A stronger approval is asked for each time.",
    offered: [
      {
        id: "step-up",
        type: "step-up-done",
        label: `Start ${method}`,
        role: "primary",
        confirm: "step-up",
      },
      DENY,
    ],
  };
}

/** Build the request the principal sees. Throws if the gate did not ask. */
export function buildApprovalRequest(
  gate: GateResult,
  ctx: BuildContext & { action: ApprovalRequest["action"] },
): ApprovalRequest {
  if (gate.outcome !== "ask" || !gate.decidedBy)
    throw new Error("the gate did not ask the principal");
  const a = ctx.action;
  if (a.type === "purchase") return purchaseRequest(a, gate, ctx);
  if (a.type === "share") return shareRequest(a, gate, ctx);
  return stepUpRequest(a, gate, ctx);
}

/** A complete spending rule from a draft the principal confirmed. */
export function ruleFromDraft(draft: RuleDraft, id: string, now: Date): SpendingRule {
  return {
    id,
    kind: draft.kind,
    limit: draft.limit,
    ...(draft.kind === "budget" ? { period: draft.period ?? "month" } : {}),
    ...(draft.perPurchaseMax && draft.kind !== "per-purchase"
      ? { perPurchaseMax: draft.perPurchaseMax }
      : {}),
    scope: draft.scope,
    createdAt: now.toISOString(),
    ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
  };
}

export type ResponseCheck =
  | { readonly ok: true; readonly offered: OfferedResponse; readonly rule?: SpendingRule }
  | { readonly ok: false; readonly reason: string };

/**
 * Check a response against what was offered. A limit draft must be a valid rule, stay in
 * the purchase's currency and under the standing ceiling.
 */
export function checkResponse(
  request: ApprovalRequest,
  response: PrincipalResponse,
  now: Date,
  ruleId = `rule:${request.id}`,
): ResponseCheck {
  const offered = request.offered.find((o) => o.id === response.offeredId);
  if (!offered || offered.type !== response.type) return { ok: false, reason: "not-offered" };
  if (now.getTime() >= Date.parse(request.expiresAt)) return { ok: false, reason: "expired" };
  if (response.type === "set-limit" || response.type === "raise-limit") {
    const rule = ruleFromDraft(response.draft, ruleId, now);
    const action = request.action;
    if (
      !isSpendingRule(rule) ||
      action.type !== "purchase" ||
      rule.limit.currency !== action.total.currency ||
      rule.limit.minor > STANDING_CEILING_MINOR * 10
    )
      return { ok: false, reason: "invalid-limit" };
    return { ok: true, offered, rule };
  }
  if (response.type === "share-less") {
    const action = request.action;
    if (action.type !== "share") return { ok: false, reason: "not-offered" };
    const offeredIds = new Set(action.fields.filter((f) => f.state === "offered").map((f) => f.id));
    const keep = new Set(response.keep);
    const required = action.fields
      .filter((f) => f.state === "offered" && f.required)
      .map((f) => f.id);
    if (
      [...keep].some((id) => !offeredIds.has(id)) ||
      required.some((id) => !keep.has(id)) ||
      keep.size === 0
    )
      return { ok: false, reason: "invalid-selection" };
  }
  if (response.type === "step-up-done" && response.attestation.length === 0)
    return { ok: false, reason: "no-attestation" };
  return { ok: true, offered };
}
