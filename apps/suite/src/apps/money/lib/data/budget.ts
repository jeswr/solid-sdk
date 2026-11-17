// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import {
  type Allocation,
  type BudgetMonth,
  type BudgetMonthInput,
  calculateBudget,
  money,
} from "../budget";
import { type Category, categoryTree, MoneyIoError, monthKeys, type Transaction } from "../model";
import { putBudget, readBudget, validateBudget } from "../model/budget";
import { loadCategories } from "./categories";
import { type MoneyClient, moneyRoot, storeOf } from "./container";
import { allTransactions } from "./ledger";
import { reconcileMutation } from "./mutations";
import { storedMoney } from "./reports";

export interface BudgetFile {
  month: string;
  assignments: readonly Allocation[];
}

export async function loadBudgetMonths(client: MoneyClient, start: string, end: string) {
  validateBudget(start, []);
  validateBudget(end, []);
  const store = storeOf(client);
  const files: BudgetFile[] = [];
  for (const month of monthKeys({ start: `${start}-01`, end: `${end}-01` })) {
    const loaded = await store.read(`budgets/${month}.ttl`);
    files.push({ month, assignments: readBudget(loaded.document, loaded.url, month) });
  }
  return files;
}

/** Discover all recorded budgets; missing containers are an empty history, never an access error. */
export async function loadBudgetHistory(client: MoneyClient): Promise<BudgetFile[]> {
  const store = storeOf(client);
  const loaded = await store.read("budgets/");
  const container = new Container(loaded.url, loaded.document.dataset, DataFactory);
  const files: BudgetFile[] = [];
  for (const member of container.contains) {
    // Only direct monthly shards under this container are fetched, including on hostile listings.
    const prefix = `${moneyRoot(client)}budgets/`;
    if (!member.value.startsWith(prefix)) continue;
    const name = member.value.slice(prefix.length);
    if (!/^\d{4}-(0[1-9]|1[0-2])\.ttl$/.test(name)) continue;
    const month = name.slice(0, 7);
    files.push(...(await loadBudgetMonths(client, month, month)));
  }
  return files.sort((a, b) => a.month.localeCompare(b.month));
}

const keyOf = (row: Allocation) => JSON.stringify([row.categoryId, row.amount.currency]);
const nonzero = (rows: readonly Allocation[]) => rows.filter((row) => row.amount.minor !== 0);
function same(left: readonly Allocation[], right: readonly Allocation[]) {
  return (
    left.length === right.length &&
    left.every((row) =>
      right.some((other) => keyOf(row) === keyOf(other) && row.amount.minor === other.amount.minor),
    )
  );
}

