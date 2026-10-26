// AUTHORED-BY Codex GPT-6.1-Sol
import { CSV_LIMITS, type CsvDelimiter, CsvError, validateDelimiter, validateText } from "./model";

export interface CsvParseOptions {
  /** Omit to sniff; specify when more than one delimiter is plausible. */
  readonly delimiter?: CsvDelimiter;
}

/** Strict quoted-field parser. Keep blank records, spaces and embedded line endings. */
function parse(text: string, delimiter: CsvDelimiter): string[][] {
  if (text === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStart = 0;
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let cells = 0;
  let width: number | undefined;
  const endField = (end: number) => {
    if (++cells > CSV_LIMITS.maxCells || row.length >= CSV_LIMITS.maxColumns) {
      throw new CsvError("limit", "Too many cells or columns");
    }
    row.push(state === "plain" ? text.slice(fieldStart, end) : field);
    field = "";
    state = "start";
  };
  const endRow = (end: number) => {
    endField(end);
    width ??= row.length;
    if (row.length !== width) throw new CsvError("shape", "Inconsistent row widths");
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += text.slice(fieldStart, i + 1);
          i++;
          fieldStart = i + 1;
        } else {
          field += text.slice(fieldStart, i);
          state = "closed";
        }
      }
    } else if (char === delimiter) {
      endField(i);
    } else if (char === "\r" || char === "\n") {
      if (char === "\r") {
        if (text[i + 1] !== "\n") throw new CsvError("syntax", "Bare CR record separator");
      }
      endRow(i);
      if (char === "\r") i++;
    } else if (char === '"' && state === "start") {
      state = "quoted";
      fieldStart = i + 1;
    } else {
      if (char === '"' || state === "closed") {
        throw new CsvError("syntax", "Unexpected character in CSV field");
      }
      if (state === "start") fieldStart = i;
      state = "plain";
    }
  }
  if (state === "quoted") throw new CsvError("syntax", "Unterminated quoted field");
  if (state !== "start" || row.length > 0) endRow(text.length);
  return rows;
}

function prepare(input: string): string {
  validateText(input);
  return input.startsWith("\uFEFF") ? input.slice(1) : input;
}

function sniff(text: string): CsvDelimiter {
  const candidates: CsvDelimiter[] = [];
  let failure: CsvError | undefined;
  for (const delimiter of [",", ";", "\t"] as const) {
    try {
      const rows = parse(text, delimiter);
      if (rows[0] && rows[0].length > 1) candidates.push(delimiter);
    } catch (error) {
      // parse only throws CsvError; limits/shape must never become a one-column fallback.
      failure = error as CsvError;
    }
  }
  if (candidates.length > 1) throw new CsvError("delimiter", "Ambiguous CSV delimiter");
  const candidate = candidates[0];
  if (candidate) return candidate;
  // A valid one-column file has identical syntax for all three delimiters.
  if (failure) throw failure;
  return ",";
}

/** Inspect the entire bounded input, respecting quotes and rejecting ambiguity. */
export function sniffDelimiter(input: string): CsvDelimiter {
  return sniff(prepare(input));
}

/** Returns raw strings. There is no header detection, trimming, formula evaluation or coercion. */
export function parseCsv(input: string, options: CsvParseOptions = {}): string[][] {
  const text = prepare(input);
  const delimiter = options.delimiter ?? sniff(text);
  validateDelimiter(delimiter);
  return parse(text, delimiter);
}
