// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  MAX_CELL_VALUE_LENGTH,
  MAX_CELLS,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_TOKENS,
  MAX_SHEET_NAME_LENGTH,
  MAX_SHEETS,
  type MoveRange,
  planStructureEdit,
  SheetReferenceError,
  type StructureCell,
  type StructureEdit,
  type StructureSheet,
} from "../src/apps/sheets/lib/structure";

const insert = { sheet: "Plan", axis: "row", kind: "insert", index: 3, count: 2 } as const;
const deletion = { ...insert, kind: "delete" } as const;
const move: MoveRange = {
  kind: "move",
  source: { sheet: "Plan", start: { row: 2, column: 2 }, end: { row: 3, column: 3 } },
  destination: { sheet: "Plan", row: 5, column: 5 },
};
const value = (
  row: number,
  column: number,
  value: string | number | boolean | null,
): StructureCell => ({ row, column, value });
const formula = (
  row: number,
  column: number,
  formula: string,
  notation?: "A1" | "R1C1",
): StructureCell => ({ row, column, formula, ...(notation === undefined ? {} : { notation }) });
const workbook = (
  cells: readonly StructureCell[],
  others: readonly StructureCell[] = [],
): readonly StructureSheet[] => [
  { name: "Plan", cells },
  { name: "Other", cells: others },
  { name: "Dana's plan", cells: [] },
];
const rewrite = (
  text: string,
  edit: StructureEdit = insert,
  notation?: "A1" | "R1C1",
  row = 4,
  column = 2,
): string => {
  const result = planStructureEdit(workbook([formula(row, column, text, notation)]), edit);
  return result.sheets.flatMap((sheet) => sheet.cells).find((cell) => cell.formula !== undefined)
    ?.formula as string;
};
const fail = (sheets: readonly StructureSheet[], edit: StructureEdit, code?: string) => {
  try {
    planStructureEdit(sheets, edit);
    throw new Error("Expected typed failure");
  } catch (error) {
    expect(error).toBeInstanceOf(SheetReferenceError);
    if (code) expect((error as SheetReferenceError).code).toBe(code);
  }
};

