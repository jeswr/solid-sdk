// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Synthetic fixtures define these sheets and cells explicitly.
import { CellValueType, type IWorkbookData } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import {
  csvToWorkbook,
  inferColumns,
  loadWorkbook,
  parseCsv,
  serializeCsv,
  storageToWorkbook,
  workbookToCsv,
  workbookToStorage,
} from "../src/apps/sheets/lib/univer-spike";

const fixture = () =>
  csvToWorkbook("synthetic", "Fictional research", [
    {
      id: "people",
      name: "People",
      csv: 'Name,Count,Date,Account\r\nAvery Example,12,2026-10-25,https://example.org/avery#me\r\n"Rowan, Example",0,2024-02-29,https://example.org/rowan#me\r\n',
    },
    { id: "notes", name: "Notes", csv: 'Notes\n"Two\nlines"\n' },
  ]);

const firstSheet = (snapshot: IWorkbookData) => snapshot.sheets.people!;

describe("CSV fields", () => {
  it.each([
    ["", []],
    ["\uFEFF", []],
    [
      "\uFEFFa,b\r\nc,d\r\n",
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ],
    [
      "a,b\nc,d",
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ],
    ["a\rb\r", [["a"], ["b"]]],
    [
      '"a,b","c""d"\r\n"e\r\nf",z',
      [
        ["a,b", 'c"d'],
        ["e\r\nf", "z"],
      ],
    ],
    [",,\n\n", [["", "", ""], [""]]],
    ["a,", [["a", ""]]],
    ['""', [[""]]],
    ['"\n"', [["\n"]]],
  ])("parses %j", (input, expected) => expect(parseCsv(input as string)).toEqual(expected));

  it.each(['"open', 'ab"cd', '"closed"x', '"closed""'])("rejects malformed fields %j", (csv) =>
    expect(() => parseCsv(csv)).toThrow(SyntaxError));

  it("writes escaped fields and canonical CRLF without altering Unicode", () => {
    const grid = [
      ["Name", "Note"],
      ["Zoë Example", 'comma, quote"\r\nline'],
      ["", "=SUM(A1:A2)"],
    ];
    const csv = serializeCsv(grid);
    expect(csv).toBe('Name,Note\r\nZoë Example,"comma, quote""\r\nline"\r\n,=SUM(A1:A2)\r\n');
    expect(parseCsv(csv)).toEqual(grid);
    expect(serializeCsv([])).toBe("");
    expect(parseCsv(serializeCsv([[""]]))).toEqual([[""]]);
  });
});

describe("workbook conversions", () => {
  it("round-trips multiple sheets in declared order and preserves lexical text", () => {
    const snapshot = fixture();
    expect(snapshot.sheetOrder).toEqual(["people", "notes"]);
    for (const id of snapshot.sheetOrder) {
      const csv = workbookToCsv(snapshot, id);
      const imported = csvToWorkbook("copy", "Copy", [{ id, name: id, csv }]);
      expect(workbookToCsv(imported, id)).toBe(csv);
    }
    const literal = csvToWorkbook("literal", "Literal", [
      { id: "s", name: "s", csv: '001,=1+2,+3,-4,@test,2026-10-25,""' },
    ]);
    expect(workbookToCsv(literal, "s")).toBe("001,=1+2,+3,-4,@test,2026-10-25,\r\n");
    expect(literal.sheets.s!.cellData![0]![1]).toEqual({ v: "=1+2", t: CellValueType.STRING });
  });

  it("pads ragged input and supports empty sheets without exporting unused grid capacity", () => {
    const snapshot = csvToWorkbook("empty", "Empty", [
      { id: "empty", name: "Empty", csv: "" },
      { id: "ragged", name: "Ragged", csv: "a,b\nc\n" },
    ]);
    expect(snapshot.sheets.empty!.rowCount).toBe(1);
    expect(snapshot.sheets.empty!.columnCount).toBe(1);
    expect(workbookToCsv(snapshot, "empty")).toBe("");
    expect(workbookToCsv(snapshot, "ragged")).toBe("a,b\r\nc,\r\n");
    delete snapshot.sheets.empty!.cellData;
    expect(workbookToCsv(snapshot, "empty")).toBe("");
  });

  it("rejects absent/duplicate IDs and handles prototype-like IDs safely", () => {
    expect(() => csvToWorkbook("x", "x", [])).toThrow("at least one");
    expect(() => csvToWorkbook("x", "x", [{ id: "", name: "", csv: "" }])).toThrow("unique");
    const s = { id: "same", name: "s", csv: "" };
    expect(() => csvToWorkbook("x", "x", [s, s])).toThrow("unique");
    const snapshot = csvToWorkbook("x", "x", [{ id: "__proto__", name: "Proto", csv: "a" }]);
    expect(workbookToCsv(snapshot, "__proto__")).toBe("a\r\n");
    expect(() => workbookToCsv(snapshot, "toString")).toThrow("Unknown sheet");
    Object.defineProperty(snapshot.sheets, "missing", { value: undefined });
    expect(() => workbookToCsv(snapshot, "missing")).toThrow("Missing sheet");
  });

  it("projects sparse values, cached formulas, rich text, false, zero and blanks", () => {
    const snapshot = fixture();
    firstSheet(snapshot).cellData = {
      0: { 0: { v: "Values" } },
      2: {
        0: { v: 0 },
        1: { v: false },
        2: { f: "=SUM(A1:A2)", v: 42 },
        3: { f: "=1+1" },
        4: { p: { id: "rich", documentStyle: {}, body: { dataStream: "Hello\r\n" } } },
        5: { v: null },
        6: {},
      },
    };
    expect(workbookToCsv(snapshot, "people")).toBe(
      "Values,,,,,,\r\n,,,,,,\r\n0,false,42,,Hello,,\r\n",
    );
  });

  it.each([
    [-1, 0],
    [0, -1],
    [0.5, 0],
    [0, 0.5],
    [Number.NaN, 0],
  ])("rejects invalid coordinates (%s, %s)", (row, column) => {
    const snapshot = fixture();
    firstSheet(snapshot).cellData = { [row]: { [column]: { v: "bad" } } };
    expect(() => workbookToCsv(snapshot, "people")).toThrow("coordinates");
  });
});

