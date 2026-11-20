// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * Spending rules: the standing permissions a principal gives so their agent can buy without
 * asking each time. A rule never widens anything else in the mandate; it only turns
 * "ask the principal" into "go" for purchases it fully covers.
 *
 * Three kinds:
 * - `per-purchase`: any single purchase up to `limit` (no running total);
 * - `budget`: up to `limit` per calendar `period` (week from Monday, or month), UTC;
 * - `allowance`: a standing amount that runs down until used up (or `expiresAt`).
 * Budgets and allowances may also cap each purchase (`perPurchaseMax`).
 */
import { isMoney, type Money } from "./money.js";

export type RuleScope =
  | { readonly kind: "merchant"; readonly merchant: string; readonly label: string }
  | { readonly kind: "category"; readonly category: string; readonly label: string }
  | { readonly kind: "any" };

export type SpendingRuleKind = "per-purchase" | "budget" | "allowance";
export type BudgetPeriod = "week" | "month";

export interface SpendingRule {
  readonly id: string;
  /** All previous rule IDs, retained when a limit is raised. */
  readonly supersedes?: readonly string[];
  readonly kind: SpendingRuleKind;
  readonly limit: Money;
  /** Required for `budget`, absent otherwise. */
  readonly period?: BudgetPeriod;
  /** Optional cap on any one purchase under a budget or allowance. */
  readonly perPurchaseMax?: Money;
  readonly scope: RuleScope;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

const ID = /^[A-Za-z0-9:._#/-]{1,200}$/;

/** Consent timestamps use ISO UTC with an explicit Z; precision may vary. */
export function isUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function shortText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function validScope(scope: unknown): scope is RuleScope {
  if (typeof scope !== "object" || scope === null) return false;
  const s = scope as Record<string, unknown>;
  const keys = Object.keys(s).sort().join(",");
  if (s.kind === "any") return keys === "kind";
  if (s.kind === "merchant")
    return keys === "kind,label,merchant" && shortText(s.merchant) && shortText(s.label);
  if (s.kind === "category")
    return keys === "category,kind,label" && shortText(s.category) && shortText(s.label);
  return false;
}

const RULE_KEYS = new Set([
  "id",
  "supersedes",
  "kind",
  "limit",
  "period",
  "perPurchaseMax",
  "scope",
  "createdAt",
  "expiresAt",
]);

/** Structural validation; a rule that fails is ignored by every check (fail closed). */
export function isSpendingRule(value: unknown): value is SpendingRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some((k) => !RULE_KEYS.has(k))) return false;
  if (typeof r.id !== "string" || !ID.test(r.id)) return false;
  if (r.supersedes !== undefined) {
    if (!Array.isArray(r.supersedes) || r.supersedes.length === 0) return false;
    if ([...r.supersedes].some((id) => typeof id !== "string" || !ID.test(id) || id === r.id))
      return false;
    if (new Set(r.supersedes).size !== r.supersedes.length) return false;
  }
  if (!isMoney(r.limit) || r.limit.minor === 0) return false;
  if (!validScope(r.scope) || !isUtcTimestamp(r.createdAt)) return false;
  if (
    r.expiresAt !== undefined &&
    (!isUtcTimestamp(r.expiresAt) || Date.parse(r.expiresAt) <= Date.parse(r.createdAt))
  )
    return false;
  if (r.kind === "budget") {
    if (r.period !== "week" && r.period !== "month") return false;
  } else if (r.kind === "per-purchase" || r.kind === "allowance") {
    if (r.period !== undefined) return false;
  } else return false;
  if (r.perPurchaseMax !== undefined) {
    if (r.kind === "per-purchase") return false;
    if (!isMoney(r.perPurchaseMax) || r.perPurchaseMax.currency !== r.limit.currency) return false;
    if (r.perPurchaseMax.minor === 0 || r.perPurchaseMax.minor > r.limit.minor) return false;
  }
  return true;
}

/** How specific a scope is: a merchant rule beats a category rule beats "any store". */
export function scopeRank(scope: RuleScope): number {
  return scope.kind === "merchant" ? 3 : scope.kind === "category" ? 2 : 1;
}

export function scopeCovers(
  scope: RuleScope,
  purchase: { readonly merchant: string; readonly category?: string },
): boolean {
  if (scope.kind === "any") return true;
  if (scope.kind === "merchant") return scope.merchant === purchase.merchant;
  return purchase.category !== undefined && scope.category === purchase.category;
}

/** Start (ms) of the calendar period containing `at`, UTC; weeks start on Monday. */
export function periodStart(at: Date, period: BudgetPeriod): number {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  else start.setUTCDate(1);
  return start.getTime();
}

/** Start (ms) of the next period after the one containing `at`. */
export function periodEnd(at: Date, period: BudgetPeriod): number {
  const next = new Date(periodStart(at, period));
  if (period === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next.getTime();
}
