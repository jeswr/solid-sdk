// AUTHORED-BY Codex GPT-6.1-Sol
import type { Snapshot } from "../model/snapshot";
import { shiftReference } from "../refs/edits";
import type { StructuralEdit } from "../refs/model";
import { formatA1, parseA1 } from "../refs/notation";
import type { ChartSpec } from "./spec";

/** Rectangular chart references, independent of the rendering budget. */
export function parseChartRange(text: string) {
  const ref = parseA1(text.trim());
  if (!ref.rows || !ref.columns) throw new Error("Use a cell range such as A1:C10");
  const startRow = ref.rows.start.index - 1;
  const endRow = ref.rows.end.index - 1;
  const startColumn = ref.columns.start.index - 1;
  const endColumn = ref.columns.end.index - 1;
  return {
    startRow,
    endRow,
    startColumn,
    endColumn,
    sheet: ref.sheet,
    a1: formatA1({ rows: ref.rows, columns: ref.columns }),
  };
}

export function chartSheet(snapshot: Snapshot, sheetId: string) {
  const sheets = snapshot.sheets as Record<string, Snapshot> | undefined;
  const sheet = sheets && Object.hasOwn(sheets, sheetId) ? sheets[sheetId] : undefined;
  if (!sheet) throw new Error("Choose an existing sheet");
  return sheet;
}

export function chartSource(snapshot: Snapshot, sheetId: string, text: string | null) {
  const sheet = chartSheet(snapshot, sheetId);
  if (text === null) throw new Error("Data range deleted. Edit or delete this chart.");
  const range = parseChartRange(text);
  if (range.sheet !== undefined && range.sheet !== sheet.name)
    throw new Error("The range must refer to this chart's sheet");
  if (range.endRow >= Number(sheet.rowCount) || range.endColumn >= Number(sheet.columnCount))
    throw new Error("The range extends beyond this sheet");
  return { range, sheet };
}

/** Read cached formula results (v); blanks and unsupported cell values remain empty. */
export function chartValues(snapshot: Snapshot, sheetId: string, text: string | null): unknown[][] {
  const { range, sheet } = chartSource(snapshot, sheetId, text);
  if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > 10_000)
    throw new Error("Range too large to chart. Select at most 10,000 cells.");
  const cells = sheet.cellData as Record<string, Record<string, { v?: unknown }>> | undefined;
  return Array.from({ length: range.endRow - range.startRow + 1 }, (_, row) =>
    Array.from(
      { length: range.endColumn - range.startColumn + 1 },
      (_, column) => cells?.[range.startRow + row]?.[range.startColumn + column]?.v ?? null,
    ),
  );
}

/** Follow structural edits by sheet ID; null retains a fully deleted source for undo. */
export function shiftChartRanges(
  charts: ChartSpec[],
  sheetId: string,
  edit: Omit<StructuralEdit, "sheet">,
): ChartSpec[] {
  return charts.map((chart) => {
    if (chart.sheetId !== sheetId || chart.range === null) return chart;
    const { rows, columns } = parseA1(chart.range);
    // Identity was resolved above. Reference helpers use a local context, never an ID as a name.
    const shifted = shiftReference({ rows, columns }, { ...edit, sheet: "source" }, "source");
    return { ...chart, range: shifted === null ? null : formatA1(shifted) };
  });
}