describe("workbook preflight limits", () => {
  it("accepts the sheet-count bound and rejects bound+1 without reading sheets", () => {
    const sheets = Array.from({ length: MAX_SHEETS }, (_, index) => ({
      name: `Sheet${index}`,
      cells: [],
    }));
    expect(planStructureEdit(sheets, { ...insert, sheet: "Sheet0" }).sheets).toHaveLength(
      MAX_SHEETS,
    );
    const oversized = new Array<StructureSheet>(MAX_SHEETS + 1);
    Object.defineProperty(oversized, 0, {
      get() {
        throw new Error("Sheets must not be read");
      },
    });
    fail(oversized, insert, "invalid-edit");
  });

  it("bounds total cells across sheets before reading any cell", () => {
    const cells = Array.from({ length: MAX_CELLS }, (_, index) => value(index + 1, 1, index));
    const sheets = workbook(cells.slice(0, MAX_CELLS / 2), cells.slice(MAX_CELLS / 2));
    const result = planStructureEdit(sheets, { ...insert, index: MAX_CELLS + 1 });
    expect(result.sheets.reduce((count, sheet) => count + sheet.cells.length, 0)).toBe(MAX_CELLS);
    expect(result.changes).toEqual([]);

    const unreadable = new Array<StructureCell>(MAX_CELLS);
    Object.defineProperty(unreadable, 0, {
      get() {
        throw new Error("Cells must not be read");
      },
    });
    fail(workbook(unreadable, [value(1, 1, null)]), insert, "invalid-edit");
    fail(workbook(new Array<StructureCell>(MAX_CELLS + 1)), insert, "invalid-edit");
  });

  it("bounds sheet names in the workbook, edit and formula references", () => {
    const name = "S".repeat(MAX_SHEET_NAME_LENGTH);
    const sheets = [{ name, cells: [formula(1, 1, `='${name}'!A3`)] }];
    const edit = { ...insert, sheet: name.toLowerCase() };
    expect(planStructureEdit(sheets, edit).sheets[0]?.cells[0]?.formula).toBe(`='${name}'!A5`);
    const oversized = `${name}S`;
    fail([{ name: oversized, cells: [] }], insert, "invalid-edit");
    fail(sheets, { ...insert, sheet: oversized }, "invalid-edit");
    fail(sheets, { ...move, source: { ...move.source, sheet: oversized } }, "invalid-edit");
    fail(
      sheets,
      { ...move, destination: { ...move.destination, sheet: oversized } },
      "invalid-edit",
    );
    fail(workbook([formula(1, 1, `='${oversized}'!A1`)]), insert, "invalid-edit");
  });

  it("bounds string values before scanning earlier formulas or normalising names", () => {
    const text = "x".repeat(MAX_CELL_VALUE_LENGTH);
    expect(planStructureEdit(workbook([value(3, 1, text)]), insert).sheets[0]?.cells).toEqual([
      value(5, 1, text),
    ]);
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    let caught: unknown;
    try {
      planStructureEdit(
        workbook([formula(1, 1, "=unsupported_name"), value(3, 1, `${text}x`)]),
        insert,
      );
    } catch (error) {
      caught = error;
    }
    const calls = lower.mock.calls.length;
    lower.mockRestore();
    expect(calls).toBe(0);
    expect(caught).toBeInstanceOf(SheetReferenceError);
    expect(caught).toMatchObject({
      code: "invalid-edit",
      message: "Malformed or oversized workbook or structural edit",
    });
  });

  it("exports and enforces exact formula length and token bounds", () => {
    expect(MAX_FORMULA_LENGTH).toBe(8_192);
    expect(MAX_FORMULA_TOKENS).toBe(512);
    const text = `="${"x".repeat(MAX_FORMULA_LENGTH - 3)}"`;
    expect(rewrite(text)).toBe(text);
    fail(workbook([formula(1, 1, `${text} `)]), insert, "unsupported");
    const tokens = `=${"+".repeat(MAX_FORMULA_TOKENS - 1)}1`;
    expect(rewrite(tokens)).toBe(tokens);
    fail(workbook([formula(1, 1, `=+${tokens.slice(1)}`)]), insert, "unsupported");
  });

  it("reuses one case-insensitive index for forward references, edits and output cells", () => {
    const countLowercase = (count: number): number => {
      const sheets = Array.from({ length: count }, (_, index) => ({
        name: `Sheet${index}`,
        cells: [formula(1, 1, `=sHeEt${count - 1}!A1+A1`), value(2, 1, index)],
      }));
      const lower = vi.spyOn(String.prototype, "toLowerCase");
      let result: ReturnType<typeof planStructureEdit>;
      let calls: number;
      try {
        result = planStructureEdit(sheets, { ...insert, sheet: "sHeEt0", index: 3, count: 1 });
        calls = lower.mock.calls.length;
      } finally {
        lower.mockRestore();
      }
      expect(result.sheets).toEqual(sheets);
      expect(result.changes).toEqual([]);
      return calls;
    };
    const small = countLowercase(32);
    const large = countLowercase(128);
    // Four times as many sheets/cells/references must require at most four times the work.
    expect(large).toBeLessThanOrEqual(small * 4);
    expect(large).toBeLessThan(128 * 30);
  });
});

