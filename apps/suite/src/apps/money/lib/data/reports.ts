// AUTHORED-BY Claude Opus 5.5
import type { Category, Transaction } from "../model";
import {
  comparePeriods,
  type ExactRatio,
  formatMoney,
  type Money,
  money,
  type Period,
  type PeriodChange,
  parseMoney,
  type Transaction as ReportTransaction,
  spendingByCategory,
  spendingByMonth,
} from "../reports";
import { resolveCategory } from "./categories";

export type ReportPreset = "month" | "last-month" | "90-days" | "year";
export const REPORT_PRESETS: readonly { id: ReportPreset; label: string; versus: string }[] = [
  { id: "month", label: "This month", versus: "same days last month" },
  { id: "last-month", label: "Last month", versus: "the month before" },
  { id: "90-days", label: "Last 90 days", versus: "the 90 days before" },
  { id: "year", label: "This year", versus: "same days last year" },
];

const day = (value: Date) => value.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
function addDays(date: string, days: number) {
  const value = utc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return day(value);
}
/** Same day-of-month `months` away, clamped to that month's last day. */
function shiftMonths(date: string, months: number) {
  const [year, month, dayOfMonth] = date.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dayOfMonth, last));
  return day(first);
}
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

/** The current and comparison periods for a preset, as inclusive civil dates. */
export function presetPeriods(
  preset: ReportPreset,
  today: string,
): { current: Period; previous: Period } {
  switch (preset) {
    case "month": {
      const start = monthStart(today);
      const previousStart = shiftMonths(start, -1);
      // Clamp so 31 March compares with 1-28/29 February, never days of March.
      const previousEnd = [shiftMonths(today, -1), addDays(start, -1)].sort()[0] as string;
      return {
        current: { start, end: today },
        previous: { start: previousStart, end: previousEnd },
      };
    }
    case "last-month": {
      const start = shiftMonths(monthStart(today), -1);
      const end = addDays(monthStart(today), -1);
      const previousStart = shiftMonths(start, -1);
      return {
        current: { start, end },
        previous: { start: previousStart, end: addDays(start, -1) },
      };
    }
    case "90-days": {
      const start = addDays(today, -89);
      return {
        current: { start, end: today },
        previous: { start: addDays(start, -90), end: addDays(start, -1) },
      };
    }
    case "year": {
      const start = `${today.slice(0, 4)}-01-01`;
      const previousStart = `${String(Number(today.slice(0, 4)) - 1).padStart(4, "0")}-01-01`;
      // 29 February compares with 28 February.
      return {
        current: { start, end: today },
        previous: { start: previousStart, end: shiftMonths(today, -12) },
      };
    }
  }
}

/**
 * Report rows for one currency. Until the model records an explicit kind
 * (bead MON-F1), transfer legs are transfers and signs classify income and spending.
 */
export function reportRows(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  currency: string,
  rollUp = false,
): ReportTransaction[] {
  const parents = new Map(categories.map((category) => [category.id, category.parent]));
  const top = (id: string) => {
    let current = id;
    const seen = new Set<string>();
    for (let parent = parents.get(current); parent && parents.has(parent); ) {
      if (seen.has(parent)) break;
      seen.add(parent);
      current = parent;
      parent = parents.get(current);
    }
    return current;
  };
  return transactions
    .filter((row) => row.currency === currency)
    .map((row) => {
      const kind =
        row.debitAccount || row.creditAccount
          ? ("transfer" as const)
          : row.amount.startsWith("-")
            ? ("expense" as const)
            : ("income" as const);
      const category = kind === "expense" ? resolveCategory(row.category, categories) : undefined;
      return {
        id: row.id,
        date: row.postingTime.slice(0, 10),
        amount: parseMoney(currency, row.amount),
        kind,
        categoryId: category === undefined ? null : rollUp ? top(category) : category,
      };
    });
}

export interface ReportChange {
  amount: string;
  previous: string;
  change: string;
  /** Whole-percent change, rounded half away from zero; null when the baseline is zero. */
  percent: number | null;
}
export interface CategoryBar {
  id: string | null;
  label: string;
  amount: string;
  minor: number;
  /** Share of the period's spending, 0-1 (0 when nothing was spent). */
  share: number;
}
export interface MonthBar {
  month: string;
  amount: string;
  minor: number;
}
export interface MoneyReport {
  currency: string;
  current: Period;
  previous: Period;
  income: ReportChange;
  expense: ReportChange;
  net: ReportChange;
  categories: CategoryBar[];
  months: MonthBar[];
}

function percent(ratio: ExactRatio | null): number | null {
  if (!ratio) return null;
  const numerator = BigInt(ratio.numerator);
  const denominator = BigInt(ratio.denominator);
  const negative = numerator < BigInt(0);
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude * BigInt(2) + denominator) / (denominator * BigInt(2));
  return Number(negative ? -rounded : rounded);
}
function changeOf(value: PeriodChange): ReportChange {
  return {
    amount: formatMoney(value.current),
    previous: formatMoney(value.previous),
    change: formatMoney(value.change),
    percent: percent(value.percentage),
  };
}
function monthsBetween(period: Period): string[] {
  const months: string[] = [];
  for (let month = monthStart(period.start); month <= period.end; month = shiftMonths(month, 1))
    months.push(month.slice(0, 7));
  return months;
}
const sizeOf = (value: Money) => value.minor;

export function buildReport(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  currency: string,
  preset: ReportPreset,
  today: string,
  options: { rollUp?: boolean } = {},
): MoneyReport {
  const { current, previous } = presetPeriods(preset, today);
  const rows = reportRows(transactions, categories, currency, options.rollUp);
  const comparison = comparePeriods(rows, previous, current, { currency });
  const labels = new Map(categories.map((category) => [category.id, category.label]));
  const spending = spendingByCategory(rows, current, { currency });
  // Expenses are classified by a negative sign, so every category total is >= 0.
  const spent = spending.reduce((sum, row) => sum + sizeOf(row.total), 0);
  const byMonth = new Map(
    spendingByMonth(rows, current, { currency }).map((row) => [row.month, row.total]),
  );
  return {
    currency,
    current,
    previous,
    income: changeOf(comparison.income),
    expense: changeOf(comparison.expense),
    net: changeOf(comparison.net),
    categories: spending
      .map((row) => ({
        id: row.categoryId,
        // Report rows only carry category IDs that resolveCategory found in `categories`.
        label: row.categoryId === null ? "Uncategorised" : (labels.get(row.categoryId) as string),
        amount: formatMoney(row.total),
        minor: sizeOf(row.total),
        share: spent > 0 ? sizeOf(row.total) / spent : 0,
      }))
      .sort((a, b) => b.minor - a.minor || a.label.localeCompare(b.label)),
    months: monthsBetween(current).map((month) => {
      const total = byMonth.get(month);
      const value = total ?? money(currency, 0);
      return { month, amount: formatMoney(value), minor: sizeOf(value) };
    }),
  };
}

/** Currencies with at least one account or transaction, most-used first. */
export function reportCurrencies(
  accounts: readonly { currency: string }[],
  transactions: readonly Transaction[],
): string[] {
  const counts = new Map<string, number>();
  for (const { currency } of [...accounts, ...transactions])
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}
