// AUTHORED-BY Codex GPT-6.1-Sol
import type { Snapshot } from "../model/snapshot";
import { formatA1, parseA1 } from "../refs/notation";

/** Bounded, rectangular chart sources. Sheet identity is stored separately from its name. */
export function parseChartRange(text: string) {
  const ref = parseA1(text.trim());
  if (!ref.rows || !ref.columns) throw new Error("Use a cell range such as A1:C10");
  const startRow = ref.rows.start.index - 1;
  const endRow = ref.rows.end.index - 1;
  const startColumn = ref.columns.start.index - 1;
  const endColumn = ref.columns.end.index - 1;
  if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > 10_000)
    throw new Error("Chart ranges can contain at most 10,000 cells");
  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    sheet: ref.sheet,
    a1: formatA1({ rows: ref.rows, columns: ref.columns }),
  };
}

export function chartSource(snapshot: Snapshot, sheetId: string, text: string) {
  const range = parseChartRange(text);
  const sheets = snapshot.sheets as Record<string, Snapshot> | undefined;
  const sheet = sheets && Object.hasOwn(sheets, sheetId) ? sheets[sheetId] : undefined;
  if (!sheet) throw new Error("Choose an existing sheet");
  if (range.sheet !== undefined && range.sheet !== sheet.name)
    throw new Error("The range must refer to this chart's sheet");
  if (range.endRow >= Number(sheet.rowCount) || range.endColumn >= Number(sheet.columnCount))
    throw new Error("The range extends beyond this sheet");
  return { range, sheet };
}

/** Read cached formula results (v); blanks and unsupported cell values remain empty. */
export function chartValues(snapshot: Snapshot, sheetId: string, text: string): unknown[][] {
  const { range, sheet } = chartSource(snapshot, sheetId, text);
  const cells = sheet.cellData as Record<string, Record<string, { v?: unknown }>> | undefined;
  return Array.from({ length: range.endRow - range.startRow + 1 }, (_, row) =>
    Array.from(
      { length: range.endColumn - range.startColumn + 1 },
      (_, column) => cells?.[range.startRow + row]?.[range.startColumn + column]?.v ?? null,
    ),
  );
}