describe("record shape validation", () => {
  it("accepts every record schema at its field bound and rejects one extra field", () => {
    const sheet = { name: "Plan", cells: [] };
    const cell = { row: 1, column: 1, formula: "=A1", notation: "A1", value: undefined } as const;
    const edit = { ...insert };
    const moveEdit = { ...move };
    const source = { ...move.source };
    const start = { ...move.source.start };
    const end = { ...move.source.end };
    const destination = { ...move.destination };
    const cases: [readonly StructureSheet[], StructureEdit, object][] = [
      [[sheet], insert, sheet],
      [workbook([cell as unknown as StructureCell]), insert, cell],
      [workbook([]), edit, edit],
      [workbook([]), moveEdit, moveEdit],
      [workbook([]), { ...move, source }, source],
      [workbook([]), { ...move, source: { ...move.source, start } }, start],
      [workbook([]), { ...move, source: { ...move.source, end } }, end],
      [workbook([]), { ...move, destination }, destination],
    ];
    for (const [sheets, edit, record] of cases) {
      expect(() => planStructureEdit(sheets, edit)).not.toThrow();
      Object.defineProperty(record, "private-field", { enumerable: true, value: "private-value" });
      const saved = structuredClone([sheets, edit]);
      expect(() => planStructureEdit(sheets, edit)).toThrow(
        expect.objectContaining({ code: "unsupported", message: "Unsupported fields" }),
      );
      expect([sheets, edit]).toEqual(saved);
    }
  });

  it("rejects an oversized plain record without materialising its keys or reading extra values", () => {
    const cell = { ...value(1, 1, "private-value") };
    for (let index = 0; index < 100_001; index++) {
      Object.defineProperty(cell, `private-field-${index}`, {
        enumerable: true,
        get() {
          throw new Error("Unsupported values must not be read");
        },
      });
    }
    const keys = vi.spyOn(Object, "keys");
    const own = vi.spyOn(Object, "hasOwn");
    let caught: unknown;
    let enumerated: boolean;
    let inspected: number;
    try {
      planStructureEdit(workbook([cell]), insert);
    } catch (error) {
      caught = error;
    } finally {
      enumerated = keys.mock.calls.some(([input]) => input === cell);
      inspected = own.mock.calls.filter(([input]) => input === cell).length;
      keys.mockRestore();
      own.mockRestore();
    }
    expect(enumerated).toBe(false);
    expect(inspected).toBe(4); // Three allowed fields, then the first unsupported field.
    expect(caught).toBeInstanceOf(SheetReferenceError);
    expect(caught).toMatchObject({ code: "unsupported", message: "Unsupported fields" });
  });

  it("preserves own-field validation for null-prototype and inherited-field records", () => {
    for (const prototype of [null, { "private-inherited-field": "private-value" }]) {
      const cell = Object.assign(Object.create(prototype), value(1, 1, "literal"));
      expect(planStructureEdit(workbook([cell]), insert).sheets[0]?.cells).toEqual([
        value(1, 1, "literal"),
      ]);
      Object.defineProperty(cell, "private-own-field", {
        enumerable: true,
        value: "private-value",
      });
      expect(() => planStructureEdit(workbook([cell]), insert)).toThrow(
        expect.objectContaining({ code: "unsupported", message: "Unsupported fields" }),
      );
    }
  });

  const rejectWithoutEnumerating = (
    sheets: readonly StructureSheet[],
    edit: StructureEdit,
    malformed: unknown,
  ) => {
    const keys = vi.spyOn(Object, "keys");
    let caught: unknown;
    let enumerated: boolean;
    try {
      planStructureEdit(sheets, edit);
    } catch (error) {
      caught = error;
    } finally {
      enumerated = keys.mock.calls.some(([input]) => input === malformed);
      keys.mockRestore();
    }
    expect(enumerated).toBe(false);
    expect(caught).toBeInstanceOf(SheetReferenceError);
    expect(caught).toMatchObject({ code: "unsupported", message: "Expected a record" });
  };

  it.each([
    MAX_CELL_VALUE_LENGTH,
    MAX_CELL_VALUE_LENGTH + 1,
  ])("rejects strings and arrays of length %i before enumerating record fields", (length) => {
    for (const malformed of ["private-input".padEnd(length, "x"), new Array(length).fill(null)]) {
      const cell = malformed as unknown as StructureCell;
      rejectWithoutEnumerating(workbook([cell]), insert, malformed);
      for (const endpoint of ["start", "end"] as const) {
        const edit = {
          ...move,
          source: { ...move.source, [endpoint]: malformed },
        } as unknown as StructureEdit;
        rejectWithoutEnumerating(workbook([]), edit, malformed);
      }
    }
  });

  it.each([
    null,
    undefined,
    true,
    1,
    "",
  ])("rejects primitive move endpoints before enumeration: %j", (malformed) => {
    for (const endpoint of ["start", "end"] as const) {
      const edit = {
        ...move,
        source: { ...move.source, [endpoint]: malformed },
      } as unknown as StructureEdit;
      rejectWithoutEnumerating(workbook([]), edit, malformed);
    }
  });

  it("rejects arrays carrying otherwise valid fields at every record position", () => {
    const sheet = Object.assign([], { name: "Plan", cells: [] });
    const cell = Object.assign([], value(1, 1, "private-input"));
    const edit = Object.assign([], insert);
    const moveEdit = Object.assign([], move);
    const source = Object.assign([], move.source);
    const start = Object.assign([], move.source.start);
    const end = Object.assign([], move.source.end);
    const destination = Object.assign([], move.destination);
    const cases: [unknown, unknown, unknown][] = [
      [[sheet], insert, sheet],
      [workbook([cell]), insert, cell],
      [workbook([]), edit, edit],
      [workbook([]), moveEdit, moveEdit],
      [workbook([]), { ...move, source }, source],
      [workbook([]), { ...move, source: { ...move.source, start } }, start],
      [workbook([]), { ...move, source: { ...move.source, end } }, end],
      [workbook([]), { ...move, destination }, destination],
    ];
    for (const [sheets, edit, malformed] of cases) {
      rejectWithoutEnumerating(
        sheets as readonly StructureSheet[],
        edit as StructureEdit,
        malformed,
      );
    }
  });
});