/** Patch only the edited envelopes. A stale intent cannot replace somebody else's assignments. */
export async function saveBudgetAssignments(
  client: MoneyClient,
  month: string,
  changes: readonly Allocation[],
  expected: readonly Allocation[],
  emptyOnly = false,
) {
  validateBudget(month, changes);
  validateBudget(month, expected);
  const store = storeOf(client);
  const loaded = await store.read(`budgets/${month}.ttl`);
  const current = readBudget(loaded.document, loaded.url, month);
  const keys = new Set(changes.map(keyOf));
  const touched = (rows: readonly Allocation[]) => rows.filter((row) => keys.has(keyOf(row)));
  const comparable = (rows: readonly Allocation[]) => (emptyOnly ? nonzero(rows) : rows);
  await reconcileMutation(
    current,
    (rows) =>
      same(comparable(touched(rows)), comparable(changes)) &&
      (!emptyOnly || same(nonzero(rows), nonzero(changes))),
    async () => {
      if (
        !same(comparable(touched(current)), comparable(touched(expected))) ||
        (emptyOnly && nonzero(current).length > 0)
      )
        throw new MoneyIoError(412);
      const response = await client.fetch(new URL("budgets/", moneyRoot(client)), {
        method: "PUT",
        redirect: "error",
        body: "",
        headers: {
          "if-none-match": "*",
          "content-type": "text/turtle",
          link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
      if (!response.ok && response.status !== 412) throw new MoneyIoError(response.status);
      putBudget(loaded.document, loaded.url, month, [
        ...current.filter((row) => !keys.has(keyOf(row))),
        ...changes,
      ]);
      await store.write(loaded.url, loaded.document, loaded.condition);
    },
    async () => {
      const latest = await store.read(loaded.url);
      return readBudget(latest.document, latest.url, month);
    },
  );
}

/** Income and descendants of Income are reserved for inflows, not spending envelopes. */
export function incomeCategoryIds(categories: readonly Category[]): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: ReturnType<typeof categoryTree>, income: boolean) {
    for (const node of nodes) {
      const isIncome = income || node.label.trim().toLowerCase() === "income";
      if (isIncome) ids.add(node.id);
      walk(node.children, isIncome);
    }
  }
  walk(categoryTree(categories), false);
  return ids;
}

/** Bound navigation before generating months, using recorded history rather than the query. */
export function budgetMonthBounds(
  files: readonly BudgetFile[],
  transactions: readonly Transaction[],
  today = new Date().toISOString().slice(0, 7),
) {
  const months = [
    today,
    ...files.map((file) => file.month),
    ...transactions.map((row) => row.postingTime.slice(0, 7)),
  ].sort();
  const shiftYear = (month: string, offset: number) => {
    const index = Math.max(
      12,
      Math.min(119999, Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + offset * 12),
    );
    return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  return {
    min: shiftYear(months[0] as string, -1),
    max: shiftYear(months[months.length - 1] as string, 1),
  };
}

/** Recalculate from the earliest recorded month. Account balance snapshots are not new income. */
export function budgetView(
  files: readonly BudgetFile[],
  transactions: readonly Transaction[],
  categories: readonly Category[],
  month: string,
  currencies: readonly string[] = [],
  today = new Date().toISOString().slice(0, 7),
) {
  validateBudget(month, []);
  const bounds = budgetMonthBounds(files, transactions, today);
  if (month < bounds.min || month > bounds.max) throw new RangeError("Budget month out of range");
  const start = [
    month,
    ...files.map((file) => file.month),
    ...transactions.map((row) => row.postingTime.slice(0, 7)),
  ].sort()[0] as string;
  const end = [month, ...files.map((file) => file.month)].sort().pop() as string;
  const knownCurrencies = new Set([
    ...currencies,
    ...files.flatMap((file) => file.assignments.map((row) => row.amount.currency)),
  ]);
  const incomeIds = incomeCategoryIds(categories);
  const uncategorised: string[] = [];
  const filesByMonth = new Map(files.map((file) => [file.month, file]));
  // Group once so the month walk stays linear in months + transactions.
  const byMonth = new Map<string, Transaction[]>();
  for (const row of transactions) {
    if (row.debitAccount || row.creditAccount) continue;
    const key = row.postingTime.slice(0, 7);
    const rows = byMonth.get(key);
    if (rows) rows.push(row);
    else byMonth.set(key, [row]);
  }
  const inputs: BudgetMonthInput[] = monthKeys({ start: `${start}-01`, end: `${end}-01` }).map(
    (key) => {
      const income: BudgetMonthInput["income"][number][] = [];
      const activity: Allocation[] = [];
      for (const row of byMonth.get(key) ?? []) {
        const amount = storedMoney(row.currency, row.amount);
        const value = money(amount.currency, amount.minor);
        if (row.category && !incomeIds.has(row.category))
          activity.push({ categoryId: row.category, amount: value });
        else if (value.minor >= 0 || (row.category && incomeIds.has(row.category)))
          income.push(value);
        else {
          if (key <= month) uncategorised.push(row.id);
          continue;
        }
        knownCurrencies.add(value.currency);
      }
      return {
        month: key,
        income,
        activity,
        assignments: filesByMonth.get(key)?.assignments ?? [],
      };
    },
  );
  const results = calculateBudget(inputs, {
    availableToBudget: [...knownCurrencies].map((c) => money(c, 0)),
    envelopes: [],
  });
  const remaining = results.filter((result) => result.month >= month);
  const current = remaining[0] as BudgetMonth;
  // Later income covers its own month's assignments; only pool shortfalls reserve earlier funds.
  const minimumPools = new Map<string, number>();
  for (const result of remaining) {
    for (const budget of result.currencies) {
      minimumPools.set(
        budget.currency,
        Math.min(
          minimumPools.get(budget.currency) ?? budget.availableToBudget,
          budget.availableToBudget,
        ),
      );
    }
  }
  return {
    start,
    current: {
      ...current,
      currencies: current.currencies.map((budget) => ({
        ...budget,
        availableToBudget: minimumPools.get(budget.currency) as number,
      })),
    },
    uncategorised: uncategorised.length,
  };
}

export async function loadBudget(client: MoneyClient, month: string) {
  const [files, transactions, { categories }] = await Promise.all([
    loadBudgetHistory(client),
    allTransactions(client),
    loadCategories(client),
  ]);
  return budgetView(files, transactions, categories, month);
}
