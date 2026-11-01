// AUTHORED-BY Codex GPT-6
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import {
  addAmounts,
  monthKey,
  putTransaction,
  type Range,
  runningBalance,
  type Transaction,
  validateTransaction,
} from "../model";
import { parseMoney } from "../reports";
import type { AccountSummary } from "./accounts";
import { type MoneyClient, storeOf } from "./container";
export async function allTransactions(client: MoneyClient): Promise<Transaction[]> {
  const store = storeOf(client);
  const listing = await store.read("transactions/");
  const container = new Container(listing.url, listing.document.dataset, DataFactory);
  const rows: Transaction[] = [];
  for (const member of container.contains) {
    const url = store.resolve(member.value);
    if (/\/transactions\/\d{4}-\d{2}\.ttl$/.test(url))
      rows.push(...(await store.read(url)).document.transactions());
  }
  return rows;
}
export interface LedgerFilters {
  category?: string | undefined;
  query?: string | undefined;
  sign?: "in" | "out" | undefined;
}
export function ledgerRows(
  account: AccountSummary,
  transactions: readonly Transaction[],
  range: Range,
  filters: LedgerFilters = {},
) {
  let opening = account.balance.amount;
  for (const row of transactions) {
    if (row.account === account.id && Date.parse(row.postingTime) <= Date.parse(account.asOf))
      opening = addAmounts(
        opening,
        row.amount.startsWith("-") ? row.amount.slice(1) : `-${row.amount}`,
      );
  }
  return runningBalance(
    transactions,
    account.id,
    { amount: opening, currency: account.currency },
    range,
  ).filter(
    (row) =>
      (!filters.category ||
        (filters.category === "uncategorised"
          ? !row.category
          : row.category === filters.category)) &&
      (!filters.query ||
        `${row.payee ?? ""} ${row.description}`
          .toLowerCase()
          .includes(filters.query.toLowerCase())) &&
      (!filters.sign ||
        (filters.sign === "out" ? row.amount.startsWith("-") : !row.amount.startsWith("-"))),
  );
}
export async function loadLedger(
  client: MoneyClient,
  account: AccountSummary,
  range: Range,
  filters?: LedgerFilters,
) {
  return ledgerRows(account, await allTransactions(client), range, filters);
}
export async function addTransaction(
  client: MoneyClient,
  key: string,
  value: Omit<Transaction, "id">,
) {
  const store = storeOf(client);
  parseMoney(value.currency, value.amount);
  const row = { ...value, id: store.transactionId(key, value.postingTime) };
  const shard = await store.read(`transactions/${monthKey(value.postingTime)}.ttl`);
  if (shard.document.transactions().some((existing) => existing.id === row.id))
    throw new Error("This transaction already exists");
  putTransaction(shard.document, row);
  await store.write(shard.url, shard.document, shard.condition);
  return row;
}
export async function updateTransaction(
  client: MoneyClient,
  original: Transaction,
  value: Transaction,
) {
  if (original.debitAccount || original.creditAccount)
    throw new Error(
      "Transfer legs must be changed together. Editing transfers is not supported yet.",
    );
  parseMoney(value.currency, value.amount);
  validateTransaction(value);
  const store = storeOf(client);
  if (monthKey(original.postingTime) !== monthKey(value.postingTime)) {
    // Explicit delete/create. A failure after deletion is surfaced to the caller for review.
    await deleteTransaction(client, original);
    return addTransaction(client, original.id.slice(original.id.indexOf("#") + 1), value);
  }
  if (value.id !== original.id) throw new Error("A transaction ID cannot change");
  await store.saveTransactions([value]);
  return value;
}
export async function bulkCategorise(
  client: MoneyClient,
  ids: readonly string[],
  category?: string,
) {
  const rows = (await allTransactions(client)).filter((row) => ids.includes(row.id));
  if (rows.length !== new Set(ids).size) throw new Error("A selected transaction no longer exists");
  if (rows.some((row) => row.debitAccount || row.creditAccount))
    throw new Error(
      "Transfer legs must be changed together. Exclude transfers from your selection.",
    );
  return storeOf(client).saveTransactions(rows.map((row) => categorised(row, category)));
}
export async function deleteTransaction(client: MoneyClient, row: Transaction) {
  return storeOf(client).deleteTransaction(row.id.slice(row.id.indexOf("#") + 1), row.postingTime);
}
export async function createTransfer(
  client: MoneyClient,
  key: string,
  from: AccountSummary,
  to: AccountSummary,
  date: string,
  amount: string,
) {
  parseMoney(from.currency, amount);
  if (from.currency !== to.currency)
    throw new Error("Transfers require accounts with the same currency");
  return storeOf(client).transfer(key, from.id, to.id, date, { amount, currency: from.currency });
}

/** Remove absent optional fields rather than persisting an undefined value. */
export function categorised<T extends { category?: string }>(
  row: T,
  category: string | undefined,
): T {
  const result = { ...row };
  if (category === undefined) delete result.category;
  else result.category = category;
  return result;
}