describe("structural workbook plans", () => {
  it("rewrites references to deleted blank cells while preserving literal values", () => {
    const result = planStructureEdit(
      workbook([formula(1, 1, "=$B$3+$B3+B$3+B3"), value(1, 2, "=B3")]),
      deletion,
    );
    expect(result.sheets[0]?.cells).toEqual([
      formula(1, 1, "=#REF!+#REF!+#REF!+#REF!"),
      value(1, 2, "=B3"),
    ]);
    expect(result.changes).toHaveLength(1);
  });
  it("inserts rows and reports every changed address with independent snapshots", () => {
    const input = workbook(
      [value(5, 1, "Dana"), value(1, 1, "example.org"), value(3, 1, 8), formula(1, 2, "=$A$3+A5")],
      [formula(1, 1, "=Plan!A3+A3")],
    );
    const saved = structuredClone(input);
    const result = planStructureEdit(input, insert);
    expect(result.sheets[0]?.cells).toEqual([
      value(1, 1, "example.org"),
      formula(1, 2, "=$A$5+A7"),
      value(5, 1, 8),
      value(7, 1, "Dana"),
    ]);
    expect(result.changes).toEqual([
      {
        sheet: "Plan",
        row: 1,
        column: 2,
        before: { formula: "=$A$3+A5" },
        after: { formula: "=$A$5+A7" },
      },
      { sheet: "Plan", row: 3, column: 1, before: { value: 8 }, after: null },
      { sheet: "Plan", row: 5, column: 1, before: { value: "Dana" }, after: { value: 8 } },
      { sheet: "Plan", row: 7, column: 1, before: null, after: { value: "Dana" } },
      {
        sheet: "Other",
        row: 1,
        column: 1,
        before: { formula: "=Plan!A3+A3" },
        after: { formula: "='Plan'!A5+A3" },
      },
    ]);
    expect(input).toEqual(saved);
    expect(result.sheets[0]?.cells[0]).not.toBe(input[0]?.cells[1]);
    expect(result.changes[0]?.after).not.toBe(result.sheets[0]?.cells[1]);
  });
  it("inserts and deletes columns and removes deleted formulas", () => {
    const input = workbook([
      value(1, 1, false),
      value(1, 3, null),
      value(1, 5, 10),
      formula(2, 3, "=C1"),
      formula(3, 1, "=SUM(B:D)+$C$1+E1"),
    ]);
    expect(planStructureEdit(input, { ...insert, axis: "column" }).sheets[0]?.cells).toEqual([
      value(1, 1, false),
      value(1, 5, null),
      value(1, 7, 10),
      formula(2, 5, "=E1"),
      formula(3, 1, "=SUM(B:F)+$E$1+G1"),
    ]);
    expect(planStructureEdit(input, { ...deletion, axis: "column" }).sheets[0]?.cells).toEqual([
      value(1, 1, false),
      value(1, 3, 10),
      formula(3, 1, "=SUM(B:B)+#REF!+C1"),
    ]);
  });
  it("deletes rows and contracts ranges at either edge or across a deletion", () => {
    const input = workbook([
      value(1, 1, 1),
      formula(3, 1, "=A1"),
      value(4, 1, 4),
      formula(6, 2, "=A3+A5+SUM(A1:A6,A3:A6,A1:A3,A3:A4,3:4)"),
    ]);
    const output = planStructureEdit(input, deletion);
    expect(output.sheets[0]?.cells).toEqual([
      value(1, 1, 1),
      formula(4, 2, "=#REF!+A3+SUM(A1:A4,A3:A4,A1:A2,#REF!,#REF!)"),
    ]);
    expect(output.changes.map(({ row, column }) => [row, column])).toEqual([
      [3, 1],
      [4, 1],
      [4, 2],
      [6, 2],
    ]);
  });
  it("supports empty workbooks/sheets, no changed cells, and safe integer boundaries", () => {
    expect(planStructureEdit(workbook([]), insert).changes).toEqual([]);
    expect(planStructureEdit(workbook([value(1, 1, 1)]), { ...insert, index: 10 }).changes).toEqual(
      [],
    );
    expect(
      planStructureEdit(workbook([value(Number.MAX_SAFE_INTEGER, 1, 1)]), {
        ...deletion,
        index: Number.MAX_SAFE_INTEGER,
        count: 1,
      }).sheets[0]?.cells,
    ).toEqual([]);
    fail([], insert, "unsupported");
    fail(workbook([value(Number.MAX_SAFE_INTEGER, 1, 1)]), insert, "bounds");
    fail(workbook([formula(1, 1, `=A${Number.MAX_SAFE_INTEGER}`)]), insert, "bounds");
  });
  it("rebases R1C1 for formulas and targets moving independently", () => {
    expect(rewrite("=R[-2]C+RC+R1C1", insert, "R1C1")).toBe("=R[-4]C+RC+R1C1");
    expect(rewrite("=R3C1+R[1]C[1]", insert, "R1C1")).toBe("=R5C1+R[1]C[1]");
    expect(rewrite("=Other!RC+R1:R8+C1:C3", insert, "R1C1")).toBe("='Other'!R[-2]C+R1:R10+C1:C3");
    expect(rewrite("=Plan!R3C1+R3C1", { ...deletion, count: 1 }, "R1C1")).toBe("=#REF!+#REF!");
    expect(rewrite("=R1C1+RC[-1]", { ...insert, axis: "column" }, "R1C1", 4, 4)).toBe(
      "=R1C1+RC[-1]",
    );
    expect(rewrite("=r[0]c[0]", { ...insert, index: 10 }, "R1C1")).toBe("=r[0]c[0]");
    expect(
      planStructureEdit(
        workbook([formula(1, 1, "=R1C1", "R1C1")], [formula(4, 2, "=Plan!RC+RC", "R1C1")]),
        insert,
      ).sheets[1]?.cells[0]?.formula,
    ).toBe("='Plan'!R[2]C+RC");
  });
});

