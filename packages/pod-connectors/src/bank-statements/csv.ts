// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { hasText } from "@jeswr/solid-money";
import { MAX_CSV_COLUMNS, MAX_CSV_HEADER_CHARS, parseCsv, parseCsvRows } from "../core/csv.js";
import { MAX_FILE_BYTES, MAX_ROWS } from "../core/file-import.js";
import { MAX_CSV_RECORD_BYTES } from "../core/file-stream.js";
import { genericBankRowParser } from "./generic-csv.js";
import {
  amountKey,
  bankDate,
  bankDateFormatter,
  currencyCode,
  normaliseAmount,
  subtractAmount,
} from "./values.js";

export const MAX_BANK_FIELD_CHARS = 16 * 1024;
/** The explicit `csvFormat` values; omit `csvFormat` to detect the layout from the contents. */
export const BANK_CSV_FORMATS = ["revolut", "hsbc-uk", "monzo", "starling"] as const;
export type BankCsvFormat = (typeof BANK_CSV_FORMATS)[number];
/** Longest accepted `accountLabel`, in Unicode code points after `normaliseAccountLabel`. */
export const MAX_BANK_ACCOUNT_LABEL_CHARS = 256;
const INVISIBLE_LABEL_CHARS = /[\p{Cc}\p{Cf}]/gu;
/**
 * The one form of an `accountLabel` that is hashed into the account folder and stored as its
 * display label: control and format characters (Unicode Cc and Cf, including zero-width and
 * bidi controls) removed, then NFC, then trimmed. A plain label is unchanged, so its folder is
 * the same as before normalisation existed. Stripping precedes NFC so a removed character
 * cannot leave a decomposed sequence behind; the result is idempotent.
 */
export function normaliseAccountLabel(label: string): string {
  return label.replace(INVISIBLE_LABEL_CHARS, "").normalize("NFC").trim();
}
export interface BankStatementOptions {
  /** Headerless HSBC data is ambiguous: only an explicit choice admits it. */
  readonly csvFormat?: BankCsvFormat;
  /** Stable identity for exports without an account identifier; never a filename. */
  readonly accountLabel?: string;
  /** HSBC UK defaults to GBP. Other CSV currencies come from the header/row. */
  readonly currency?: string;
  /** IANA zone for zone-free Revolut timestamps; defaults to Europe/London. */
  readonly timeZone?: string;
}
export interface Transaction {
  readonly date?: Date;
  readonly postingTime?: string;
  readonly description: string;
  readonly amount: string;
  readonly currency?: string;
  readonly bank?: BankCsvFormat;
  readonly accountKey?: string;
  readonly accountLabel?: string;
  readonly sourceId?: string;
  /** Revolut Amount excludes Fee; amount is Amount - Fee and fee is retained. */
  readonly fee?: string;
  readonly balance?: string;
  /** HSBC has no native ID/balance: distinguish identical rows within this file. */
  readonly occurrence?: number;
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
/**
 * Monzo exports vary by app version and plan: the short layout has the first 11 columns,
 * full exports add notes, address, receipt, description, category split and money out/in.
 * Detection is by column name (any order): every required column, only known columns,
 * paired columns together, and no duplicates. Anything else is not Monzo.
 */
const MONZO_REQUIRED = [
  "transaction id",
  "date",
  "time",
  "type",
  "name",
  "amount",
  "currency",
] as const;
const MONZO_OPTIONAL = [
  "emoji",
  "category",
  "local amount",
  "local currency",
  "notes and #tags",
  "address",
  "receipt",
  "description",
  "category split",
  "money out",
  "money in",
] as const;
const MONZO_PAIRS = [
  ["local amount", "local currency"],
  ["money out", "money in"],
] as const;
type BankLayout = keyof typeof HEADERS | "monzo";
const BANK_LAYOUTS: readonly BankLayout[] = ["revolut", "monzo", "starling"];
const DISTINCTIVE_HEADERS: Record<BankLayout, readonly string[]> = {
  revolut: ["product", "state", "started date", "completed date"],
  monzo: ["transaction id", "emoji", "local amount", "notes and #tags", "category split"],
  starling: ["counter party", "amount (gbp)", "spending category"],
};
const normaliseHeader = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Exact Revolut/Starling layouts; Monzo by its required and known optional columns. */
function matchesLayout(bank: BankLayout, headers: readonly string[]): boolean {
  if (bank !== "monzo")
    return (
      headers.length === HEADERS[bank].length &&
      HEADERS[bank].every((header, i) => headers[i] === header)
    );
  const names = new Set(headers);
  const known = new Set<string>([...MONZO_REQUIRED, ...MONZO_OPTIONAL]);
  return (
    names.size === headers.length &&
    headers.every((header) => known.has(header)) &&
    MONZO_REQUIRED.every((header) => names.has(header)) &&
    MONZO_PAIRS.every(([left, right]) => names.has(left) === names.has(right))
  );
}

/**
 * Known-bank posting dates must fall between 1970-01-01 and one year after the import, so a
 * hostile or corrupt export cannot spread rows over thousands of month documents. Rows outside
 * the window are skipped and counted.
 */
export const EARLIEST_BANK_POSTING = "1970-01-01";
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;
function plausiblePosting(postingTime: string, now: number): boolean {
  const instant = Date.parse(postingTime.length === 10 ? `${postingTime}T00:00:00Z` : postingTime);
  return (
    instant >= Date.parse(`${EARLIEST_BANK_POSTING}T00:00:00Z`) && instant <= now + MAX_FUTURE_MS
  );
}

/** First candidate with visible text once control characters are stripped (as on write). */
function visibleText(...candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => candidate && hasText(candidate));
}

