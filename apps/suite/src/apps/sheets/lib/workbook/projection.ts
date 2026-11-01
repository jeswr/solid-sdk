// AUTHORED-BY Codex GPT-6.1-Sol
import type { IWorkbookData } from "@univerjs/core";
import { csvToGrid, inferDescriptor, type Snapshot, serializeSnapshot } from "../model";
import { csvToWorkbook, loadWorkbook, workbookToCsv } from "../univer-spike";

/** A new sheet's grid is at least this big, so a blank or small CSV import has room to grow. */
export const MIN_ROWS = 1000;
export const MIN_COLUMNS = 26;

export function freshSnapshot(title: string, snapshot?: Snapshot): Snapshot {
  const value = (snapshot ??
    loadWorkbook(
      csvToWorkbook("new", title, [{ id: "sheet1", name: "Sheet1", csv: "" }]),
    )) as unknown as IWorkbookData;
  const sheets: IWorkbookData["sheets"] = {};
  for (const [id, sheet] of Object.entries(value.sheets)) {
    sheets[id] = {
      ...sheet,
      rowCount: Math.max(sheet.rowCount ?? 0, MIN_ROWS),
      columnCount: Math.max(sheet.columnCount ?? 0, MIN_COLUMNS),
    };
  }
  const result: IWorkbookData = { ...value, sheets, id: crypto.randomUUID(), name: title };
  return result as unknown as Snapshot;
}

export function project(snapshot: Snapshot) {
  serializeSnapshot(snapshot);
  const workbook = snapshot as unknown as IWorkbookData;
  return workbook.sheetOrder.map((id, i) => {
    // workbookToCsv validates the referenced sheet. A blank sheet still needs a
    // CSV header for the model's descriptor (one unnamed, empty text column).
    const csv = workbookToCsv(workbook, id) || '""\r\n';
    const name = workbook.sheets[id]?.name ?? id;
    return { number: i + 1, name, csv, descriptor: inferDescriptor(name, csvToGrid(csv)) };
  });
}

export type ProjectedSheet = ReturnType<typeof project>[number];
