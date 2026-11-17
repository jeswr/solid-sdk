// AUTHORED-BY Claude Opus 5.5
/**
 * Plain-English wording and smart defaults for spending rules. The approval sheet and the
 * limit editor show these sentences; they are generated from the rule itself, never by a
 * model, so what the principal reads is exactly what they sign.
 */
import { formatMoney, type Money } from "./money.js";
import type { RuleScope, SpendingRule } from "./rules.js";
import type { RuleDraft } from "./types.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Feb 13" (UTC), adding the year when it is not `now`'s year. */
export function shortDate(iso: string, now?: Date): string {
  const d = new Date(iso);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return now && now.getUTCFullYear() !== d.getUTCFullYear()
    ? `${base}, ${d.getUTCFullYear()}`
    : base;
}

function where(scope: RuleScope): string {
  if (scope.kind === "merchant") return `at ${scope.label}`;
  if (scope.kind === "category") return `on ${scope.label.toLowerCase()}`;
  return "at any store";
}

type Describable = Pick<SpendingRule, "kind" | "limit" | "period" | "scope">;

/** Short name of a rule: "your $100 a month at Stride & Co". */
export function describeRule(rule: Describable): string {
  const amount = formatMoney(rule.limit);
  if (rule.kind === "per-purchase") return `your ${amount} per purchase ${where(rule.scope)}`;
  if (rule.kind === "budget") return `your ${amount} a ${rule.period} ${where(rule.scope)}`;
  return `your ${amount} allowance ${where(rule.scope)}`;
}

/** Compact label for chips: "$100/month at Stride & Co". */
export function ruleLabel(rule: Describable): string {
  const amount = formatMoney(rule.limit);
  const tail = where(rule.scope);
  if (rule.kind === "per-purchase") return `${amount} per purchase ${tail}`;
  if (rule.kind === "budget") return `${amount}/${rule.period} ${tail}`;
  return `${amount} allowance ${tail}`;
}

/** The live summary sentence in the limit editor (design section 4). */
export function summarizeDraft(draft: RuleDraft, agentName: string, now: Date): string {
  const amount = formatMoney(draft.limit);
  const tail = where(draft.scope);
  const cap = draft.perPurchaseMax
    ? `, as long as each purchase is ${formatMoney(draft.perPurchaseMax)} or less`
    : "";
  const ends = draft.expiresAt ? ` Ends ${shortDate(draft.expiresAt, now)}.` : "";
  if (draft.kind === "per-purchase")
    return `${agentName} can make purchases of ${amount} or less ${tail} without asking. No monthly total.${ends}`;
  if (draft.kind === "allowance")
    return `${agentName} can spend ${amount} in total ${tail}${cap}, then it asks again.${ends || " It ends when used up."}`;
  return `${agentName} can spend up to ${amount} a ${draft.period} ${tail} without asking${cap}. It will tell you after each purchase.${ends}`;
}

const STEPS = [2500, 5000, 10000, 15000, 20000, 30000, 50000];

/** Five times the price, rounded up to the next step; chips are that step and its neighbors. */
export function suggestedAmounts(price: Money): number[] {
  const target = price.minor * 5;
  let i = STEPS.findIndex((s) => s >= target);
  if (i === -1) i = STEPS.length - 1;
  const lo = Math.max(0, Math.min(i - 1, STEPS.length - 3));
  return STEPS.slice(lo, lo + 3);
}

/** The editor's starting point for a purchase at `scope` costing `price` (design section 4). */
export function defaultDraft(price: Money, scope: RuleScope, now: Date): RuleDraft {
  const expires = new Date(now.getTime());
  expires.setUTCMonth(expires.getUTCMonth() + 3);
  const expiresAt = expires.toISOString();
  if (price.minor >= 20000) return { kind: "per-purchase", limit: price, scope, expiresAt };
  const chips = suggestedAmounts(price);
  const target = price.minor * 5;
  const pick = chips.find((c) => c >= target) ?? (chips[chips.length - 1] as number);
  const limit = { minor: pick, currency: price.currency };
  return {
    kind: "budget",
    period: "month",
    limit,
    scope,
    expiresAt,
    ...(pick > 20000 ? { perPurchaseMax: { minor: pick / 2, currency: price.currency } } : {}),
  };
}

/** The smallest suggested amount that covers `needed` under an existing rule. */
export function raisedAmounts(current: Money, needed: number): number[] {
  const up = STEPS.filter((s) => s > current.minor && s >= needed);
  const first = up[0] ?? Math.ceil(needed / 2500) * 2500;
  return [first, ...up.slice(1, 3)].slice(0, 3);
}