export class UnrecognisedBankCsvError extends Error {
  constructor(headers: readonly string[], bank?: BankLayout) {
    // Bounded diagnostics; JSON quoting keeps control characters inert too.
    super(
      `Unrecognised CSV; ${bank ? `looks like ${bank === "revolut" ? "Revolut" : bank === "monzo" ? "Monzo" : "Starling"} but the columns differ; ` : ""}detected headers: ${JSON.stringify(headers.slice(0, 32).map((h) => h.slice(0, 128)))}${headers.length > 32 || headers.some((h) => h.length > 128) ? " (header list truncated)" : ""}. Choose a supported bank export; headerless HSBC UK requires csvFormat: "hsbc-uk" and accountLabel.`,
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
    !(BANK_CSV_FORMATS as readonly string[]).includes(options.csvFormat)
  )
    throw new TypeError("Unsupported bank CSV format");
  if (options.accountLabel !== undefined) {
    const label =
      typeof options.accountLabel === "string" ? normaliseAccountLabel(options.accountLabel) : "";
    // Code points, so an emoji counts once; the normalised form is what gets stored.
    if (!label || [...label].length > MAX_BANK_ACCOUNT_LABEL_CHARS)
      throw new TypeError("Account label must contain 1–256 characters");
  }
  if (options.currency !== undefined && !currencyCode(options.currency))
    throw new TypeError("Currency must be an uppercase ISO 4217 code supported by the runtime");
  if (options.csvFormat === "hsbc-uk" && !options.accountLabel)
    throw new TypeError("Headerless HSBC UK requires a user-provided accountLabel");
  if (options.timeZone !== undefined) bankDateFormatter(options.timeZone);
}

/** Detect once, then access indexed cells (no untrusted object property keys). */
export class BankCsvParser {
  private format?: BankCsvFormat | "generic";
  private headers: string[] = [];
  private rows = 0;
  private genericRow?: ReturnType<typeof genericBankRowParser>;
  private genericRows = 0;
  private truncated = false;
  private legacyRow?: (cells: readonly string[]) => Transaction | undefined;
  private readonly occurrences = new Map<string, number>();
  private readonly formatter: Intl.DateTimeFormat;
  /** The normalised label: one string for the account hash and the stored display label. */
  private readonly accountLabel?: string;
  constructor(
    private readonly options: BankStatementOptions,
    private readonly maxRows: number,
    private readonly skip: () => void,
    private readonly synchronous = false,
    private readonly onBankRow?: (txn: Transaction, legacy?: Transaction) => void,
  ) {
    validateBankOptions(options);
    this.accountLabel =
      options.accountLabel === undefined ? undefined : normaliseAccountLabel(options.accountLabel);
    this.formatter = bankDateFormatter(options.timeZone);
    if (maxRows !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxRows) || maxRows < 0))
      throw new RangeError("Bank row limit must be a nonnegative safe integer");
  }
  skippedRecord(): void {
    if (this.countRow()) this.skip();
  }
  get isGeneric(): boolean {
    return this.format === "generic";
  }
  get isTruncated(): boolean {
    return this.truncated;
  }
  private genericRecord(record: string): Transaction | undefined {
    if (!this.countRow()) return undefined;
    if (this.genericRows >= this.maxRows) return undefined;
    const cells = parseCsvRows(
      record,
      ",",
      this.synchronous ? Number.POSITIVE_INFINITY : this.headers.length,
      this.skip,
    )[0];
    if (!cells) return undefined;
    const row = Object.fromEntries(
      this.headers.map((header, i) => [header, (cells[i] ?? "").trim()]),
    );
    const txn = this.genericRow?.(row);
    if (txn) this.genericRows++;
    return txn;
  }
  private countRow(): boolean {
    // The synchronous generic helper keeps its historical result limit; every
    // source row still consumes the hard budget, even after that result limit.
    const cap = this.synchronous && this.isGeneric ? MAX_ROWS : Math.min(MAX_ROWS, this.maxRows);
    if (this.rows >= cap) {
      if (!this.isGeneric) throw new Error("Bank statement row cap exceeded; split the export");
      this.truncated = true;
      return false;
    }
    this.rows++;
    return true;
  }
  record(record: string): Transaction | undefined {
    if (this.isGeneric) return this.genericRecord(record);
    const first = this.headers.length === 0 && this.format === undefined;
    if (!first) this.countRow();
    if (first && record.length > MAX_CSV_HEADER_CHARS)
      throw new Error("CSV header exceeds the 64 KiB character import limit");
    let cells: string[];
    try {
      cells = first ? [...parseCsv(record).headers] : bankCsvCells(record.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (first) throw error;
      this.skip();
      return undefined;
    }
    if (first) {
      const headers = cells.map(normaliseHeader);
      const banks = BANK_LAYOUTS;
      const format = banks.find((bank) => matchesLayout(bank, headers));
      if (
        format &&
        (!this.options.csvFormat || this.options.csvFormat === format) &&
        new Set(headers.filter(Boolean)).size === headers.filter(Boolean).length
      ) {
        bankCsvCells(record.replace(/^\uFEFF/, ""));
        this.format = format;
        this.headers = headers;
        const parseLegacy = genericBankRowParser(cells);
        this.legacyRow = (values) =>
          parseLegacy(Object.fromEntries(cells.map((header, i) => [header, values[i] ?? ""])));
        return undefined;
      }
      if (!format) {
        const names = new Set(headers);
        const nearMiss = banks
          .map((bank) => ({
            bank,
            shared: DISTINCTIVE_HEADERS[bank].filter((header) => names.has(header)).length,
          }))
          .sort((left, right) => right.shared - left.shared)
          .find(({ shared }) => shared >= 2)?.bank;
        if (nearMiss) throw new UnrecognisedBankCsvError(cells, nearMiss);
      }
      if (!format && !this.options.csvFormat) {
        // Headerless HSBC is never inferred. Other unmatched headers retain the
        // original generic parser, aliases, permissive values and row-derived IDs.
        if (cells.length === 3 && bankDate(cells[0] ?? "", true))
          throw new UnrecognisedBankCsvError(cells);
        this.format = "generic";
        this.headers = cells;
        this.genericRow = genericBankRowParser(cells);
        return undefined;
      }
      if (
        this.options.csvFormat !== "hsbc-uk" ||
        cells.length !== 3 ||
        !bankDate(cells[0] ?? "", true) ||
        !visibleText(cells[1] ?? "") ||
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
          ? bankDate(get("completed date"), false, this.formatter)
          : bank === "monzo"
            ? bankDate(get("date"), true)
            : (bankDate(get("date"), true) ?? bankDate(get("date")));
    // Fall back to the bank's own description/type columns when the primary text is empty
    // or only control characters; rows with no visible text at all are skipped.
    const description =
      bank === "hsbc-uk"
        ? visibleText(cells[1] ?? "")
        : bank === "monzo"
          ? visibleText(get("name"), get("description"), get("type"))
          : bank === "starling"
            ? visibleText(
                [get("counter party"), get("reference")]
                  .filter((part) => visibleText(part))
                  .join(" — "),
                get("type"),
              )
            : visibleText(get("description"), get("type"));
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
      !plausiblePosting(postingTime, Date.now()) ||
      !description ||
      !currencyCode(currency) ||
      (this.options.currency !== undefined && this.options.currency !== currency) ||
      amount === undefined ||
      (bank === "revolut" && (fee === undefined || !product || balance === undefined)) ||
      (bank === "starling" && balance === undefined) ||
      (bank === "monzo" && !sourceId)
    ) {
      this.skip();
      return undefined;
    }
    const label =
      this.accountLabel ??
      `${bank === "revolut" ? `Revolut ${product}` : bank === "monzo" ? "Monzo" : "Starling"} ${currency}`;
    const txn: Transaction = {
      bank,
      postingTime,
      date: new Date(postingTime),
      description,
      amount: fee === undefined ? amount : subtractAmount(amount, fee),
      currency,
      fee,
      balance,
      sourceId,
      accountKey: JSON.stringify([bank, this.accountLabel ?? "", product, currency]),
      accountLabel: label,
    };
    this.onBankRow?.(txn, this.legacyRow?.(cells));
    if (bank !== "hsbc-uk") return txn;
    const key = transactionKey(txn);
    const occurrence = this.occurrences.get(key) ?? 0;
    this.occurrences.set(key, occurrence + 1);
    return { ...txn, occurrence };
  }
}

/** Synchronous compatibility helper, using the same record mapper as streaming imports. */
export function parseBankCsv(
  text: string,
  limit = Number.POSITIVE_INFINITY,
  options: BankStatementOptions = {},
): Transaction[] {
  if (text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES)
    throw new Error("Export exceeds the 64 MiB import limit");
  const parser = new BankCsvParser(options, limit, () => {}, true);
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
      if (parser.isTruncated) return result;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    start = i + 1;
  }
  if (quoted) throw new Error("Unterminated quoted CSV record in export");
  return result;
}

export function transactionKey(txn: Transaction): string {
  return JSON.stringify([
    txn.accountKey,
    txn.sourceId
      ? ["id", txn.sourceId]
      : [
          txn.postingTime ?? txn.date?.toISOString(),
          txn.description,
          amountKey(txn.amount),
          txn.currency ?? "",
          txn.balance === undefined ? "" : amountKey(txn.balance),
          ...(txn.occurrence === undefined ? [] : [txn.occurrence]),
        ],
  ]);
}
