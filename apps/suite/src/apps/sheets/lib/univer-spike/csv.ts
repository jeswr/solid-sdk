// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { LIMITS } from "../xlsx/common";

/** Grid bounds for CSV import, shared with Excel import so neither path accepts more. */
export interface CsvImportLimits {
  readonly rows: number;
  readonly columns: number;
  readonly cells: number;
  /** UTF-16 code units of cell text, summed over every cell. */
  readonly text: number;
}

export const CSV_IMPORT_LIMITS: CsvImportLimits = Object.freeze({
  rows: LIMITS.rows,
  columns: LIMITS.columns,
  cells: LIMITS.cells,
  text: LIMITS.text,
});

/** The file is not RFC 4180 CSV; the message is fixed text, safe to show. */
export class CsvSyntaxError extends SyntaxError {
  constructor(message: string) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

/** The file is valid but larger than Sheets imports; the message is user-facing. */
export class CsvLimitError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "CsvLimitError";
  }
}

const count = (value: number) => value.toLocaleString("en-US");

/**
 * RFC 4180 text fields. Import never evaluates formulas or coerces identifiers.
 * Rows, columns, cells and text are counted while parsing, so an oversized file
 * stops at the limit instead of building the whole grid first.
 */
export function parseCsv(csv: string, limits: CsvImportLimits = CSV_IMPORT_LIMITS): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  if (text === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let cells = 0;
  let codeUnits = 0;
  const endField = () => {
    if (row.length >= limits.columns)
      throw new CsvLimitError(
        `Sheets can open CSV files with up to ${count(limits.columns)} columns`,
      );
    if (++cells > limits.cells)
      throw new CsvLimitError(`Sheets can open CSV files with up to ${count(limits.cells)} cells`);
    codeUnits += field.length;
    if (codeUnits > limits.text)
      throw new CsvLimitError("This CSV file has too much text for Sheets");
    row.push(field);
    field = "";
  };
  const endRow = () => {
    if (rows.length >= limits.rows)
      throw new CsvLimitError(`Sheets can open CSV files with up to ${count(limits.rows)} rows`);
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "," || char === "\r" || char === "\n") {
      endField();
      closed = false;
      if (char !== ",") {
        endRow();
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && field === "" && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new CsvSyntaxError("Unexpected character in CSV field");
      field += char;
    }
  }
  if (quoted) throw new CsvSyntaxError("Unterminated CSV field");
  if (row.length > 0 || !/[\r\n]$/.test(text) || closed) {
    endField();
    endRow();
  }
  return rows;
}

/** A user-facing reason for a CSV that Sheets can't import, or undefined for any other error. */
export function csvImportFailure(error: unknown): string | undefined {
  if (error instanceof CsvLimitError) return error.message;
  if (error instanceof CsvSyntaxError) return "This file isn't valid CSV, so Sheets can't open it";
  return undefined;
}

export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row, r) =>
      row
        .map((value, c) =>
          /[",\r\n]/.test(value) || (r === 0 && c === 0 && value.startsWith("\uFEFF"))
            ? `"${value.replaceAll('"', '""')}"`
            : value,
        )
        .join(","),
    )
    .map((line) => `${line}\r\n`)
    .join("");
}
