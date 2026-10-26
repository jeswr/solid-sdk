// AUTHORED-BY Codex GPT-6.1-Sol
import { assertImportSize } from "./errors";
import type { Column, CsvOptions, Delimiter, ImportedTransaction } from "./types";
import { parseAmount, parseDate, sniffDateFormat } from "./values";

/** RFC 4180 quoting with CRLF/LF/CR, escaped quotes, BOM and blank-line support. */
export function parseCsv(text: string, delimiter: Delimiter = ","): string[][] {
  assertImportSize(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const source = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(field);
    if (row.length > 1 || row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
    field = "";
    closed = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV field");
  finishRow();
  return rows;
}

/** Choose the consistent multi-column delimiter; require a choice on ties. */
export function sniffDelimiter(text: string): Delimiter {
  assertImportSize(text);
  const candidates: Delimiter[] = [",", ";", "\t", "|"];
  const matches = candidates.filter((delimiter) => {
    try {
      const rows = parseCsv(text, delimiter);
      const width = rows[0]?.length ?? 0;
      return width > 1 && rows.every((row) => row.length === width);
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error("Choose a CSV delimiter");
  return matches[0] as Delimiter;
}

/** Fail atomically on malformed rows, mappings or ambiguous dates. No rows are silently skipped. */
export function importCsv(text: string, options: CsvOptions): ImportedTransaction[] {
  const rows = parseCsv(text, options.delimiter ?? sniffDelimiter(text));
  if (rows.length === 0) return [];
  const header = rows[0] as string[];
  const hasHeader = options.hasHeader ?? true;
  const data = hasHeader ? rows.slice(1) : rows;
  const resolve = (column: Column): number => {
    const index = typeof column === "number" ? column : header.indexOf(column);
    if (
      (typeof column === "string" && (!hasHeader || header.lastIndexOf(column) !== index)) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= header.length
    )
      throw new Error("Invalid or ambiguous CSV column mapping");
    return index;
  };
  const columns = options.columns;
  if (
    columns.amount !== undefined
      ? columns.debit !== undefined || columns.credit !== undefined
      : columns.debit === undefined && columns.credit === undefined
  ) {
    throw new Error("Map an amount column or debit/credit columns");
  }
  const dateIndex = resolve(columns.date);
  const descriptionIndex = resolve(columns.description);
  const amountIndex = columns.amount === undefined ? undefined : resolve(columns.amount);
  const debitIndex = columns.debit === undefined ? undefined : resolve(columns.debit);
  const creditIndex = columns.credit === undefined ? undefined : resolve(columns.credit);
  const currencyIndex = columns.currency === undefined ? undefined : resolve(columns.currency);
  if (data.some((row) => row.length !== header.length))
    throw new Error("Inconsistent CSV row width");
  if (data.length === 0) return [];
  const format = options.dateFormat ?? sniffDateFormat(data.map((row) => row[dateIndex] as string));
  if (!format) throw new Error("Choose a CSV date format");
  return data.map((row) => {
    const cell = (index: number) => (row[index] as string).trim();
    let amount: string;
    if (amountIndex !== undefined)
      amount = parseAmount(cell(amountIndex), options.decimalSeparator);
    else {
      const debit = debitIndex === undefined ? "" : cell(debitIndex);
      const credit = creditIndex === undefined ? "" : cell(creditIndex);
      if ((!debit && !credit) || (debit && credit))
        throw new Error("Expected one debit or credit value");
      amount = parseAmount(debit || credit, options.decimalSeparator);
      if (amount.startsWith("-")) throw new Error("Debit/credit values must be unsigned");
      if (debit && amount !== "0") amount = `-${amount}`;
    }
    const description = cell(descriptionIndex);
    if (!description) throw new Error("Missing transaction description");
    const currency = currencyIndex === undefined ? options.currency : cell(currencyIndex);
    return {
      date: parseDate(cell(dateIndex), format),
      amount,
      description,
      ...(currency ? { currency } : {}),
    };
  });
}
