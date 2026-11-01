// AUTHORED-BY Codex GPT-6
import { addAmounts, type Category, type Transaction } from "../model";
import { formatMoney, parseMoney, spendingByCategory } from "../reports";
import { type AccountSummary, listAccounts } from "./accounts";
import { loadCategories } from "./categories";
import type { MoneyClient } from "./container";
import { allTransactions } from "./ledger";
export function overview(
  accounts: readonly AccountSummary[],
  transactions: readonly Transaction[],
  categories: readonly Category[],
  today: string,
) {
  const totals = new Map<string, string>();
  for (const account of accounts)
    totals.set(
      account.currency,
      addAmounts(totals.get(account.currency) ?? "0", account.currentBalance),
    );
  const recent = transactions
    .filter((row) => row.postingTime.slice(0, 10) <= today)
    .sort((a, b) => b.postingTime.localeCompare(a.postingTime) || a.id.localeCompare(b.id))
    .slice(0, 10);
  const spending = [...totals.keys()]
    .flatMap((currency) => {
      const rows = transactions
        .filter((row) => row.currency === currency)
        .map((row) => {
          // The first cut has no explicit income/expense kind. Categorised inflows
          // outside Income are refunds; uncategorised inflows are income.
          let category = categories.find((c) => c.id === row.category);
          while (category?.parent) category = categories.find((c) => c.id === category?.parent);
          const income =
            category?.label.toLowerCase() === "income" ||
            (!row.category && !row.amount.startsWith("-"));
          const kind =
            row.debitAccount || row.creditAccount
              ? ("transfer" as const)
              : income
                ? ("income" as const)
                : ("expense" as const);
          return {
            id: row.id,
            date: row.postingTime.slice(0, 10),
            amount: parseMoney(currency, row.amount),
            kind,
            categoryId: kind === "expense" ? (row.category ?? null) : null,
          };
        });
      return spendingByCategory(
        rows,
        { start: `${today.slice(0, 7)}-01`, end: today },
        { currency },
      ).map((row) => ({
        category: row.categoryId,
        currency,
        amount: formatMoney(row.total),
        minor: row.total.minor,
      }));
    })
    .sort((a, b) => b.minor - a.minor)
    .slice(0, 6);
  return {
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
    recent,
    spending,
  };
}
export async function loadOverview(client: MoneyClient, today: string) {
  const accounts = await listAccounts(client, today);
  const transactions = await allTransactions(client);
  const { categories } = await loadCategories(client);
  return { ...overview(accounts, transactions, categories, today), accounts };
}
