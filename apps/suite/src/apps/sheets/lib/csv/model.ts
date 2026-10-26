// AUTHORED-BY Codex GPT-6.1-Sol
export type CsvDelimiter = "," | ";" | "\t";
export type CsvColumnType = "number" | "boolean" | "date" | "text";
export type CsvErrorCode = "syntax" | "delimiter" | "shape" | "limit" | "invalid-input";

export class CsvError extends Error {
  constructor(
    readonly code: CsvErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export const CSV_LIMITS = Object.freeze({
  maxCodeUnits: 10_000_000,
  maxCells: 100_000,
  maxRows: 100_000,
  maxColumns: 16_384,
});

export function validateDelimiter(delimiter: CsvDelimiter): void {
  if (delimiter !== "," && delimiter !== ";" && delimiter !== "\t") {
    throw new CsvError("delimiter", "Expected comma, semicolon or tab");
  }
}

export function validateText(text: string): void {
  if (typeof text !== "string") throw new CsvError("invalid-input", "Expected text");
  if (text.length > CSV_LIMITS.maxCodeUnits) {
    throw new CsvError("limit", "CSV text exceeds the code-unit limit");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsupported input controls deliberately
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new CsvError("syntax", "Unsupported control character");
  }
}

export function validateTable(rows: readonly (readonly string[])[]): void {
  if (!Array.isArray(rows)) throw new CsvError("invalid-input", "Expected rows");
  let cells = 0;
  let codeUnits = 0;
  let width: number | undefined;
  if (rows.length > CSV_LIMITS.maxRows) throw new CsvError("limit", "Too many rows");
  for (const row of rows) {
    if (!Array.isArray(row)) throw new CsvError("invalid-input", "Expected a row array");
    if (row.length === 0) throw new CsvError("shape", "Rows must contain at least one cell");
    if (row.length > CSV_LIMITS.maxColumns) throw new CsvError("limit", "Too many columns");
    width ??= row.length;
    if (row.length !== width) throw new CsvError("shape", "Inconsistent row widths");
    cells += row.length;
    if (cells > CSV_LIMITS.maxCells) throw new CsvError("limit", "Too many cells");
    for (const value of row) {
      validateText(value);
      codeUnits += value.length;
      if (codeUnits > CSV_LIMITS.maxCodeUnits) throw new CsvError("limit", "Too much cell text");
    }
  }
}
