// AUTHORED-BY Codex GPT-6.1-Sol
import { minorUnits } from "./currencies";
import {
  addMoney,
  convertMoney,
  type ExchangeRate,
  type Money,
  money,
  subtractMoney,
  validateMoney,
  validateRates,
} from "./money";
import { date, identity, list, type Period, period, ReportsError, record } from "./validation";

/** Signed amounts match the budget library: expense refunds and income reversals are supported. */
export interface Transaction {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  readonly kind: "income" | "expense" | "transfer";
  readonly categoryId: string | null;
}

export interface ReportOptions {
  readonly currency: string;
  readonly rates?: readonly ExchangeRate[];
}

export interface IncomeExpenseTotals {
  readonly income: Money;
  /** Positive net spending; refunds reduce this and may make it negative. */
  readonly expense: Money;
  readonly net: Money;
}

function selected(
  values: readonly Transaction[],
  range: Period,
  options: ReportOptions,
): Transaction[] {
  period(range);
  record(options);
  minorUnits(options.currency);
  // Explicit undefined/null is invalid; only an absent table defaults to empty.
  const rates = Object.hasOwn(options, "rates") ? options.rates! : [];
  validateRates(rates);
  list(values);
  const ids = new Set<string>();
  const result: Transaction[] = [];
  for (const value of values) {
    record(value);
    identity(value.id);
    date(value.date);
    validateMoney(value.amount);
    if (!["income", "expense", "transfer"].includes(value.kind)) {
      throw new ReportsError("invalid-input");
    }
    if (value.categoryId !== null) {
      identity(value.categoryId);
      if (value.kind !== "expense") throw new ReportsError("invalid-input");
    }
    if (ids.has(value.id)) throw new ReportsError("duplicate");
    ids.add(value.id);
    if (value.kind === "transfer" || value.date < range.start || value.date > range.end) continue;
    result.push({ ...value, amount: convertMoney(value.amount, options.currency, rates) });
  }
  return result;
}

export function incomeExpenseTotals(
  values: readonly Transaction[],
  range: Period,
  options: ReportOptions,
): IncomeExpenseTotals {
  const rows = selected(values, range, options);
  let income = money(options.currency, 0);
  let expense = money(options.currency, 0);
  for (const row of rows) {
    if (row.kind === "income") income = addMoney(income, row.amount);
    else expense = subtractMoney(expense, row.amount);
  }
  return { income, expense, net: subtractMoney(income, expense) };
}

export interface CategorySpending {
  readonly categoryId: string | null;
  readonly total: Money;
}

export function spendingByCategory(
  values: readonly Transaction[],
  range: Period,
  options: ReportOptions,
): CategorySpending[] {
  const totals = new Map<string | null, Money>();
  for (const row of selected(values, range, options)) {
    if (row.kind !== "expense") continue;
    const previous = totals.get(row.categoryId) ?? money(options.currency, 0);
    totals.set(row.categoryId, subtractMoney(previous, row.amount));
  }
  const keys: (string | null)[] = [...totals.keys()].filter((key) => key !== null).sort();
  if (totals.has(null)) keys.push(null);
  return keys.map((categoryId) => ({ categoryId, total: totals.get(categoryId)! }));
}

export interface MonthlySpending {
  readonly month: string;
  readonly total: Money;
}

/** Occupied expense months only, in ascending civil-month order. */
export function spendingByMonth(
  values: readonly Transaction[],
  range: Period,
  options: ReportOptions,
): MonthlySpending[] {
  const totals = new Map<string, Money>();
  for (const row of selected(values, range, options)) {
    if (row.kind !== "expense") continue;
    const month = row.date.slice(0, 7);
    const previous = totals.get(month) ?? money(options.currency, 0);
    totals.set(month, subtractMoney(previous, row.amount));
  }
  return [...totals.keys()].sort().map((month) => ({ month, total: totals.get(month)! }));
}

/** JSON-safe exact fraction: signed decimal integer numerator, positive denominator. */
export interface ExactRatio {
  readonly numerator: string;
  readonly denominator: string;
}

export interface PeriodChange {
  readonly previous: Money;
  readonly current: Money;
  readonly change: Money;
  /** 100 * change / abs(previous). Undefined when previous is zero. */
  readonly percentage: ExactRatio | null;
}

function change(previous: Money, current: Money): PeriodChange {
  const difference = subtractMoney(current, previous);
  let percentage: ExactRatio | null = null;
  if (previous.minor !== 0) {
    const numerator = BigInt(difference.minor) * BigInt(100);
    const denominator = BigInt(Math.abs(previous.minor));
    let a = numerator < BigInt(0) ? -numerator : numerator;
    let b = denominator;
    while (b !== BigInt(0)) [a, b] = [b, a % b];
    percentage = {
      numerator: (numerator / a).toString(),
      denominator: (denominator / a).toString(),
    };
  }
  return { previous, current, change: difference, percentage };
}

export interface PeriodComparison {
  readonly income: PeriodChange;
  readonly expense: PeriodChange;
  readonly net: PeriodChange;
}

/** Caller supplies both periods; rejects overlap/reversal rather than inferring a baseline. */
export function comparePeriods(
  values: readonly Transaction[],
  previous: Period,
  current: Period,
  options: ReportOptions,
): PeriodComparison {
  period(previous);
  period(current);
  if (previous.end >= current.start) throw new ReportsError("invalid-period");
  const before = incomeExpenseTotals(values, previous, options);
  const after = incomeExpenseTotals(values, current, options);
  return {
    income: change(before.income, after.income),
    expense: change(before.expense, after.expense),
    net: change(before.net, after.net),
  };
}
