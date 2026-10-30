// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * A small, dependency-free CSV parser for Tier-C export files.
 *
 * Export CSVs (Netflix, Amazon, Uber, Goodreads, bank statements, …) are
 * RFC-4180-ish but messy: quoted fields with embedded commas, embedded
 * newlines and doubled `""` escapes, `\r\n` or bare `\n` line endings, a
 * trailing newline, and the occasional UTF-8 BOM. A purpose-built parser is
 * smaller and safer here than pulling a dependency: it never executes input,
 * only ever returns string cells (which become RDF literals downstream).
 *
 * The input is treated as fully untrusted. There is no formula/`=`-prefix
 * "CSV injection" risk because we never write these cells back into a
 * spreadsheet or a shell — they become inert RDF string literals.
 */

import { ChunkSlices } from "./chunk-slices.js";

/** A parsed CSV: the header row plus each data row keyed by column name. */
export interface ParsedCsv {
  /** Column names from the first row, trimmed (BOM stripped). */
  readonly headers: readonly string[];
  /** Data rows; each maps a header to its (possibly empty) cell value. */
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** Bound header work independently of file size and the number of data rows. */
export const MAX_CSV_HEADER_CHARS = 64 * 1024;
export const MAX_CSV_COLUMNS = 1024;

/**
 * Tokenise CSV text into a matrix of string cells. Handles quoting, embedded
 * commas/newlines, `""` escapes and CRLF/LF/CR line endings. A leading UTF-8
 * BOM is stripped. Blank trailing lines are dropped. With maxColumns, retain
 * only that many cells; scan excess fields without allocating their text and
 * discard the whole row through onSkip.
 */
export function parseCsvRows(
  text: string,
  delimiter = ",",
  maxColumns = Number.POSITIVE_INFINITY,
  onSkip: () => void = () => {},
): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  const field = new ChunkSlices();
  let inQuotes = false;
  let excessiveColumns = false;
  let start = 0;
  let i = 0;

  const endField = (end: number) => {
    if (row.length < maxColumns) {
      field.push(src.slice(start, end));
      row.push(field.text());
      field.clear();
    } else excessiveColumns = true;
  };
  const endRow = () => {
    if (excessiveColumns) onSkip();
    else rows.push(row);
    row = [];
    excessiveColumns = false;
  };

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (row.length < maxColumns) field.push(src.slice(start, i));
        if (src[i + 1] === '"') {
          if (row.length < maxColumns) field.push('"');
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
        start = i;
      } else i++;
      continue;
    }
    if (c === '"') {
      if (row.length < maxColumns) field.push(src.slice(start, i));
      inQuotes = true;
      start = ++i;
    } else if (c === delimiter) {
      endField(i);
      start = ++i;
    } else if (c === "\r" || c === "\n") {
      endField(i);
      endRow();
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      start = i;
    } else i++;
  }
  endField(src.length);
  endRow();

  // Drop a single empty trailing row produced by a final newline.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Parse CSV text into headers + keyed rows. The first non-empty line is the
 * header. Cells are trimmed of surrounding whitespace. Rows with fewer cells
 * than headers are padded with empty strings; extra cells are ignored.
 */
export function parseCsv(text: string, delimiter = ","): ParsedCsv {
  const matrix = parseCsvRows(text, delimiter);
  const [headerRow, ...dataRows] = matrix;
  if (!headerRow) return { headers: [], rows: [] };
  if (headerRow.length > MAX_CSV_COLUMNS || headerRow.join(",").length > MAX_CSV_HEADER_CHARS)
    throw new Error("CSV header exceeds the import limit (1024 columns / 64 KiB characters).");
  const headers = headerRow.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const cells of dataRows) {
    const obj: Record<string, string> = {};
    for (const [c, header] of headers.entries()) {
      obj[header] = (cells[c] ?? "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}
