// AUTHORED-BY Codex (GPT-6.1 Sol)
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

export const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

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
export function lexicalType(value: string): ColumnType {
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

export function inferDescriptor(name: string, grid: Grid) {
  return { name, columns: inferColumns(grid) };
}
