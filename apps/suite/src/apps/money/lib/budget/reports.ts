// AUTHORED-BY Codex GPT-6.1-Sol
import { type Currency, groupMoney, type Money, validateMoney } from "./money";
import {
  BudgetError,
  checked,
  date,
  identity,
  list,
  type Period,
  period,
  record,
  within,
} from "./validation";

export interface Transaction {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  readonly kind: "income" | "expense" | "transfer";
  /** Only expenses have categories; null denotes uncategorised spending. */
  readonly categoryId: string | null;
}

export interface Category {
  readonly id: string;
  readonly parentId: string | null;
}

function transactions(values: readonly Transaction[]): void {
  list(values);
  const ids = new Set<string>();
  for (const value of values) {
    record(value);
    identity(value.id);
    date(value.date);
    validateMoney(value.amount);
    if (!["income", "expense", "transfer"].includes(value.kind)) {
      throw new BudgetError("invalid-input");
    }
    if (value.categoryId !== null) {
      identity(value.categoryId);
      if (value.kind !== "expense") throw new BudgetError("invalid-input");
    }
    if (ids.has(value.id)) throw new BudgetError("duplicate");
    ids.add(value.id);
  }
}

function categoryTree(categories: readonly Category[]): Map<string, string | null> {
  list(categories);
  const parents = new Map<string, string | null>();
  for (const category of categories) {
    record(category);
    identity(category.id);
    if (category.parentId !== null) identity(category.parentId);
    if (parents.has(category.id)) throw new BudgetError("invalid-category-tree");
    parents.set(category.id, category.parentId);
  }
  const complete = new Set<string>();
  for (const id of parents.keys()) {
    const path = new Set<string>();
    let current: string | null = id;
    while (current !== null && !complete.has(current)) {
      if (!parents.has(current) || path.has(current)) {
        throw new BudgetError("invalid-category-tree");
      }
      path.add(current);
      current = parents.get(current)!;
    }
    for (const entry of path) complete.add(entry);
  }
  return parents;
}

export interface CategorySpend {
  readonly categoryId: string | null;
  readonly direct: number;
  /** Includes direct spend and every descendant, once per ancestor. */
  readonly total: number;
}

export interface CurrencySpend {
  readonly currency: Currency;
  readonly categories: readonly CategorySpend[];
}

/** Positive means net spending; expense refunds can produce negative spending. */
export function spendByCategory(
  values: readonly Transaction[],
  categories: readonly Category[],
  range: Period,
): CurrencySpend[] {
  period(range);
  transactions(values);
  const parents = categoryTree(categories);
  const totals = new Map<Currency, Map<string | null, CategorySpend>>();
  for (const value of values) {
    if (value.categoryId !== null && !parents.has(value.categoryId)) {
      throw new BudgetError("invalid-category-tree");
    }
    if (value.kind !== "expense" || !within(value.date, range)) continue;
    let rows = totals.get(value.amount.currency);
    if (!rows) {
      rows = new Map();
      totals.set(value.amount.currency, rows);
    }
    const spend = -value.amount.minor;
    let categoryId = value.categoryId;
    do {
      const row = rows.get(categoryId) ?? { categoryId, direct: 0, total: 0 };
      rows.set(categoryId, {
        categoryId,
        direct: checked(row.direct + (categoryId === value.categoryId ? spend : 0)),
        total: checked(row.total + spend),
      });
      categoryId = categoryId === null ? null : parents.get(categoryId)!;
    } while (categoryId !== null);
  }
  return [...totals.keys()].sort().map((currency) => {
    const rows = totals.get(currency)!;
    const ids = [...rows.keys()].filter((id) => id !== null).sort();
    const result = ids.map((id) => rows.get(id)!);
    if (rows.has(null)) result.push(rows.get(null)!);
    return { currency, categories: result };
  });
}

export interface MonthlyCashFlow {
  readonly month: string;
  readonly currency: Currency;
  readonly inflow: number;
  readonly outflow: number;
  readonly net: number;
}

/** Occupied non-transfer month/currency buckets only; outflow is a positive magnitude. */
export function cashFlowByMonth(values: readonly Transaction[], range: Period): MonthlyCashFlow[] {
  period(range);
  transactions(values);
  const totals = new Map<string, Map<Currency, MonthlyCashFlow>>();
  for (const value of values) {
    if (value.kind === "transfer" || !within(value.date, range)) continue;
    const month = value.date.slice(0, 7);
    let currencies = totals.get(month);
    if (!currencies) {
      currencies = new Map();
      totals.set(month, currencies);
    }
    const { currency, minor } = value.amount;
    const row = currencies.get(currency) ?? { month, currency, inflow: 0, outflow: 0, net: 0 };
    currencies.set(currency, {
      month,
      currency,
      inflow: checked(row.inflow + Math.max(minor, 0)),
      outflow: checked(row.outflow + Math.max(-minor, 0)),
      net: checked(row.net + minor),
    });
  }
  return [...totals.keys()].sort().flatMap((month) => {
    const currencies = totals.get(month)!;
    return [...currencies.keys()].sort().map((currency) => currencies.get(currency)!);
  });
}

export interface Balance {
  readonly accountId: string;
  readonly date: string;
  /** Assets positive, liabilities negative, in the account's fixed currency. */
  readonly balance: Money;
}

export interface NetWorthPoint {
  readonly date: string;
  readonly totals: readonly Money[];
}

/** Last known balance per account at each requested civil date; no zero imputation. */
export function netWorthSeries(
  values: readonly Balance[],
  sampleDates: readonly string[],
): NetWorthPoint[] {
  list(values);
  list(sampleDates);
  const dates = new Set<string>();
  for (const at of sampleDates) {
    date(at);
    if (dates.has(at)) throw new BudgetError("duplicate");
    dates.add(at);
  }
  const accounts = new Map<string, Balance[]>();
  const seen = new Set<string>();
  for (const value of values) {
    record(value);
    identity(value.accountId);
    date(value.date);
    validateMoney(value.balance);
    const key = JSON.stringify([value.accountId, value.date]);
    if (seen.has(key)) throw new BudgetError("duplicate");
    seen.add(key);
    let history = accounts.get(value.accountId);
    if (!history) {
      history = [];
      accounts.set(value.accountId, history);
    }
    if (history.length > 0 && history[0]!.balance.currency !== value.balance.currency) {
      throw new BudgetError("currency-mismatch");
    }
    history.push(value);
  }
  for (const history of accounts.values()) {
    history.sort((a, b) => a.date.localeCompare(b.date));
  }
  const cursors = new Map<string, number>();
  return [...dates].sort().map((at) => {
    const balances: Money[] = [];
    for (const [id, history] of accounts) {
      let cursor = cursors.get(id) ?? -1;
      while (cursor + 1 < history.length && history[cursor + 1]!.date <= at) cursor++;
      if (cursor < 0) throw new BudgetError("missing-balance");
      cursors.set(id, cursor);
      balances.push(history[cursor]!.balance);
    }
    return { date: at, totals: groupMoney(balances) };
  });
}
