// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { latestBalance, monthKey, monthKeys, runningBalance } from "./helpers";
import { MoneyDocument, putTransaction, serialiseMoney, V } from "./rdf";
import { createTransfer } from "./transfer";
import type { Money, Range, Transaction } from "./types";
import { identifier, validateTransaction } from "./validation";

export type Precondition = { readonly etag: string } | { readonly create: true };
export class MoneyIoError extends Error {
  constructor(readonly status: number) {
    super(`Money request failed (${status})`);
    this.name = "MoneyIoError";
  }
}
export function conditionalHeaders(value: Precondition): Record<string, string> {
  if ("create" in value) return { "if-none-match": "*" };
  if (!/^"[^"\r\n]*"$/.test(value.etag)) throw new TypeError("A strong ETag is required");
  return { "if-match": value.etag };
}
function checked(response: Response): Response {
  if (!response.ok) throw new MoneyIoError(response.status);
  return response;
}
/** Caller supplies an authenticated transport and an already provisioned money container. */
export function createMoneyStore(fetch: typeof globalThis.fetch, moneyContainer: string) {
  const base = normalizePodBase(moneyContainer);
  const transport = createPodScopedFetch(base, { fetch: refuseRedirects(fetch) });
  function resolve(path: string): string {
    const result = assertWithinPodScope(base, path, { allowRoot: false });
    const url = new URL(result);
    if (url.hash || url.search) throw new TypeError("Expected a money document path");
    return result;
  }
  function transactionId(key: string, at: string): string {
    return `${resolve(`transactions/${monthKey(at)}.ttl`)}#${identifier(key)}`;
  }
  async function read(path: string) {
    const url = resolve(path);
    try {
      const result = await fetchRdf(url, { fetch: transport });
      return {
        document: new MoneyDocument(result.dataset),
        url,
        condition: { etag: result.etag ?? "" } as Precondition,
        exists: true,
      };
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      return {
        document: new MoneyDocument(),
        url,
        condition: { create: true } as Precondition,
        exists: false,
      };
    }
  }
  async function put(path: string, body: BodyInit, contentType: string, condition: Precondition) {
    const headers = conditionalHeaders(condition);
    return checked(
      await transport(resolve(path), {
        method: "PUT",
        headers: { "content-type": contentType, ...headers },
        body,
      }),
    );
  }
  async function write(path: string, document: MoneyDocument, condition: Precondition) {
    conditionalHeaders(condition);
    return put(path, await serialiseMoney(document), "text/turtle", condition);
  }
  async function accounts() {
    const listing = await read("accounts/");
    const container = new Container(resolve("accounts/"), listing.document.dataset, DataFactory);
    const documents = await Promise.all(
      [...container.contains].map((resource) => read(resolve(resource.value))),
    );
    const balances = documents.flatMap((result) => result.document.balances());
    return documents
      .flatMap((result) => result.document.accounts())
      .map((account) => ({ ...account, balance: latestBalance(balances, account.id) }));
  }
  /** Opening balance precedes the first requested month shard, not the filtered range. */
  async function transactions(account: string, range: Range, opening: Money) {
    const records: Transaction[] = [];
    for (const key of monthKeys(range))
      records.push(...(await read(`transactions/${key}.ttl`)).document.transactions());
    return runningBalance(records, account, opening, range);
  }
  /** Records must keep their month/subject identity. Cross-month moves need explicit delete/create. */
  async function saveTransactions(values: readonly Transaction[]) {
    const shards = new Map<string, Transaction[]>();
    for (const value of values) {
      validateTransaction(value);
      const path = `transactions/${monthKey(value.postingTime)}.ttl`;
      if (!value.id.startsWith(`${resolve(path)}#`))
        throw new TypeError("Transaction is outside its month shard");
      const rows = shards.get(path) ?? [];
      rows.push(value);
      shards.set(path, rows);
    }
    const saved: string[] = [];
    for (const [path, rows] of shards) {
      const loaded = await read(path);
      for (const value of rows) {
        if (loaded.document.node(value.id).types.has(V.transferClass))
          throw new TypeError("Transfer legs must be changed together");
      }
      for (const value of rows) putTransaction(loaded.document, value);
      await write(path, loaded.document, loaded.condition);
      saved.push(resolve(path));
    }
    return saved;
  }
  async function transfer(key: string, from: string, to: string, at: string, money: Money) {
    const id = transactionId(key, at);
    // Validate all transfer inputs before issuing the first request.
    createTransfer(new MoneyDocument(), id, from, to, at, money);
    const path = `transactions/${monthKey(at)}.ttl`;
    const loaded = await read(path);
    const pair = createTransfer(loaded.document, id, from, to, at, money);
    await write(path, loaded.document, loaded.condition);
    return pair;
  }
  async function deleteTransaction(key: string, at: string) {
    const id = transactionId(key, at);
    const path = `transactions/${monthKey(at)}.ttl`;
    const loaded = await read(path);
    const node = loaded.document.node(id);
    if (node.types.has(V.transferClass))
      throw new TypeError("Transfer legs must be changed together");
    const amount = node.amountNode;
    for (const quad of [...loaded.document.dataset.match(DataFactory.namedNode(id))])
      loaded.document.dataset.delete(quad);
    if (amount !== undefined && loaded.document.dataset.match(null, null, amount).size === 0)
      for (const quad of [...loaded.document.dataset.match(amount)])
        loaded.document.dataset.delete(quad);
    await write(path, loaded.document, loaded.condition);
  }
  return {
    resolve,
    transactionId,
    read,
    write,
    put,
    accounts,
    transactions,
    saveTransactions,
    transfer,
    deleteTransaction,
  };
}
export type MoneyStore = ReturnType<typeof createMoneyStore>;
