// AUTHORED-BY Codex GPT-6
import { addAmounts, type Category, type Transaction } from "../model";
import { formatMoney, spendingByCategory } from "../reports";
import { type AccountSummary, listAccounts } from "./accounts";
import { loadCategories } from "./categories";
import type { MoneyClient } from "./container";
import { allTransactions } from "./ledger";
import { reportRows } from "./reports";
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
      const rows = reportRows(transactions, categories, currency);
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
