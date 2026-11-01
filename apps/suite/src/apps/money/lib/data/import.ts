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
import {
  conditionalHeaders,
  importStatement,
  MoneyIoError,
  monthKey,
  putTransaction,
} from "../model";
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
interface ImportPlan {
  account: string;
  currency: string;
  format: "csv" | "ofx";
  options: CsvOptions;
  selection: { include: boolean; category?: string | undefined }[];
  status: "pending" | "completed";
}
export class PendingImportError extends Error {
  constructor() {
    super(
      "This statement has an unfinished import. Resume import to recover missing rows using the original mapping and selection.",
    );
  }
}
async function readImportPlan(client: MoneyClient, text: string) {
  const journal = storeOf(client).resolve(`statements/${statementId(text)}.import.json`);
  const response = await client.fetch(journal, { redirect: "error" });
  if (!response.ok && response.status !== 404) throw new MoneyIoError(response.status);
  const previous: ImportPlan | undefined = response.ok ? await response.json() : undefined;
  return { journal, response, previous };
}
export async function importStatus(client: MoneyClient, text: string) {
  return (await readImportPlan(client, text)).previous?.status ?? "new";
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
  recover = false,
) {
  const store = storeOf(client);
  const key = statementId(text);
  const { journal, response, previous } = await readImportPlan(client, text);
  const alreadyImported = () =>
    new Error("This statement has already been imported. Open the ledger to review it.");
  if (previous?.status === "completed") throw alreadyImported();
  if (previous && !recover) throw new PendingImportError();
  if (
    previous &&
    (previous.account !== account || previous.currency !== currency || previous.format !== format)
  )
    throw new Error(
      "Resume this import in its original account and currency using the original format.",
    );
  const plan: ImportPlan = previous ?? {
    account,
    currency,
    format,
    options,
    selection: preview.map(({ include, category }) => ({ include, category })),
    status: "pending",
  };
  let condition = previous
    ? { etag: response.headers.get("etag") ?? "" }
    : { create: true as const };
  const statement =
    format === "csv"
      ? ({ format, text, options: { ...plan.options, currency } } as const)
      : ({ format, text } as const);
  const checked = await importStatement(
    {
      ...store,
      put: async (path, body, contentType, sourceCondition) => {
        // The original may have been saved just before a failed write/response. Never replace it.
        const original = await client.fetch(store.resolve(path), { redirect: "error" });
        if (!original.ok && original.status !== 404) throw new MoneyIoError(original.status);
        if (original.ok && (!previous || (await original.text()) !== text)) throw alreadyImported();
        const reserved = await store.put(
          journal,
          JSON.stringify(plan),
          "application/json",
          condition,
        );
        condition = { etag: reserved.headers.get("etag") ?? "" };
        conditionalHeaders(condition);
        return original.ok ? original : store.put(path, body, contentType, sourceCondition);
      },
      saveTransactions: async (values) => {
        const included = values.flatMap((row, index) =>
          plan.selection[index]?.include ? [categorised(row, plan.selection[index].category)] : [],
        );
        const shards = new Map<string, typeof included>();
        for (const row of included) {
          const month = monthKey(row.postingTime);
          const group = shards.get(month) ?? [];
          group.push(row);
          shards.set(month, group);
        }
        const saved: string[] = [];
        progress(0, shards.size);
        for (const [month, rows] of shards) {
          const loaded = await store.read(`transactions/${month}.ttl`);
          const existing = new Set(loaded.document.transactions().map((row) => row.id));
          const missing = rows.filter((row) => !existing.has(row.id));
          // Recovery fills gaps only, preserving edits to rows saved by a previous attempt.
          if (missing.length) {
            for (const row of missing) putTransaction(loaded.document, row);
            await store.write(loaded.url, loaded.document, loaded.condition);
          }
          saved.push(loaded.url);
          progress(saved.length, shards.size);
        }
        await store.put(
          journal,
          JSON.stringify({ ...plan, status: "completed" }),
          "application/json",
          condition,
        );
        return saved;
      },
    },
    key,
    account,
    currency,
    statement,
  );
  const transactions = checked.transactions.flatMap((row, index) => {
    const entry = plan.selection[index]!;
    return entry.include ? [categorised(row, entry.category)] : [];
  });
  return { ...checked, transactions, count: transactions.length };
}
