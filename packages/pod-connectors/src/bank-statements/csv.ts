// AUTHORED-BY Codex GPT-6.1-Sol
import { MAX_CSV_COLUMNS, MAX_CSV_HEADER_CHARS, parseCsvRows } from "../core/csv.js";
import { MAX_FILE_BYTES, MAX_ROWS } from "../core/file-import.js";
import { MAX_CSV_RECORD_BYTES } from "../core/file-stream.js";
import { amountKey, bankDate, currencyCode, normaliseAmount, subtractAmount } from "./values.js";

export const MAX_BANK_FIELD_CHARS = 16 * 1024;
export type BankCsvFormat = "revolut" | "hsbc-uk" | "monzo" | "starling";
export interface BankStatementOptions {
  /** Headerless HSBC data is ambiguous: only an explicit choice admits it. */
  readonly csvFormat?: BankCsvFormat;
  /** Stable identity for exports without an account identifier; never a filename. */
  readonly accountLabel?: string;
  /** HSBC UK defaults to GBP. Other CSV currencies come from the header/row. */
  readonly currency?: string;
}
export interface Transaction {
  readonly date?: Date;
  readonly postingTime?: string;
  readonly description: string;
  readonly amount: string;
  readonly currency?: string;
  readonly bank?: BankCsvFormat | "ofx";
  readonly accountKey?: string;
  readonly accountLabel?: string;
  readonly sourceId?: string;
  /** Revolut Amount excludes Fee; amount is Amount - Fee and fee is retained. */
  readonly fee?: string;
  readonly balance?: string;
}

const HEADERS = {
  revolut: [
    "type",
    "product",
    "started date",
    "completed date",
    "description",
    "amount",
    "fee",
    "currency",
    "state",
    "balance",
  ],
  monzo: [
    "transaction id",
    "date",
    "time",
    "type",
    "name",
    "emoji",
    "category",
    "amount",
    "currency",
  ],
  starling: [
    "date",
    "counter party",
    "reference",
    "type",
    "amount (gbp)",
    "balance (gbp)",
    "spending category",
    "notes",
  ],
} as const;
const normaliseHeader = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export class UnrecognisedBankCsvError extends Error {
  constructor(headers: readonly string[]) {
    // Bounded diagnostics; JSON quoting keeps control characters inert too.
    super(
      `Unrecognised CSV; detected headers: ${JSON.stringify(headers.slice(0, 32).map((h) => h.slice(0, 128)))}${headers.length > 32 || headers.some((h) => h.length > 128) ? " (header list truncated)" : ""}. Choose a supported bank export; headerless HSBC UK requires csvFormat: "hsbc-uk" and accountLabel.`,
    );
  }
}

/** Strict syntax/field validation before the shared tokenizer allocates cells. */
export function bankCsvCells(record: string): string[] {
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let chars = 0;
  let columns = 1;
  for (let i = 0; i < record.length; i++) {
    const c = record[i];
    if (state === "quoted") {
      if (c === '"') {
        if (record[i + 1] === '"') i++;
        else {
          state = "closed";
          continue;
        }
      }
    } else if (c === ",") {
      if (++columns > MAX_CSV_COLUMNS) throw new Error("Bank CSV column cap exceeded");
      chars = 0;
      state = "start";
      continue;
    } else if (c === '"' && state === "start") {
      state = "quoted";
      continue;
    } else {
      if (c === '"' || state === "closed") throw new Error("Malformed bank CSV quoting");
      state = "plain";
    }
    if (++chars > MAX_BANK_FIELD_CHARS)
      throw new Error("Bank CSV field cap exceeded (16 KiB characters)");
  }
  if (state === "quoted") throw new Error("Unterminated quoted bank CSV field");
  return (parseCsvRows(record, ",", MAX_CSV_COLUMNS)[0] ?? []).map((cell) => cell.trim());
}

export function validateBankOptions(options: BankStatementOptions): void {
  if (
    options.csvFormat !== undefined &&
    !["revolut", "hsbc-uk", "monzo", "starling"].includes(options.csvFormat)
  )
    throw new TypeError("Unsupported bank CSV format");
  if (
    options.accountLabel !== undefined &&
    (!options.accountLabel.trim() || options.accountLabel.length > 256)
  )
    throw new TypeError("Account label must contain 1–256 characters");
  if (options.currency !== undefined && !currencyCode(options.currency))
    throw new TypeError("Currency must be an uppercase ISO 4217 code supported by the runtime");
  if (options.csvFormat === "hsbc-uk" && !options.accountLabel)
    throw new TypeError("Headerless HSBC UK requires a user-provided accountLabel");
}