describe("cutting rectangular ranges", () => {
  it("moves mixed R1C1 range endpoints and preserves the plan as an exact patch", () => {
    const input = workbook([formula(9, 9, "=SUM(R[-7]C[-7]:R3C3)", "R1C1"), value(2, 2, 8)]);
    const result = planStructureEdit(input, move);
    expect(result.sheets[0]?.cells).toEqual([
      value(5, 5, 8),
      formula(9, 9, "=SUM(R[-4]C[-4]:R6C6)", "R1C1"),
    ]);
    const patched = input.map((sheet) => ({ ...sheet, cells: [...sheet.cells] }));
    for (const change of result.changes) {
      const sheet = patched.find((sheet) => sheet.name === change.sheet) as {
        cells: StructureCell[];
      };
      sheet.cells = sheet.cells.filter(
        (cell) => cell.row !== change.row || cell.column !== change.column,
      );
      if (change.after !== null)
        sheet.cells.push({ row: change.row, column: change.column, ...change.after });
    }
    for (const sheet of patched) sheet.cells.sort((a, b) => a.row - b.row || a.column - b.column);
    expect(patched).toEqual(result.sheets);
  });
  it("moves absolute/relative targets, overwrites destination, and clears blank-source destinations", () => {
    const input = workbook(
      [
        value(2, 2, 8),
        value(3, 3, 9),
        value(5, 5, "replace"),
        value(5, 6, "blank source clears"),
        formula(1, 1, "=$B$2+B$3+$C2+SUM(B2:C3)+E5+A8"),
        formula(2, 3, "=A1+B2+Other!A1"),
      ],
      [formula(1, 1, "=Plan!B2+A1")],
    );
    const copy = structuredClone(input);
    const result = planStructureEdit(input, move);
    expect(result.sheets[0]?.cells).toEqual([
      formula(1, 1, "=$E$5+E$6+$F5+SUM(E5:F6)+E5+A8"),
      value(5, 5, 8),
      formula(5, 6, "=A1+E5+Other!A1"),
      value(6, 6, 9),
    ]);
    expect(result.sheets[1]?.cells).toEqual([formula(1, 1, "='Plan'!E5+A1")]);
    expect(result.changes.map(({ sheet, row, column }) => [sheet, row, column])).toEqual([
      ["Plan", 1, 1],
      ["Plan", 2, 2],
      ["Plan", 2, 3],
      ["Plan", 3, 3],
      ["Plan", 5, 5],
      ["Plan", 5, 6],
      ["Plan", 6, 6],
      ["Other", 1, 1],
    ]);
    expect(input).toEqual(copy);
    const blank = planStructureEdit(workbook([value(5, 5, 8)]), move);
    expect(blank.changes).toEqual([
      { sheet: "Plan", row: 5, column: 5, before: { value: 8 }, after: null },
    ]);
  });
  it("cuts overlapping ranges from the original snapshot in either direction", () => {
    const input = workbook([
      value(2, 2, "first"),
      value(2, 3, "second"),
      value(2, 4, "overwritten"),
      value(3, 2, "third"),
    ]);
    const edit = { ...move, destination: { sheet: "Plan", row: 2, column: 3 } };
    const result = planStructureEdit(input, edit);
    expect(result.sheets[0]?.cells).toEqual([
      value(2, 3, "first"),
      value(2, 4, "second"),
      value(3, 3, "third"),
    ]);
    const reverse = {
      ...move,
      source: { sheet: "Plan", start: { row: 2, column: 3 }, end: { row: 3, column: 4 } },
      destination: { sheet: "Plan", row: 2, column: 2 },
    };
    expect(planStructureEdit(result.sheets, reverse).sheets[0]?.cells).toEqual([
      value(2, 2, "first"),
      value(2, 3, "second"),
      value(3, 2, "third"),
    ]);
  });
  it("moves between sheets, preserving the targets of moved formulas", () => {
    const edit = { ...move, destination: { sheet: "other", row: 5, column: 5 } };
    const input = workbook(
      [
        formula(2, 2, "=B3+$C$2+A1+Other!A1+'Dana''s plan'!A1"),
        value(3, 2, true),
        formula(1, 1, "=B2+Other!E5"),
      ],
      [formula(1, 1, "=Plan!B2+E5"), value(6, 6, 77)],
    );
    const result = planStructureEdit(input, edit);
    expect(result.sheets[0]?.cells).toEqual([formula(1, 1, "='other'!E5+Other!E5")]);
    expect(result.sheets[1]?.cells).toEqual([
      formula(1, 1, "='other'!E5+E5"),
      formula(5, 5, "=E6+$F$5+'Plan'!A1+Other!A1+'Dana''s plan'!A1"),
      value(6, 5, true),
    ]);
  });
  it("rebases moved R1C1 formulas and references from stationary formulas", () => {
    const input = workbook([
      formula(2, 2, "=R[-1]C[-1]+RC[1]+R2C3+Other!RC", "R1C1"),
      formula(1, 1, "=R[1]C[1]+R2C2", "R1C1"),
    ]);
    expect(planStructureEdit(input, move).sheets[0]?.cells).toEqual([
      formula(1, 1, "=R[4]C[4]+R5C5", "R1C1"),
      formula(5, 5, "=R[-4]C[-4]+RC[1]+R5C6+'Other'!R[-3]C[-3]", "R1C1"),
    ]);
    const edit = { ...move, destination: { sheet: "Other", row: 1, column: 1 } };
    expect(planStructureEdit(input, edit).sheets[1]?.cells).toEqual([
      formula(1, 1, "='Plan'!RC+RC[1]+R1C2+'Other'!R[1]C[1]", "R1C1"),
    ]);
  });
  it("treats an identical source/destination as a validated no-op", () => {
    const edit = { ...move, destination: { sheet: "plan", row: 2, column: 2 } };
    expect(
      planStructureEdit(workbook([value(2, 2, 1), formula(1, 1, "=SUM(A1:D4,A:A,1:4)")]), edit)
        .changes,
    ).toEqual([]);
    // Equal values at the same address are not reported as changes.
    expect(planStructureEdit(workbook([value(2, 2, 1), value(5, 5, 1)]), move).changes).toEqual([
      { sheet: "Plan", row: 2, column: 2, before: { value: 1 }, after: null },
    ]);
  });
  it.each([
    "=SUM(A1:B2)",
    "=SUM(B2:D3)",
    "=SUM(A1:D4)",
    "=SUM(B:B)",
    "=SUM(2:3)",
  ])("rejects a split reference atomically: %s", (text) => {
    const input = workbook([value(2, 2, 8), formula(9, 9, text)]);
    const copy = structuredClone(input);
    fail(input, move, "unsupported");
    expect(input).toEqual(copy);
  });
  it("leaves disjoint whole rows/columns and other sheets intact", () => {
    expect(rewrite("=SUM(A:A,4:5,Other!B2:C3)", move)).toBe("=SUM(A:A,4:5,Other!B2:C3)");
  });
});

