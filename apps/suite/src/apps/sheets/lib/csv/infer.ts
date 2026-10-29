// AUTHORED-BY Codex GPT-6.1-Sol
import { type CsvColumnType, validateTable } from "./model";

function cellType(value: string): CsvColumnType {
  if (value !== value.trim()) return "text";
  if (value === "true" || value === "false") return "boolean";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)) {
    const number = Number(value);
    // Preserve large identifiers and overflow/underflow as text metadata.
    if (
      Number.isFinite(number) &&
      Math.abs(number) <= Number.MAX_SAFE_INTEGER &&
      (number !== 0 || !/[1-9]/u.test(value.split(/[eE]/u)[0] as string))
    ) {
      return "number";
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year > 0 && day > 0 && day <= (days[month - 1] ?? 0)) return "date";
  }
  return "text";
}

/** No header guessing: pass only data rows. Empty cells do not vote; empty columns are text. */
export function inferColumnTypes(rows: readonly (readonly string[])[]): CsvColumnType[] {
  validateTable(rows);
  const types: (CsvColumnType | undefined)[] = Array.from({ length: rows[0]?.length ?? 0 });
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const value = row[c] as string;
      if (value === "") continue;
      const next = cellType(value);
      const current = types[c];
      types[c] = current === undefined || current === next ? next : "text";
    }
  }
  return types.map((type) => type ?? "text");
}
