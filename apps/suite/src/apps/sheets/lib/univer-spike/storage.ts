// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { IWorkbookData } from "@univerjs/core";
import { type ColumnProjection, inferColumns, workbookToCsv } from "./workbook";

/** In-memory hand-off to SHT-00; its typed writers own RDF and I/O. */
export interface StorageProjection {
  workbookJson: string;
  sheets: {
    id: string;
    name: string;
    csvPath: string;
    descriptorPath: string;
    csv: string;
    columns: ColumnProjection[];
  }[];
}

export function workbookToStorage(snapshot: IWorkbookData): StorageProjection {
  return {
    workbookJson: JSON.stringify(snapshot),
    sheets: snapshot.sheetOrder.map((id, n) => {
      const csv = workbookToCsv(snapshot, id);
      return {
        id,
        // workbookToCsv already checked that this sheet exists.
        // biome-ignore lint/style/noNonNullAssertion: Validated above before projection.
        name: snapshot.sheets[id]!.name ?? id,
        csvPath: `sheets/${n}.csv`,
        descriptorPath: `sheets/${n}.jsonld`,
        csv,
        columns: inferColumns(csv),
      };
    }),
  };
}

/** Engine snapshot is authoritative; fail on divergent derived projections. */
export function storageToWorkbook(storage: StorageProjection): IWorkbookData {
  const snapshot: IWorkbookData = JSON.parse(storage.workbookJson);
  const expected = workbookToStorage(snapshot).sheets;
  if (
    expected.length !== storage.sheets.length ||
    expected.some((sheet, i) => {
      const stored = storage.sheets[i];
      return (
        !stored ||
        sheet.id !== stored.id ||
        sheet.name !== stored.name ||
        sheet.csvPath !== stored.csvPath ||
        sheet.descriptorPath !== stored.descriptorPath ||
        sheet.csv !== stored.csv ||
        sheet.columns.length !== stored.columns.length ||
        sheet.columns.some((column, j) => {
          const storedColumn = stored.columns[j];
          return (
            !storedColumn || column.name !== storedColumn.name || column.type !== storedColumn.type
          );
        })
      );
    })
  ) {
    throw new TypeError("Storage projections do not match workbook.json");
  }
  return snapshot;
}
