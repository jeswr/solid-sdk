// AUTHORED-BY Codex GPT-6
import {
  type CategoryRule,
  type CsvOptions,
  categoriseTransactions,
  detectDuplicates,
  type ImportedTransaction,
  importCsv,
  importOfx,
  parseCsv,
  sniffDateFormat,
  sniffDelimiter,
} from "../import";
import { importStatement, MoneyIoError, monthKey, type Transaction } from "../model";
import { parseMoney } from "../reports";
import { type MoneyClient, storeOf } from "./container";
import { allTransactions, categorised } from "./ledger";
export function detectFormat(name: string, text: string): "csv" | "ofx" {
  if (/\.pdf$/i.test(name) || text.startsWith("%PDF"))
    throw new Error("PDF statements are not supported yet. Export CSV or OFX from your bank.");
  if (/\.(ofx|qfx)$/i.test(name) || /<OFX[>\s]/i.test(text)) return "ofx";
  sniffDelimiter(text);
  return "csv";
}
export function suggestMapping(text: string) {
  const delimiter = sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);
  const headers = rows[0] as string[];
  const find = (pattern: RegExp) => headers.findIndex((value) => pattern.test(value.trim()));
  const date = find(/^(date|posted|posting date|transaction date)$/i);
  const description = find(/^(description|payee|merchant|details|narrative)$/i);
  const amount = find(/^(amount|value|signed amount)$/i);
  const debit = find(/^(debit|money out|withdrawal)$/i);
  const credit = find(/^(credit|money in|deposit)$/i);
  const dateFormat = sniffDateFormat([headers[0] as string]);
  const hasHeader = dateFormat === null;
  const currency = find(/^currency$/i);
  const balanceColumn = find(/^(balance|running balance)$/i);
  const columns = !hasHeader
    ? { date: 0, description: 1, amount: 2 }
    : {
        ...(currency >= 0 ? { currency } : {}),
        date: Math.max(0, date),
        description: Math.max(0, description),
        ...(amount >= 0
          ? { amount }
          : { ...(debit >= 0 ? { debit } : {}), ...(credit >= 0 ? { credit } : {}) }),
      };
  return {
    headers,
    rows,
    balanceColumn,
    sample: rows.slice(hasHeader ? 1 : 0, hasHeader ? 4 : 3),
    options: {
      delimiter,
      columns,
      hasHeader,
      ...(dateFormat ? { dateFormat } : {}),
    } satisfies CsvOptions,
  };
}
/** Stable content identity, independent of file name and chosen account. */
export function statementId(text: string) {
  let hash = BigInt("14695981039346656037");
  for (const character of text)
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * BigInt("1099511628211"));
  return `statement-${hash.toString(16)}`;
}
export interface PreviewRow {
  row: ImportedTransaction;
  index: number;
  duplicate: boolean;
  include: boolean;
  category?: string | undefined;
}
export async function previewImport(
  client: MoneyClient,
  account: string,
  currency: string,
  text: string,
  format: "csv" | "ofx",
  options: CsvOptions,
  rules: readonly CategoryRule[] = [],
): Promise<PreviewRow[]> {
  const incoming = format === "csv" ? importCsv(text, { ...options, currency }) : importOfx(text);
  if (incoming.some((row) => row.currency !== undefined && row.currency !== currency))
    throw new Error("Statement currency mismatch");
  for (const row of incoming) parseMoney(currency, row.amount);
  const months = new Set(incoming.map((row) => row.date.slice(0, 7)));
  const existing = (await allTransactions(client))
    .filter(
      (row) =>
        row.account === account &&
        row.currency === currency &&
        months.has(row.postingTime.slice(0, 7)),
    )
    .map((row) => ({
      date: row.postingTime.slice(0, 10),
      amount: row.amount,
      description: row.description,
    }));
  const duplicates = new Set(detectDuplicates(incoming, existing).duplicates);
  return categoriseTransactions(incoming, rules).map((row, index) => ({
    row,
    index,
    duplicate: duplicates.has(incoming[index] as ImportedTransaction),
    include: !duplicates.has(incoming[index] as ImportedTransaction),
    category: row.category,
  }));
}
export async function commitImport(
  client: MoneyClient,
  account: string,
  currency: string,
  text: string,
  format: "csv" | "ofx",
  options: CsvOptions,
  preview: readonly PreviewRow[],
  progress: (done: number, total: number) => void,
) {
  const store = storeOf(client);
  const statement =
    format === "csv"
      ? ({ format, text, options: { ...options, currency } } as const)
      : ({ format, text } as const);
  const checked = await importStatement(
    {
      ...store,
      put: async (path, body, contentType, condition) => {
        try {
          return await store.put(path, body, contentType, condition);
        } catch (error) {
          if (error instanceof MoneyIoError && error.status === 412)
            throw new Error(
              "This statement has already been imported. Open the ledger to review it.",
            );
          throw error;
        }
      },
      saveTransactions: async (values) => {
        const included = values.flatMap((row, index) =>
          preview[index]?.include ? [categorised(row, preview[index].category)] : [],
        );
        const shards = new Map<string, Transaction[]>();
        for (const row of included) {
          const key = monthKey(row.postingTime);
          const group = shards.get(key) ?? [];
          group.push(row);
          shards.set(key, group);
        }
        const saved: string[] = [];
        progress(0, shards.size);
        for (const rows of shards.values()) {
          saved.push(...(await store.saveTransactions(rows)));
          progress(saved.length, shards.size);
        }
        return saved;
      },
    },
    statementId(text),
    account,
    currency,
    statement,
  );
  return {
    ...checked,
    transactions: checked.transactions.flatMap((row, index) => {
      const entry = preview[index] as PreviewRow;
      return entry.include ? [categorised(row, entry.category)] : [];
    }),
    count: preview.filter((row) => row.include).length,
  };
}
