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
/** Raw labels longer than this are rejected before normalisation, which keeps it linear. */
const MAX_RAW_ACCOUNT_LABEL_UNITS = 4096;
const CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}]$/u;
const WHITESPACE_RUN = /\s+/gu;
const WHITESPACE = /^\s$/u;
const LONE_SURROGATE = /\p{Cs}/u;
/**
 * Labels holding these are rejected, not cleaned: bidi controls reorder what is shown against
 * what is stored, Arabic prepended marks change the display, and noncharacters have none.
 */
const REJECTED_LABEL_CHARS =
  /[؜‎‏‪-‮⁦-⁩؀-؅۝܏࢐࢑࣢\u{110BD}\u{110CD}﷐-﷯]|[￾￿]|[\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;
/** A character a person can see. Hangul fillers and the braille blank are letters/symbols that render empty. */
const VISIBLE_LABEL_CHAR = /[\p{L}\p{N}\p{P}\p{S}]/u;
const BLANK_LOOKING = new Set([0x115f, 0x1160, 0x3164, 0xffa0, 0x2800]);
const EMOJI = /^\p{Extended_Pictographic}$/u;
const EMOJI_TAIL = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|⃣)$/u;
const NON_LATIN_LETTER = /^[\p{L}\p{M}]$/u;
const LATIN_LIKE =
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]$/u;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;
const code = (char: string | undefined) => char?.codePointAt(0) ?? -1;
const isTag = (char: string | undefined) => code(char) >= 0xe0020 && code(char) <= CANCEL_TAG;
/** A subdivision flag spells its code in 2–6 tag digits or lowercase tag letters. */
const MIN_FLAG_TAGS = 2;
const MAX_FLAG_TAGS = 6;
const isFlagTag = (char: string | undefined) =>
  (code(char) >= 0xe0030 && code(char) <= 0xe0039) ||
  (code(char) >= 0xe0061 && code(char) <= 0xe007a);
const isShapingLetter = (char: string | undefined) =>
  char !== undefined && NON_LATIN_LETTER.test(char) && !LATIN_LIKE.test(char);

/**
 * Keeps a joiner or tag character only where it does visible work: ZWJ between emoji
 * (a family or profession sequence), ZWNJ between letters of a script that shapes with it
 * (Persian, Indic), and tags inside a well-formed subdivision flag (U+1F3F4, 2–6 tag digits or lowercase
 * tag letters, U+E007F).
 * Elsewhere they are invisible and could split one account into look-alike folders or carry
 * hidden text, so they are dropped. Their neighbours are never dropped, so one pass is stable.
 */
function dropStrayJoinersAndTags(chars: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? "";
    if (code(char) === BLACK_FLAG && isFlagTag(chars[i + 1])) {
      let end = i + 1;
      while (end < chars.length && end - i <= MAX_FLAG_TAGS && isFlagTag(chars[end])) end++;
      const tags = end - i - 1;
      if (code(chars[end]) === CANCEL_TAG && tags >= MIN_FLAG_TAGS && tags <= MAX_FLAG_TAGS) {
        kept.push(...chars.slice(i, end + 1));
        i = end;
        continue;
      }
    }
    if (isTag(char)) continue;
    if (
      code(char) === ZWJ &&
      !(EMOJI_TAIL.test(chars[i - 1] ?? "") && EMOJI.test(chars[i + 1] ?? ""))
    )
      continue;
    if (code(char) === ZWNJ && !(isShapingLetter(chars[i - 1]) && isShapingLetter(chars[i + 1])))
      continue;
    kept.push(char);
  }
  return kept;
}

/**
 * The one form of an `accountLabel` that is hashed into the account folder and stored as its
 * display label:
 * - labels with bidi controls, Arabic prepended marks, noncharacters or lone surrogates, or
 *   more than 4096 UTF-16 units, are rejected (normalise to "");
 * - other control and format characters (Unicode Cc and Cf) are removed, except joiners and
 *   tag characters that do visible work in an emoji, flag or shaped script;
 * - the result is put in NFC, every whitespace run becomes one space, and the ends are trimmed;
 * - a label with no visible character normalises to "".
 * A plain label is unchanged, so its folder is the same as before normalisation existed.
 * Idempotent for every label it accepts, and linear in the input.
 */
export function normaliseAccountLabel(label: string): string {
  if (
    label.length > MAX_RAW_ACCOUNT_LABEL_UNITS ||
    LONE_SURROGATE.test(label) ||
    REJECTED_LABEL_CHARS.test(label)
  )
    return "";
  let stripped = "";
  for (const char of label)
    if (
      !CONTROL_OR_FORMAT.test(char) ||
      WHITESPACE.test(char) ||
      code(char) === ZWJ ||
      code(char) === ZWNJ ||
      isTag(char)
    )
      stripped += char;
  const kept = dropStrayJoinersAndTags([...stripped.normalize("NFC")]).join("");
  const result = kept.normalize("NFC").replace(WHITESPACE_RUN, " ").trim();
  for (const char of result)
    if (VISIBLE_LABEL_CHAR.test(char) && !BLANK_LOOKING.has(code(char))) return result;
  return "";
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