describe("formula dialect", () => {
  it.each([
    ["=SUM(A1:A4)+$B$3*C$5", "=SUM(A1:A6)+$B$5*C$7"],
    ['=IF(A3="A3", "Dana said ""A3""", A1)', '=IF(A5="A3", "Dana said ""A3""", A1)'],
    ['="example.org/A3"&A3&""', '="example.org/A3"&A5&""'],
    ["=plan!A3+Other!A3", "='plan'!A5+Other!A3"],
    ["='Plan'!A3+'Dana''s plan'!A3", "='Plan'!A5+'Dana''s plan'!A3"],
    ["=SUM(1:4,A:B)", "=SUM(1:6,A:B)"],
    ["= log10 ( A3 ) + ATAN2(A3, 2)", "= log10 ( A5 ) + ATAN2(A5, 2)"],
    [
      "= - + A3^2/1.5e+2-3.0E-2+ .5 & TRUE <> FALSE",
      "= - + A5^2/1.5e+2-3.0E-2+ .5 & TRUE <> FALSE",
    ],
    ["=(A3+2)*5%+1<=2", "=(A5+2)*5%+1<=2"],
    ["=IF(A3>=2,A3>1,A3<3)", "=IF(A5>=2,A5>1,A5<3)"],
    ["=DAYS360(A3,B3)", "=DAYS360(A5,B5)"],
    ["=NOW()+SUM(A1,A2)", "=NOW()+SUM(A1,A2)"],
    [
      "=#REF!+#DIV/0!+#VALUE!+#N/A+#NAME?+#NUM!+#NULL!",
      "=#REF!+#DIV/0!+#VALUE!+#N/A+#NAME?+#NUM!+#NULL!",
    ],
    ["=a1  +  a2\n", "=a1  +  a2\n"],
  ])("preserves syntax and shifts only references in %s", (before, after) =>
    expect(rewrite(before)).toBe(after));
  it.each([
    ["A1", "=A9", "=A11", insert],
    ["A1", "=Z1", "=AB1", { ...insert, axis: "column" }],
    ["A1", "=A3", "=#REF!", deletion],
    ["A1", "=B2", "='Other'!E5", { ...move, destination: { sheet: "Other", row: 5, column: 5 } }],
    ["R1C1", "=R[8]C", "=R[10]C", insert],
  ] as const)("enforces the rewritten length limit for %s %s", (notation, before, after, edit) => {
    const suffix = `&"${"x".repeat(8192 - after.length - 3)}"`;
    const rewritten = rewrite(before + suffix, edit, notation, 1, 1);
    expect(rewritten).toBe(after + suffix);
    expect(rewritten).toHaveLength(8192);
    expect(
      planStructureEdit(workbook([formula(1, 1, rewritten, notation)]), { ...insert, index: 100 })
        .changes,
    ).toEqual([]);

    const input = workbook([
      value(9, 8, "preserve on failure"),
      formula(1, 1, `${before}${suffix} `, notation),
    ]);
    const saved = structuredClone(input);
    fail(input, edit, "unsupported");
    expect(input).toEqual(saved);
  });
  it.each([
    "",
    "A1",
    "=",
    "= ",
    "=SUM(A1",
    "=SUM(A1,)",
    "=SUM(,A1)",
    "=SUM(A1,,A2)",
    "=()",
    "=A1 A2",
    "=(A1,A2)",
    "=A1:B2:C3",
    "=A1+",
    "=A1)",
    "=A1+*2",
    "=+",
    "=*A1",
    '=IF(A1,"unterminated)',
    "='unfinished!A1",
    "=[book]Plan!A1",
    "='[book]Plan'!A1",
    "=Plan:Other!A1",
    "=Table[Column]",
    "=A1#",
    "=@A1",
    "={1,2}",
    "=SUM(A1;A2)",
    "=named_range",
    "=A0",
    "=A01",
    "=A1_name",
    "=A1 (B1)",
    "=A1(B1)",
    "=RC[1]",
    "=A1:A",
    "=Plan!A1:Other!A2",
    "=1e",
    "=1..2",
    "=#SPILL!",
    "=TRUE_name",
    '=A1+"',
  ])("fails closed on %j", (text) => fail(workbook([formula(1, 1, text)]), insert));
  it("rejects invalid R1C1 and bounded-complexity excesses", () => {
    fail(workbook([formula(1, 1, "=RC (R1C1)", "R1C1")]), insert);
    fail(workbook([formula(1, 1, "=R0C1", "R1C1")]), insert);
    fail(workbook([formula(1, 1, "=R[-1]C", "R1C1")]), insert, "bounds");
    fail(workbook([formula(1, 1, `="${"x".repeat(8192)}"`)]), insert);
    fail(workbook([formula(1, 1, `=${"(".repeat(260)}1${")".repeat(260)}`)]), insert);
  });
});

