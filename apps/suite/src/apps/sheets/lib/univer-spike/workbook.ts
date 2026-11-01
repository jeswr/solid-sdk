// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  CellValueType,
  getPlainText,
  type ICellData,
  type IWorkbookData,
  LocaleType,
} from "@univerjs/core";
import { getCellValue } from "@univerjs/sheets";
import { parseCsv, serializeCsv } from "./csv";

export interface CsvSheet {
  id: string;
  name: string;
  csv: string;
}

/** Plain inputs for SHT-00's descriptor writer; these are not RDF statements. */
export interface ColumnProjection {
  name: string;
  type: "string" | "number" | "date" | "boolean";
}

/** Preserve lexical text, including leading zeroes, dates and formula-looking text. */
export function csvToWorkbook(
  id: string,
  name: string,
  sheets: readonly CsvSheet[],
): IWorkbookData {
  if (sheets.length === 0) throw new TypeError("A workbook needs at least one sheet");
  const data: IWorkbookData = {
    id,
    name,
    appVersion: "1.2.0",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: [],
    sheets: {},
  };
  for (const sheet of sheets) {
    if (!sheet.id || sheet.id === "__proto__" || Object.hasOwn(data.sheets, sheet.id)) {
      throw new TypeError("Sheet IDs must be nonempty, unique and not __proto__");
    }
    const grid = parseCsv(sheet.csv);
    const cellData: Record<number, Record<number, ICellData>> = {};
    grid.forEach((row, r) => {
      const cells: Record<number, ICellData> = {};
      row.forEach((v, c) => {
        cells[c] = { v, t: CellValueType.STRING };
      });
      cellData[r] = cells;
    });
    data.sheetOrder.push(sheet.id);
    // Store supported IDs as own data properties.
    Object.defineProperty(data.sheets, sheet.id, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: {
        id: sheet.id,
        name: sheet.name,
        rowCount: Math.max(1, grid.length),
        columnCount: Math.max(1, ...grid.map((row) => row.length)),
        cellData,
      },
    });
  }
  return data;
}

/** CSV is a value projection: cached formulas, plain rich text, no style metadata. */
export function workbookToCsv(snapshot: IWorkbookData, sheetId: string): string {
  if (!Object.hasOwn(snapshot.sheets, sheetId)) throw new RangeError("Unknown sheet ID");
  const sheet = snapshot.sheets[sheetId];
  if (!sheet) throw new TypeError("Missing sheet data");
  const cells = sheet.cellData ?? {};
  let height = 0;
  let width = 0;
  for (const [r, row] of Object.entries(cells)) {
    for (const c of Object.keys(row)) {
      const ri = Number(r);
      const ci = Number(c);
      if (!Number.isSafeInteger(ri) || !Number.isSafeInteger(ci) || ri < 0 || ci < 0) {
        throw new RangeError("Cell coordinates must be nonnegative integers");
      }
      height = Math.max(height, ri + 1);
      width = Math.max(width, ci + 1);
    }
  }
  return serializeCsv(
    Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => {
        const cell = cells[r]?.[c];
        const richText = cell?.p?.body?.dataStream;
        if (richText) return getPlainText(richText);
        if (cell?.v != null) {
          if (cell.t === CellValueType.BOOLEAN) {
            return getCellValue(CellValueType.BOOLEAN, cell) ? "true" : "false";
          }
          return String(cell.v);
        }
        return "";
      }),
    ),
  );
}

/** First row supplies names; blanks are ignored and mixed/empty columns stay text. */
export function inferColumns(csv: string): ColumnProjection[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  return header.map((name, c) => {
    const values = rows.map((row) => row[c] ?? "").filter((v) => v !== "");
    let type: ColumnProjection["type"] = "string";
    if (values.length > 0) {
      if (values.every((v) => /^(true|false)$/.test(v))) type = "boolean";
      else if (
        values.every(
          (v) => /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(v) && Number.isFinite(Number(v)),
        )
      )
        type = "number";
      else if (
        values.every(
          (v) =>
            /^\d{4}-\d{2}-\d{2}$/.test(v) &&
            Number.isFinite(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v,
        )
      )
        type = "date";
    }
    return { name, type };
  });
}