describe("descriptor inputs", () => {
  it("infers number, ISO date, boolean and mixed/text/empty columns without coercion", () => {
    expect(
      inferColumns(
        "Name,Count,Date,Active,Mixed,ID,Empty\nAvery,12,2024-02-29,true,1,001,\nRowan,-1.5e2,2026-10-25,false,word,002,\n",
      ),
    ).toEqual([
      { name: "Name", type: "string" },
      { name: "Count", type: "number" },
      { name: "Date", type: "date" },
      { name: "Active", type: "boolean" },
      { name: "Mixed", type: "string" },
      { name: "ID", type: "string" },
      { name: "Empty", type: "string" },
    ]);
    expect(inferColumns("")).toEqual([]);
    expect(inferColumns("Only a header")).toEqual([{ name: "Only a header", type: "string" }]);
    expect(inferColumns("Empty,Number\n,0\n,\n")[1]!.type).toBe("number");
    expect(inferColumns("A,B\nvalue\n")[1]!.type).toBe("string");
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "not a date",
    "1e999",
    "Infinity",
    "+01",
  ])("keeps invalid dates and non-finite/ambiguous numbers as text: %s", (value) => {
    expect(inferColumns(`Column\n${value}`)[0]!.type).toBe("string");
  });
});

describe("real headless engine and SHT-00 hand-off", () => {
  it("loads in Node with no DOM, preserves formulas/styles and disposes cleanly", () => {
    expect(typeof window).toBe("undefined");
    const original = fixture();
    original.styles = { emphasis: { bl: 1 } };
    firstSheet(original).cellData![1]![1] = { v: 12, f: "=SUM(6,6)", s: "emphasis" };
    const before = structuredClone(original);
    const loaded = loadWorkbook(original);
    expect(original).toEqual(before);
    expect(firstSheet(loaded).cellData![1]![1]).toEqual({ v: 12, f: "=SUM(6,6)", s: "emphasis" });
    expect(loaded.styles).toEqual(original.styles);
    expect(loaded.sheetOrder).toEqual(original.sheetOrder);
    expect(workbookToCsv(loaded, "people")).toBe(workbookToCsv(original, "people"));
    const again = loadWorkbook(loaded);
    expect(again).toEqual(loaded);
  });

  it("round-trips JSON and ordered storage projections without losing snapshot detail", () => {
    const snapshot = loadWorkbook(fixture());
    delete firstSheet(snapshot).name;
    const storage = workbookToStorage(snapshot);
    expect(storage.sheets[0]!.name).toBe("people");
    expect(storage.sheets.map((s) => [s.csvPath, s.descriptorPath])).toEqual([
      ["sheets/0.csv", "sheets/0.jsonld"],
      ["sheets/1.csv", "sheets/1.jsonld"],
    ]);
    expect(storage.sheets[0]!.columns[2]).toEqual({ name: "Date", type: "date" });
    expect(storageToWorkbook(storage)).toEqual(snapshot);
    const restored = storageToWorkbook(JSON.parse(JSON.stringify(storage)));
    restored.name = "Changed";
    expect(snapshot.name).toBe("Fictional research");
    expect(storageToWorkbook(storage).name).toBe(snapshot.name);
  });

  it("rejects corrupt JSON and mismatched CSV/descriptor inputs", () => {
    const storage = workbookToStorage(fixture());
    expect(() => storageToWorkbook({ ...storage, workbookJson: "{" })).toThrow(SyntaxError);
    storage.sheets[0]!.csv = "different";
    expect(() => storageToWorkbook(storage)).toThrow("do not match");
  });
});
