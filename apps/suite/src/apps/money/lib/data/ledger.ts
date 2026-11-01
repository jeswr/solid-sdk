// AUTHORED-BY Codex GPT-6
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import {
  addAmounts,
  conditionalHeaders,
  MoneyDocument,
  MoneyIoError,
  createTransfer as modelTransfer,
  monthKey,
  type Precondition,
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
  validateTransaction(row);
  const persisted = (await allTransactions(client)).find(
    (existing) => transactionKey(existing.id) === key,
  );
  if (persisted) {
    if (!sameTransaction(persisted, row)) throw new MoneyIoError(412);
    return persisted;
  }
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
  if (value.id !== original.id) throw new Error("A transaction ID cannot change");
  const source = await store.read(original.id.slice(0, original.id.indexOf("#")));
  const current = source.document.transactions().find((row) => row.id === original.id);
  const moving = monthKey(original.postingTime) !== monthKey(value.postingTime);
  const moved = {
    ...value,
    id: `${store.resolve(`transactions/${monthKey(value.postingTime)}.ttl`)}#${original.id.split("#")[1]}`,
  };
  // Compare the record the editor actually read; a new shard ETag alone cannot detect stale forms.
  if (current && !sameTransaction(current, original)) throw new MoneyIoError(412);
  if (!current && !moving) throw new MoneyIoError(412);
  if (moving) {
    const destination = await store.read(moved.id.slice(0, moved.id.indexOf("#")));
    const existing = destination.document.transactions().find((row) => row.id === moved.id);
    if (existing && !sameTransaction(existing, moved)) throw new MoneyIoError(412);
    // An identical destination is a previous partially completed attempt. Never overwrite it.
    if (!existing) {
      if (!current) throw new MoneyIoError(412);
      putTransaction(destination.document, moved);
      await store.write(destination.url, destination.document, destination.condition);
    }
    if (current) {
      try {
        await deleteAtVersion(client, original, source.condition);
      } catch (cause) {
        throw new Error(
          "The destination was saved, but the move did not finish. Retry the same edit to finish safely; both copies may currently be visible.",
          { cause },
        );
      }
    }
    return moved;
  }
  putTransaction(source.document, value);
  await store.write(source.url, source.document, source.condition);
  return value;
}
function sameTransaction(left: Transaction, right: Transaction) {
  // Ledger rows also carry presentation fields such as runningBalance. Compare persisted fields only.
  return (
    [
      "id",
      "account",
      "postingTime",
      "amount",
      "currency",
      "description",
      "category",
      "payee",
      "derivedFrom",
      "debitAccount",
      "creditAccount",
    ] as const
  ).every((key) => left[key] === right[key]);
}
/** Reuse the model's RDF deletion, pinned to the document version whose transaction we checked. */
async function deleteAtVersion(client: MoneyClient, row: Transaction, condition: Precondition) {
  const headers = conditionalHeaders(condition);
  const store = storeOf({
    ...client,
    fetch: (input, init) =>
      client.fetch(
        input,
        init?.method === "PUT"
          ? { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...headers } }
          : init,
      ),
  });
  return store.deleteTransaction(transactionKey(row.id), row.postingTime);
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
  const store = storeOf(client);
  const saved: string[] = [];
  for (const key of new Set(rows.map((row) => monthKey(row.postingTime)))) {
    const loaded = await store.read(`transactions/${key}.ttl`);
    const current = loaded.document.transactions();
    for (const row of rows.filter((row) => monthKey(row.postingTime) === key)) {
      const latest = current.find((value) => value.id === row.id);
      if (!latest || latest.debitAccount || latest.creditAccount) throw new MoneyIoError(412);
      putTransaction(loaded.document, categorised(latest, category));
    }
    await store.write(loaded.url, loaded.document, loaded.condition);
    saved.push(loaded.url);
  }
  return saved;
}
export async function deleteTransaction(client: MoneyClient, row: Transaction) {
  const loaded = await storeOf(client).read(row.id.slice(0, row.id.indexOf("#")));
  const current = loaded.document.transactions().find((value) => value.id === row.id);
  if (!current || !sameTransaction(current, row)) throw new MoneyIoError(412);
  return deleteAtVersion(client, row, loaded.condition);
}
/** The fragment remains stable when a transaction is explicitly moved to another month. */
export function transactionKey(id: string) {
  return id.slice(id.indexOf("#") + 1);
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
  const store = storeOf(client);
  // Use the model to validate and construct both expected legs, without issuing a write.
  const expected = modelTransfer(
    new MoneyDocument(),
    store.transactionId(key, date),
    from.id,
    to.id,
    date,
    {
      amount,
      currency: from.currency,
    },
  );
  const persisted = (await allTransactions(client)).filter((row) =>
    expected.some((leg) => transactionKey(leg.id) === transactionKey(row.id)),
  );
  if (persisted.length) {
    if (!expected.every((leg) => persisted.some((row) => sameTransaction(row, leg))))
      throw new MoneyIoError(412);
    return persisted;
  }
  return store.transfer(key, from.id, to.id, date, { amount, currency: from.currency });
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
