// AUTHORED-BY Codex GPT-6.1-Sol
/** Engine-independent tabular values. Empty CSV fields represent null (also empty text). */
export type Cell = string | number | Date | null;
export interface Grid {
  columns: string[];
  rows: Cell[][];
}
export type ColumnType = "text" | "number" | "date";
export interface Column {
  name: string;
  type: ColumnType;
  format: "text" | "number" | "date-time";
}

export function validateGrid(grid: Grid): void {
  if (grid.columns.length === 0 || grid.columns.some((name) => typeof name !== "string")) {
    throw new TypeError("A grid needs at least one named column");
  }
  for (const row of grid.rows) {
    if (row.length !== grid.columns.length) throw new TypeError("Non-rectangular grid");
    for (const cell of row) {
      if (
        cell !== null &&
        typeof cell !== "string" &&
        !(typeof cell === "number" && Number.isFinite(cell)) &&
        !(
          cell instanceof Date &&
          Number.isFinite(cell.getTime()) &&
          cell.getUTCFullYear() >= 0 &&
          cell.getUTCFullYear() <= 9999
        )
      ) {
        throw new TypeError("Invalid grid cell");
      }
    }
  }
}

const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Compare decimal values without first rounding their coefficients or exponents. */
function normalizedDecimal(value: string): string {
  const [mantissa, exponent = "0"] = value.toLowerCase().split("e") as [string, string?];
  const [integer, fraction = ""] = mantissa.replace(/^-/, "").split(".") as [string, string?];
  const digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (digits === "") return "0";
  const coefficient = digits.replace(/0+$/, "");
  const power =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - coefficient.length);
  return `${value.startsWith("-") ? "-" : ""}${coefficient}e${power}`;
}

export function validateColumns(columns: Column[]): void {
  if (
    columns.length === 0 ||
    columns.some(
      (column) =>
        typeof column.name !== "string" ||
        !["text", "number", "date"].includes(column.type) ||
        column.format !== (column.type === "date" ? "date-time" : column.type),
    )
  )
    throw new TypeError("Invalid descriptor columns");
}

/** Infer only lossless numeric lexemes and ISO dates, never locale-dependent dates or IDs. */
function lexicalType(value: string): ColumnType {
  if (NUMERIC.test(value)) {
    const number = Number(value);
    if (
      Number.isFinite(number) &&
      (!Number.isInteger(number) || Number.isSafeInteger(number)) &&
      normalizedDecimal(value) === normalizedDecimal(String(number))
    ) {
      return "number";
    }
  }
  if (
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value.slice(0, 10)
  ) {
    return "date";
  }
  return "text";
}

export function inferColumns(grid: Grid): Column[] {
  validateGrid(grid);
  return grid.columns.map((name, index) => {
    const types = new Set<ColumnType>();
    for (const row of grid.rows) {
      const cell = row[index];
      if (cell === null || cell === "") continue;
      types.add(
        cell instanceof Date
          ? "date"
          : typeof cell === "number"
            ? "number"
            : lexicalType(cell as string),
      );
    }
    const type = types.size === 1 ? (Array.from(types)[0] as ColumnType) : "text";
    return { name, type, format: type === "date" ? "date-time" : type };
  });
}

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