/** Detect once, then access indexed cells (no untrusted object property keys). */
export class BankCsvParser {
  private format?: BankCsvFormat;
  private headers: string[] = [];
  private rows = 0;
  constructor(
    private readonly options: BankStatementOptions,
    private readonly maxRows: number,
    private readonly skip: () => void,
  ) {
    validateBankOptions(options);
    if (maxRows !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxRows) || maxRows < 0))
      throw new RangeError("Bank row limit must be a nonnegative safe integer");
  }
  skippedRecord(): void {
    this.countRow();
    this.skip();
  }
  private countRow(): void {
    if (++this.rows > Math.min(MAX_ROWS, this.maxRows))
      throw new Error("Bank statement row cap exceeded; split the export");
  }
  record(record: string): Transaction | undefined {
    const first = this.headers.length === 0 && this.format === undefined;
    if (!first) this.countRow();
    if (first && record.length > MAX_CSV_HEADER_CHARS)
      throw new Error("CSV header exceeds the 64 KiB character import limit");
    let cells: string[];
    try {
      cells = bankCsvCells(record.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (first) throw error;
      this.skip();
      return undefined;
    }
    if (first) {
      const headers = cells.map(normaliseHeader);
      const format = (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).find((bank) =>
        HEADERS[bank].every((header, i) => headers[i] === header),
      );
      if (
        format &&
        (!this.options.csvFormat || this.options.csvFormat === format) &&
        new Set(headers.filter(Boolean)).size === headers.filter(Boolean).length
      ) {
        this.format = format;
        this.headers = headers;
        return undefined;
      }
      if (
        this.options.csvFormat !== "hsbc-uk" ||
        cells.length !== 3 ||
        !bankDate(cells[0] ?? "", true) ||
        !cells[1] ||
        normaliseAmount(cells[2] ?? "") === undefined
      )
        throw new UnrecognisedBankCsvError(cells);
      this.format = "hsbc-uk";
      this.countRow();
    }
    if (
      (this.format === "hsbc-uk" && cells.length !== 3) ||
      (this.format !== "hsbc-uk" && cells.length !== this.headers.length)
    ) {
      this.skip();
      return undefined;
    }
    const get = (header: string) => cells[this.headers.indexOf(header)] ?? "";
    const bank = this.format as BankCsvFormat;
    if (bank === "revolut" && get("state").toUpperCase() !== "COMPLETED") {
      this.skip();
      return undefined;
    }
    const currency =
      bank === "hsbc-uk"
        ? (this.options.currency ?? "GBP")
        : bank === "starling"
          ? "GBP"
          : get("currency");
    const postingTime =
      bank === "hsbc-uk"
        ? bankDate(cells[0] ?? "", true)
        : bank === "revolut"
          ? bankDate(get("completed date"))
          : bank === "monzo"
            ? bankDate(get("date"), true)
            : (bankDate(get("date"), true) ?? bankDate(get("date")));
    const description =
      bank === "hsbc-uk"
        ? (cells[1] ?? "")
        : bank === "monzo"
          ? get("name")
          : bank === "starling"
            ? [get("counter party"), get("reference")].filter(Boolean).join(" — ")
            : get("description");
    const amount = normaliseAmount(
      bank === "hsbc-uk" ? (cells[2] ?? "") : get(bank === "starling" ? "amount (gbp)" : "amount"),
    );
    const fee = bank === "revolut" ? normaliseAmount(get("fee")) : undefined;
    const balance =
      bank === "revolut" || bank === "starling"
        ? normaliseAmount(get(bank === "starling" ? "balance (gbp)" : "balance"))
        : undefined;
    const product = bank === "revolut" ? get("product") : "";
    const sourceId = bank === "monzo" ? get("transaction id") : undefined;
    if (
      !postingTime ||
      !description ||
      !currencyCode(currency) ||
      (this.options.currency !== undefined && this.options.currency !== currency) ||
      amount === undefined ||
      (bank === "revolut" &&
        (fee === undefined || fee.startsWith("-") || !product || balance === undefined)) ||
      (bank === "starling" && balance === undefined) ||
      (bank === "monzo" && !sourceId)
    ) {
      this.skip();
      return undefined;
    }
    const label =
      this.options.accountLabel?.trim() ??
      `${bank === "revolut" ? `Revolut ${product}` : bank === "monzo" ? "Monzo" : "Starling"} ${currency}`;
    return {
      bank,
      postingTime,
      date: new Date(postingTime),
      description,
      amount: fee === undefined ? amount : subtractAmount(amount, fee),
      currency,
      fee,
      balance,
      sourceId,
      accountKey: JSON.stringify([
        bank,
        this.options.accountLabel?.trim() ?? "",
        product,
        currency,
      ]),
      accountLabel: label,
    };
  }
}

/** Synchronous compatibility helper, using the same record mapper as streaming imports. */
export function parseBankCsv(
  text: string,
  limit = MAX_ROWS,
  options: BankStatementOptions = {},
): Transaction[] {
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES)
    throw new Error("Export exceeds the 64 MiB import limit");
  const parser = new BankCsvParser(options, limit, () => {});
  const result: Transaction[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    if (i < text.length && (quoted || (text[i] !== "\r" && text[i] !== "\n"))) continue;
    if (i - start > MAX_CSV_RECORD_BYTES) throw new Error("Bank CSV record cap exceeded");
    const record = text.slice(start, i);
    if (record.trim()) {
      const txn = parser.record(record);
      if (txn) result.push(txn);
    }
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    start = i + 1;
  }
  if (quoted) throw new Error("Unterminated quoted CSV record in export");
  return result;
}

export function transactionKey(txn: Transaction): string {
  return JSON.stringify([
    txn.accountKey ?? "ofx",
    txn.sourceId
      ? ["id", txn.sourceId]
      : [
          txn.postingTime ?? txn.date?.toISOString(),
          txn.description,
          amountKey(txn.amount),
          txn.currency ?? "",
          txn.balance === undefined ? "" : amountKey(txn.balance),
        ],
  ]);
}
