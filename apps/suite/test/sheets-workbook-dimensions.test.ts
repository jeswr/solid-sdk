// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { freshSnapshot, MIN_COLUMNS, MIN_ROWS } from "../src/apps/sheets/lib/workbook/projection";

type Sheets = Record<string, { rowCount?: number; columnCount?: number }>;

describe("new workbook grid size", () => {
  it("gives a blank workbook a full-size first sheet", () => {
    const sheets = freshSnapshot("Blank").sheets as Sheets;
    expect(Object.values(sheets)).toEqual([
      expect.objectContaining({ rowCount: MIN_ROWS, columnCount: MIN_COLUMNS }),
    ]);
  });

  it("grows small or unsized sheets and keeps larger ones", () => {
    const snapshot = freshSnapshot("Mixed", {
      id: "old",
      name: "Old",
      sheetOrder: ["a", "b"],
      sheets: {
        a: { id: "a", name: "A", cellData: {} },
        b: { id: "b", name: "B", rowCount: 5000, columnCount: 3, cellData: {} },
      },
    });
    const sheets = snapshot.sheets as Sheets;
    expect(sheets.a).toMatchObject({ rowCount: MIN_ROWS, columnCount: MIN_COLUMNS });
    expect(sheets.b).toMatchObject({ rowCount: 5000, columnCount: MIN_COLUMNS });
    expect(snapshot.name).toBe("Mixed");
    expect(snapshot.id).not.toBe("old");
  });
});
