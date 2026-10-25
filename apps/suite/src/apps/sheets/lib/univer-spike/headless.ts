// AUTHORED-BY Codex GPT-6.1-Sol
import { type IWorkbookData, Univer, UniverInstanceType, type Workbook } from "@univerjs/core";
import { UniverSheetsPlugin } from "@univerjs/sheets";

/** Load and save using the actual Node-compatible engine, releasing every instance. */
export function loadWorkbook(snapshot: Partial<IWorkbookData>): IWorkbookData {
  const univer = new Univer();
  try {
    univer.registerPlugin(UniverSheetsPlugin);
    const workbook = univer.createUnit<IWorkbookData, Workbook>(
      UniverInstanceType.UNIVER_SHEET,
      structuredClone(snapshot),
    );
    return structuredClone(workbook.save());
  } finally {
    univer.dispose();
  }
}
