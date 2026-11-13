// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * The limits half of the outbound gate's "limits and approval" check for purchases.
 *
 * A purchase is covered when at least one active, in-scope spending rule holds it whole. The
 * most specific covering rule (merchant, then category, then any store) authorizes it and
 * the spend is charged to that rule alone, so the principal can always tell which permission
 * paid for what. Anything else asks the principal. Malformed rules and records, currency
 * mismatches and clocks that do not parse never cover a purchase (fail closed).
 */
import { isMoney, type Money } from "./money.js";
import {
  isSpendingRule,
  periodEnd,
  periodStart,
  type SpendingRule,
  scopeCovers,
  scopeRank,
} from "./rules.js";

export interface SpendRecord {
  readonly id: string;
  /** The rule that authorized it; absent when the principal approved it once. */
  readonly ruleId?: string;
  readonly merchant: string;
  readonly category?: string;
  readonly amount: Money;
  readonly at: string;
  /** A refunded or cancelled purchase stops counting against its rule. */
  readonly refunded?: boolean;
}

export interface Purchase {
  readonly merchant: string;
  readonly category?: string;
  readonly amount: Money;
}

export interface RuleUsage {
  readonly rule: SpendingRule;
  /** Spent under this rule in the current window (budget period or allowance lifetime). */
  readonly used: Money;
  /** What is left before this purchase. */
  readonly remaining: Money;
  /** What would be left after it (negative when it does not fit). */
  readonly after: number;
  /** When the window resets (budgets only). */
  readonly resetsAt?: string;
}

export type ExceedReason = "per-purchase-cap" | "over-budget" | "over-allowance" | "currency";

export type SpendCheck =
  | { readonly outcome: "covered"; readonly usage: RuleUsage }
  | { readonly outcome: "exceeds"; readonly usage: RuleUsage; readonly reason: ExceedReason }
  | { readonly outcome: "no-rule" };

/** Rules in force at `now`: valid, already started, not expired. */
export function activeRules(rules: readonly unknown[], now: Date): SpendingRule[] {
  const t = now.getTime();
  if (!Number.isFinite(t)) return [];
  return rules.filter(
    (r): r is SpendingRule =>
      isSpendingRule(r) &&
      Date.parse(r.createdAt) <= t &&
      (r.expiresAt === undefined || t < Date.parse(r.expiresAt)),
  );
}

function validRecord(r: SpendRecord): boolean {
  return isMoney(r.amount) && Number.isFinite(Date.parse(r.at));
}

/** Usage of one rule at `now` for a candidate amount (same currency assumed by caller). */
export function ruleUsage(
  rule: SpendingRule,
  records: readonly SpendRecord[],
  amount: Money,
  now: Date,
): RuleUsage {
  const lineage = new Set([rule.id, ...(rule.supersedes ?? [])]);
  const from =
    rule.kind === "budget" && rule.period
      ? periodStart(now, rule.period)
      : Date.parse(rule.createdAt);
  const used =
    rule.kind === "per-purchase"
      ? 0
      : records
          .filter(
            (r) =>
              r.ruleId !== undefined &&
              lineage.has(r.ruleId) &&
              !r.refunded &&
              validRecord(r) &&
              r.amount.currency === rule.limit.currency &&
              Date.parse(r.at) >= from &&
              Date.parse(r.at) <= now.getTime(),
          )
          .reduce((sum, r) => sum + r.amount.minor, 0);
  const remaining = Math.max(0, rule.limit.minor - used);
  return {
    rule,
    used: { minor: used, currency: rule.limit.currency },
    remaining: { minor: remaining, currency: rule.limit.currency },
    after: rule.limit.minor - used - amount.minor,
    ...(rule.kind === "budget" && rule.period
      ? { resetsAt: new Date(periodEnd(now, rule.period)).toISOString() }
      : {}),
  };
}

function fitsRule(rule: SpendingRule, usage: RuleUsage, amount: Money): ExceedReason | undefined {
  if (amount.currency !== rule.limit.currency) return "currency";
  if (rule.perPurchaseMax && amount.minor > rule.perPurchaseMax.minor) return "per-purchase-cap";
  if (rule.kind === "per-purchase")
    return amount.minor > rule.limit.minor ? "per-purchase-cap" : undefined;
  if (usage.after < 0) return rule.kind === "budget" ? "over-budget" : "over-allowance";
  return undefined;
}

export function checkSpend(
  rules: readonly unknown[],
  records: readonly SpendRecord[],
  purchase: Purchase,
  now: Date,
): SpendCheck {
  if (!isMoney(purchase.amount) || purchase.amount.minor === 0) return { outcome: "no-rule" };
  const inScope = activeRules(rules, now)
    .filter((r) => scopeCovers(r.scope, purchase))
    .sort((a, b) => scopeRank(b.scope) - scopeRank(a.scope));
  if (inScope.length === 0) return { outcome: "no-rule" };
  const scored = inScope.map((rule) => {
    const usage = ruleUsage(rule, records, purchase.amount, now);
    return { rule, usage, reason: fitsRule(rule, usage, purchase.amount) };
  });
  const covering = scored
    .filter((s) => s.reason === undefined)
    .sort(
      (a, b) =>
        scopeRank(b.rule.scope) - scopeRank(a.rule.scope) ||
        b.usage.remaining.minor - a.usage.remaining.minor,
    );
  const best = covering[0];
  if (best) return { outcome: "covered", usage: best.usage };
  // Report the most specific rule that applies, so the principal sees the limit they set.
  const first = scored[0] as (typeof scored)[number];
  return { outcome: "exceeds", usage: first.usage, reason: first.reason as ExceedReason };
}
