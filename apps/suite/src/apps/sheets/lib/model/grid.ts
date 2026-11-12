// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type Cell,
  type Column,
  type Grid,
  inferColumns,
  lexicalType,
  NUMERIC,
  validateColumns,
  validateGrid,
} from "@jeswr/solid-sheets";

export {
  type Cell,
  type Column,
  type ColumnType,
  type Grid,
  inferColumns,
  validateColumns,
  validateGrid,
} from "@jeswr/solid-sheets";

/** Strict RFC 4180 field quoting; accepts CRLF, LF or CR record separators. */
export function parseCsv(csv: string): string[][] {
  const input = csv.replace(/^\uFEFF/, "");
  if (input === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === "," || char === "\r" || char === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && input[i + 1] === "\n") i++;
      }
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new TypeError("Invalid CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new TypeError("Unterminated CSV field");
  if (field !== "" || closed || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A descriptor disambiguates intentional text such as account numbers and date-like labels. */
export function csvToGrid(csv: string, columns?: Column[]): Grid {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new TypeError("CSV has no header");
  const raw: Grid = { columns: header, rows };
  validateGrid(raw);
  const inferred = columns ?? inferColumns(raw);
  validateColumns(inferred);
  if (
    inferred.length !== header.length ||
    inferred.some((column, i) => column.name !== header[i])
  ) {
    throw new TypeError("CSV and descriptor columns differ");
  }
  return {
    columns: header,
    rows: rows.map((row) =>
      row.map((value, i) => {
        if (value === "") return null;
        const type = (inferred[i] as Column).type;
        if (type === "text") return value;
        const matches =
          type === "number"
            ? NUMERIC.test(value) && Number.isFinite(Number(value))
            : lexicalType(value) === "date";
        if (!matches) throw new TypeError("Cell does not match descriptor type");
        return type === "number" ? Number(value) : new Date(value);
      }),
    ),
  };
}

export function gridToCsv(grid: Grid): string {
  validateGrid(grid);
  const quote = (value: Cell): string => {
    const text = value instanceof Date ? value.toISOString() : value === null ? "" : String(value);
    return /[",\r\n]/.test(text) || text === "" ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${[grid.columns, ...grid.rows].map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}
