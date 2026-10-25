// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type Column,
  csvToGrid,
  type Grid,
  gridToCsv,
  inferColumns,
  parseCsv,
  validateGrid,
} from "../../src/apps/sheets/lib/model";

describe("CSV and typed grids", () => {
  it("round-trips text, finite numbers and dates with a descriptor", () => {
    const grid: Grid = {
      columns: ["Label", "Amount", "When"],
      rows: [
        [' a,"quoted"\r\nline 🍃', -1.5, new Date("2026-10-25T12:34:56.789Z")],
        ["second", 2e-7, new Date("2024-02-29T00:00:00.000Z")],
        [null, null, null],
      ],
    };
    expect(csvToGrid(gridToCsv(grid), inferColumns(grid))).toEqual(grid);
    expect(inferColumns(grid)).toEqual([
      { name: "Label", type: "text", format: "text" },
      { name: "Amount", type: "number", format: "number" },
      { name: "When", type: "date", format: "date-time" },
    ]);
  });
  it("reads BOMs, escaped quotes, embedded record separators, trailing empties and blank records", () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"x""y","z\nw",\r\n,,')).toEqual([
      ["a", "b", "c"],
      ['x"y', "z\nw", ""],
      ["", "", ""],
    ]);
    expect(parseCsv("a\rb\nc")).toEqual([["a"], ["b"], ["c"]]);
    expect(parseCsv('""')).toEqual([[""]]);
    expect(parseCsv("\n")).toEqual([[""]]);
    expect(parseCsv("a,\n")).toEqual([["a", ""]]);
    expect(parseCsv("")).toEqual([]);
  });
  it.each([
    'a"b',
    '"a"x',
    '"a""',
    '"a""b',
    '"a"""x',
    '"a""""',
  ])("rejects malformed quoting %j", (csv) => {
    expect(() => parseCsv(csv)).toThrow(TypeError);
  });
  it("infers conservatively across the whole column, ignoring blank cells", () => {
    const csv =
      "number,date,id,unsafe,overflow,invalid,mixed,blank\n-1.2e+3,2024-02-29,001,9007199254740993,1e999,2025-02-29,2,\n3,2026-10-25,002,9007199254740994,Infinity,2026-13-01,text,\n";
    const grid = csvToGrid(csv);
    expect(grid.rows[0]).toEqual([
      -1200,
      new Date("2024-02-29"),
      "001",
      "9007199254740993",
      "1e999",
      "2025-02-29",
      "2",
      null,
    ]);
    expect(inferColumns(grid).map((c) => c.type)).toEqual([
      "number",
      "date",
      "text",
      "text",
      "text",
      "text",
      "text",
      "text",
    ]);
    expect(inferColumns({ columns: ["empty"], rows: [[""]] })).toEqual([
      { name: "empty", type: "text", format: "text" },
    ]);
  });
  it("preserves numeric/date-like text using descriptor hints and normalises empty text", () => {
    const columns: Column[] = [{ name: "Label", type: "text", format: "text" }];
    expect(csvToGrid('Label\n42\n2026-10-25\n""\n', columns).rows).toEqual([
      ["42"],
      ["2026-10-25"],
      [null],
    ]);
    expect(csvToGrid(gridToCsv({ columns: ["Label"], rows: [[""]] }), columns).rows).toEqual([
      [null],
    ]);
    expect(csvToGrid("a\n")).toEqual({ columns: ["a"], rows: [] });
    expect(csvToGrid('a\n""')).toEqual({ columns: ["a"], rows: [[null]] });
  });
  it("rejects mismatched columns, malformed cells and missing headers", () => {
    expect(() => csvToGrid("")).toThrow("header");
    expect(() => csvToGrid("a,b\n1")).toThrow("rectangular");
    expect(() => csvToGrid("a", [])).toThrow(TypeError);
    expect(() => csvToGrid("a", [{ name: "b", type: "text", format: "text" }])).toThrow(
      "columns differ",
    );
    expect(() => csvToGrid("a\nno", [{ name: "a", type: "number", format: "number" }])).toThrow(
      "descriptor type",
    );
    expect(() => validateGrid({ columns: [], rows: [] })).toThrow("column");
    expect(() => validateGrid({ columns: [false] as unknown as string[], rows: [] })).toThrow(
      "column",
    );
    for (const value of [NaN, Infinity, new Date("invalid"), false, undefined, {}]) {
      expect(() => gridToCsv({ columns: ["a"], rows: [[value]] } as Grid)).toThrow(
        "Invalid grid cell",
      );
    }
  });
  it("validates descriptor columns even without data, and honors explicitly numeric columns", () => {
    for (const column of [
      { name: "a", type: "unknown", format: "text" },
      { name: "a", type: "number", format: "date-time" },
      { name: 1, type: "text", format: "text" },
    ])
      expect(() => csvToGrid("a", [column] as Column[])).toThrow("descriptor columns");
    const columns: Column[] = [{ name: "a", type: "number", format: "number" }];
    const grid: Grid = { columns: ["a"], rows: [[1e20], [Number.MAX_VALUE]] };
    expect(csvToGrid(gridToCsv(grid), columns)).toEqual(grid);
    expect(() => csvToGrid("a\n1e999", columns)).toThrow("descriptor type");
    expect(() =>
      csvToGrid("a\nnot-a-date", [{ name: "a", type: "date", format: "date-time" }]),
    ).toThrow("descriptor type");
  });
});