describe("fail-closed inputs", () => {
  it.each([
    [{ name: "Plan", cells: [value(0, 1, 1)] }],
    [{ name: "Plan", cells: [value(1, -1, 1)] }],
    [{ name: "Plan", cells: [value(1.5, 1, 1)] }],
    [{ name: "", cells: [] }],
    [{ name: "bad/name", cells: [] }],
    [
      { name: "Plan", cells: [] },
      { name: "plan", cells: [] },
    ],
    [{ name: "Plan", cells: [value(1, 1, 1), value(1, 1, 2)] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: NaN }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: Infinity }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: undefined }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: new Date() }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: 1, notation: "A1" }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: 1, formula: "=A1" }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, formula: 123 }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, formula: "=A1", notation: "invalid" }] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, formula: "=Missing!A1" }] }],
    [{ name: "Plan", cells: [], merged: [] }],
    [{ name: "Plan", cells: [{ row: 1, column: 1, value: 1, style: {} }] }],
    null,
    {},
    [null],
    [{ name: "Plan" }],
    [{ name: 1, cells: [] }],
    [{ name: "Plan", cells: [null] }],
    [{ name: "Plan", cells: new Array(1) }],
  ])("rejects invalid workbook %#", (sheets) =>
    fail(sheets as unknown as readonly StructureSheet[], insert));
  it.each([
    { ...insert, axis: "invalid" },
    { ...insert, kind: "invalid" },
    { ...insert, index: 0 },
    { ...insert, count: 0 },
    { ...insert, count: 1.2 },
    { ...insert, index: Number.MAX_SAFE_INTEGER, count: 2 },
    { ...insert, sheet: "Missing" },
    { ...insert, extra: true },
    { ...move, source: { ...move.source, start: { row: 4, column: 2 } } },
    { ...move, source: { ...move.source, end: { row: 3, column: 1 } } },
    { ...move, destination: { sheet: "Missing", row: 1, column: 1 } },
    { ...move, destination: { sheet: "Other", row: 0, column: 1 } },
    { ...move, destination: { sheet: "Other", row: Number.MAX_SAFE_INTEGER, column: 1 } },
    { ...move, destination: { sheet: "Other", row: 1, column: Number.MAX_SAFE_INTEGER } },
    { ...move, source: { ...move.source, start: { row: 1, column: 1, extra: true } } },
    null,
  ])("rejects invalid edit %#", (edit) => fail(workbook([]), edit as unknown as StructureEdit));
  it("validates unsupported formulas even when their cells would be deleted or overwritten", () => {
    fail(workbook([formula(3, 1, "=unsupported_name")]), deletion);
    fail(workbook([formula(5, 5, "=unsupported_name")]), move);
  });
});
