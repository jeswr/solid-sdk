// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

  it.each([
    "\uFEFF",
    "\uFEFFAvery",
    "\uFEFF\uFEFFName",
  ])("preserves a quoted leading U+FEFF field: %j", (value) => {
    const input = `"${value}",\uFEFFOther\r\n\uFEFFRow,value\r\n`;
    const grid = parseCsv(input);
    expect(grid[0]![0]).toBe(value);
    expect(serializeCsv(grid)).toBe(input);
    expect(parseCsv(serializeCsv(grid))).toEqual(grid);
    const snapshot = loadWorkbook(
      csvToWorkbook("bom", "Unicode", [{ id: "s", name: "Sheet", csv: input }]),
    );
    expect(workbookToCsv(snapshot, "s")).toBe(input);
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
    expect(() => csvToWorkbook("x", "x", [{ id: "__proto__", name: "Proto", csv: "a" }])).toThrow(
      "__proto__",
    );
    const snapshot = fixture();
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
  it.each([
    "constructor",
    "toString",
    "hasOwnProperty",
  ])("preserves supported prototype-like sheet ID %s through engine and storage", (id) => {
    const snapshot = csvToWorkbook("x", "x", [{ id, name: "Sheet", csv: "a\nb" }]);
    const loaded = loadWorkbook(snapshot);
    expect(loaded.sheetOrder).toEqual([id]);
    expect(Object.hasOwn(loaded.sheets, id)).toBe(true);
    expect(workbookToCsv(loaded, id)).toBe("a\r\nb\r\n");
    expect(storageToWorkbook(workbookToStorage(loaded))).toEqual(loaded);
  });

  it("rejects __proto__ in either the sheet order or map before engine loading", () => {
    const snapshot = fixture();
    const before = structuredClone(snapshot);
    const sheets = JSON.parse('{"__proto__":{"id":"__proto__","name":"Proto"}}');
    expect(() => loadWorkbook({ ...snapshot, sheetOrder: ["__proto__"] })).toThrow("__proto__");
    expect(() => loadWorkbook({ ...snapshot, sheets })).toThrow("__proto__");
    expect(() => loadWorkbook({ sheets })).toThrow("__proto__");
    expect(() => loadWorkbook({ sheetOrder: ["__proto__"] })).toThrow("__proto__");
    expect(snapshot).toEqual(before);
  });

  it("still loads partial snapshots with engine defaults", () => {
    const loaded = loadWorkbook({});
    expect(loaded.sheetOrder).toHaveLength(1);
    expect(Object.keys(loaded.sheets)).toEqual(loaded.sheetOrder);
  });

  it("exports engine boolean 0/1 cells as booleans while preserving numeric cells", () => {
    const snapshot = csvToWorkbook("bool", "Boolean cells", [
      { id: "s", name: "Sheet", csv: "Active,Count\nfalse,0\ntrue,1" },
    ]);
    snapshot.sheets.s!.cellData![1] = {
      0: { v: 0, t: CellValueType.BOOLEAN },
      1: { v: 0, t: CellValueType.NUMBER },
    };
    snapshot.sheets.s!.cellData![2] = {
      0: { v: 1, t: CellValueType.BOOLEAN },
      1: { v: 1, t: CellValueType.NUMBER },
    };
    const loaded = loadWorkbook(snapshot);
    expect(loaded.sheets.s!.cellData![1]![0]).toEqual({ v: 0, t: CellValueType.BOOLEAN });
    expect(loaded.sheets.s!.cellData![2]![0]).toEqual({ v: 1, t: CellValueType.BOOLEAN });
    expect(workbookToCsv(loaded, "s")).toBe("Active,Count\r\nfalse,0\r\ntrue,1\r\n");
    const storage = workbookToStorage(loaded);
    expect(storage.sheets[0]!.columns).toEqual([
      { name: "Active", type: "boolean" },
      { name: "Count", type: "number" },
    ]);
    expect(storageToWorkbook(storage)).toEqual(loaded);
  });

  it.each([
    ["New text\r\n", "New text"],
    ["\u001aFirst\u001b\rSecond\u001c\u001d\u000e\u000f\u0010\u0011\r\n", "First\rSecond"],
    ["\r\n", ""],
    ["No terminator", "No terminator"],
  ])("exports authoritative rich text %j through engine and storage", (dataStream, expected) => {
    const snapshot = csvToWorkbook("rich", "Rich text", [
      { id: "s", name: "Sheet", csv: "Text,Count\nold,99" },
    ]);
    snapshot.sheets.s!.cellData![1] = {
      0: { v: "", p: { id: "text", documentStyle: {}, body: { dataStream } } },
      1: {
        v: false,
        t: CellValueType.BOOLEAN,
        p: { id: "count", documentStyle: {}, body: { dataStream: "42\r\n" } },
      },
    };
    const loaded = loadWorkbook(snapshot);
    expect(loaded.sheets.s!.cellData![1]).toEqual(snapshot.sheets.s!.cellData![1]);
    const csv = serializeCsv([
      ["Text", "Count"],
      [expected, "42"],
    ]);
    expect(workbookToCsv(snapshot, "s")).toBe(csv);
    expect(workbookToCsv(loaded, "s")).toBe(csv);
    const storage = workbookToStorage(loaded);
    expect(storage.sheets[0]!.csv).toBe(csv);
    expect(storage.sheets[0]!.columns).toEqual([
      { name: "Text", type: "string" },
      { name: "Count", type: "number" },
    ]);
    expect(storageToWorkbook(storage)).toEqual(loaded);
  });

  it("falls back to scalar text when a rich-text document has no content", () => {
    const snapshot = fixture();
    firstSheet(snapshot).cellData = {
      0: {
        0: { v: "Empty body", p: { id: "empty", documentStyle: {}, body: { dataStream: "" } } },
        1: { v: "No body", p: { id: "missing", documentStyle: {} } },
      },
    };
    expect(workbookToCsv(snapshot, "people")).toBe("Empty body,No body\r\n");
  });

  it.each([
    ["false", "false"],
    ["FALSE", "false"],
    ["fAlSe", "false"],
    ["0", "false"],
    ["0.0", "false"],
    [false, "false"],
    ["true", "true"],
    ["TRUE", "true"],
    ["tRuE", "true"],
    ["1", "true"],
    ["1.0", "true"],
    [true, "true"],
  ])("normalizes boolean cell %j through engine and storage", (value, expected) => {
    const snapshot = csvToWorkbook("bool", "Boolean representations", [
      { id: "s", name: "Sheet", csv: "Active,Text\nvalue,value" },
    ]);
    snapshot.sheets.s!.cellData![1] = {
      0: { v: value, t: CellValueType.BOOLEAN },
      1: { v: String(value), t: CellValueType.STRING },
    };
    const loaded = loadWorkbook(snapshot);
    expect(loaded.sheets.s!.cellData![1]![0]).toEqual({ v: value, t: CellValueType.BOOLEAN });
    const csv = `Active,Text\r\n${expected},${value}\r\n`;
    expect(workbookToCsv(snapshot, "s")).toBe(csv);
    expect(workbookToCsv(loaded, "s")).toBe(csv);
    const storage = workbookToStorage(loaded);
    expect(storage.sheets[0]!.csv).toBe(csv);
    expect(storage.sheets[0]!.columns[0]).toEqual({ name: "Active", type: "boolean" });
    expect(storageToWorkbook(storage)).toEqual(loaded);
  });

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

  it("accepts equivalent records regardless of sheet and column property order", () => {
    const snapshot = loadWorkbook(fixture());
    const storage = workbookToStorage(snapshot);
    storage.sheets = storage.sheets.map((sheet) => ({
      columns: sheet.columns.map(({ name, type }) => ({ type, name })),
      csv: sheet.csv,
      descriptorPath: sheet.descriptorPath,
      csvPath: sheet.csvPath,
      name: sheet.name,
      id: sheet.id,
    }));
    expect(storageToWorkbook(JSON.parse(JSON.stringify(storage)))).toEqual(snapshot);
  });

  it.each([
    "id",
    "name",
    "csvPath",
    "descriptorPath",
    "csv",
  ] as const)("rejects a changed sheet %s", (field) => {
    const storage = workbookToStorage(fixture());
    storage.sheets[0]![field] = "different";
    expect(() => storageToWorkbook(storage)).toThrow("do not match");
  });

  it.each(["name", "type"] as const)("rejects a changed column %s", (field) => {
    const storage = workbookToStorage(fixture());
    if (field === "name") storage.sheets[0]!.columns[0]!.name = "Different";
    else storage.sheets[0]!.columns[0]!.type = "number";
    expect(() => storageToWorkbook(storage)).toThrow("do not match");
  });

  it.each(["sheets", "columns"] as const)("preserves meaningful %s array order", (field) => {
    const storage = workbookToStorage(fixture());
    if (field === "sheets") storage.sheets.reverse();
    else storage.sheets[0]!.columns.reverse();
    expect(() => storageToWorkbook(storage)).toThrow("do not match");
  });

  it.each(["sheets", "columns"] as const)("rejects missing or extra %s", (field) => {
    for (const change of ["missing", "extra", "hole"]) {
      const storage = workbookToStorage(fixture());
      const records = field === "sheets" ? storage.sheets : storage.sheets[0]!.columns;
      if (change === "missing") records.pop();
      else if (change === "extra") records.length += 1;
      else delete records[0];
      expect(() => storageToWorkbook(storage)).toThrow("do not match");
    }
  });
});
