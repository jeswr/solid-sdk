// AUTHORED-BY Codex GPT-6.1-Sol
import { type CsvOptions, type ImportedTransaction, importCsv, importOfx } from "../import";
import type { MoneyStore } from "./io";
import type { Transaction } from "./types";
import { identifier, iri, validateMoney, validateTransaction } from "./validation";

export type Statement =
  | { readonly format: "csv"; readonly text: string; readonly options: CsvOptions }
  | { readonly format: "ofx"; readonly text: string }
  | { readonly format: "pdf"; readonly file: Blob; readonly adapter: PdfStatementAdapter };
/** PDF layout/OCR extraction stays outside the pure model, just like the injected fetch. */
export type PdfStatementAdapter = (file: Blob) => Promise<readonly ImportedTransaction[]>;
export async function importStatement(
  store: MoneyStore,
  key: string,
  account: string,
  currency: string,
  statement: Statement,
) {
  validateMoney({ amount: "0", currency });
  identifier(key);
  iri(account);
  const path = `statements/${key}.${statement.format}`;
  const source = store.resolve(path);
  let rows: readonly ImportedTransaction[];
  let body: BodyInit;
  let contentType: string;
  if (statement.format === "pdf") {
    rows = await statement.adapter(statement.file);
    body = statement.file;
    contentType = "application/pdf";
  } else {
    rows =
      statement.format === "csv"
        ? importCsv(statement.text, statement.options)
        : importOfx(statement.text);
    body = statement.text;
    contentType = statement.format === "csv" ? "text/csv" : "application/x-ofx";
  }
  // A known account mixed with an unidentified source is ambiguous too.
  if (new Set(rows.map((row) => row.accountId)).size > 1)
    throw new TypeError("Multiple source accounts require separate statement imports");
  const values: Transaction[] = rows.map((row, index) => {
    if (row.currency !== undefined && row.currency !== currency)
      throw new TypeError("Statement currency mismatch");
    const value: Transaction = {
      id: `${store.transactionId(key, row.date)}-${statement.format}-${index}`,
      account,
      postingTime: row.date,
      amount: row.amount,
      currency,
      description: row.description,
      derivedFrom: source,
    };
    validateTransaction(value);
    return value;
  });
  // Validation finishes before any writes. Keep the original even if a later shard conflicts.
  await store.put(path, body, contentType, { create: true });
  const shards = await store.saveTransactions(values);
  return { source, transactions: values, shards };
}
