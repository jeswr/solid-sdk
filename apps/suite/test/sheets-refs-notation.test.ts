// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  columnToIndex,
  formatA1,
  formatR1C1,
  indexToColumn,
  parseA1,
  parseR1C1,
  type Reference,
  SheetReferenceError,
} from "../src/apps/sheets/lib/refs";

const origin = { row: 10, column: 5 };
describe("spreadsheet notation", () => {
  it.each([
    ["A1", "A1", "R[-9]C[-4]"],
    ["$b$2", "$B$2", "R2C2"],
    ["$C3:D$4", "$C3:D$4", "R[-7]C3:R4C[-1]"],
    ["A1:A1", "A1", "R[-9]C[-4]"],
    ["$1:3", "$1:3", "R1:R[-7]"],
    ["A:$Z", "A:$Z", "C[-4]:C26"],
    ["Sheet1!E10", "'Sheet1'!E10", "'Sheet1'!RC"],
    ["'Annual plan'!$E10", "'Annual plan'!$E10", "'Annual plan'!RC5"],
    ["'Dana''s sheet'!E$10", "'Dana''s sheet'!E$10", "'Dana''s sheet'!R10C"],
    ["'预算! 2026'!AA10", "'预算! 2026'!AA10", "'预算! 2026'!RC[22]"],
  ])("round-trips %s", (input, a1, rc) => {
    const ref = parseA1(input);
    expect(formatA1(ref)).toBe(a1);
    expect(formatR1C1(ref, origin)).toBe(rc);
    expect(parseR1C1(rc, origin)).toEqual(ref);
  });

  it.each([
    ["rc", "RC"],
    ["R[0]C[+0]", "RC"],
    ["R[+2]C[-3]", "R[2]C[-3]"],
    ["R:C", null],
    ["R:R[2]", "R:R[2]"],
    ["C:C[2]", "C:C[2]"],
    ["R1C1:R[2]C[3]", "R1C1:R[2]C[3]"],
    ["R1:R2", "R1:R2"],
    ["C1:C2", "C1:C2"],
  ])("canonicalises R1C1 %s", (input, expected) => {
    if (expected === null) expect(() => parseR1C1(input, origin)).toThrow(SheetReferenceError);
    else expect(formatR1C1(parseR1C1(input, origin), origin)).toBe(expected);
  });

  it.each([
    "",
    "A",
    "1",
    "$A",
    "A0",
    "A01",
    "A-1",
    "A1\n",
    "A1 ",
    " A1",
    "A1:B",
    "A:B1",
    "A:1",
    "A1:B2:C3",
    "B2:A1",
    "2:1",
    "B:A",
    "A1#",
    "[book]S!A1",
    "S1:S2!A1",
    "'bad:name'!A1",
    "''!A1",
    "'unfinished!A1",
    "S!A1\n",
    "A1!B1!C1",
    "A9007199254740992",
    "ZZZZZZZZZZZZZZZZ1",
  ])("rejects invalid A1 %j", (text) => expect(() => parseA1(text)).toThrow(SheetReferenceError));
  it.each([
    "",
    "R",
    "C",
    "R0C1",
    "R01C1",
    "R1C0",
    "R1C1\n",
    "R[-10]C",
    "RC[-5]",
    "R[1.2]C",
    "R[]C",
    "R1C1:C2",
    "R9007199254740992C1",
    "R[9007199254740992]C",
    "R[9007199254740991]C",
    "R2C1:R1C2",
  ])("rejects invalid R1C1 %j", (text) =>
    expect(() => parseR1C1(text, origin)).toThrow(SheetReferenceError));
  it("rejects invalid models and origins with typed error codes", () => {
    const ref = parseA1("A1");
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => indexToColumn(bad)).toThrow(SheetReferenceError);
      expect(() => parseR1C1("RC", { row: bad, column: 1 })).toThrow(SheetReferenceError);
      expect(() => formatR1C1(ref, { row: 1, column: bad })).toThrow(SheetReferenceError);
    }
    expect(() => formatA1({ rows: null, columns: null })).toThrow(SheetReferenceError);
    expect(() => formatA1({ ...ref, sheet: "" })).toThrow(SheetReferenceError);
    expect(() => formatA1({ ...ref, sheet: "bad\nname" })).toThrow(SheetReferenceError);
    expect(() =>
      formatA1({
        ...ref,
        rows: {
          start: { index: 1, absolute: "yes" as unknown as boolean },
          end: { index: 1, absolute: true },
        },
      }),
    ).toThrow(SheetReferenceError);
    const error = new SheetReferenceError("syntax", "Invalid reference");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SheetReferenceError");
    expect(error.code).toBe("syntax");
    expect(error.message).toBe("Invalid reference");
  });
  it.each(["", "A1", "A\n", "Å", "$A"])("rejects invalid column %j", (text) => {
    expect(() => columnToIndex(text)).toThrow(SheetReferenceError);
  });
  it("round-trips column boundaries including the safe integer limit", () => {
    for (const index of [1, 26, 27, 52, 702, 703, 16384, Number.MAX_SAFE_INTEGER]) {
      expect(columnToIndex(indexToColumn(index))).toBe(index);
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (index) => {
        expect(columnToIndex(indexToColumn(index))).toBe(index);
      }),
    );
  });
  it("round-trips mixed reference flags through both notations", () => {
    const axis = fc.record({ index: fc.integer({ min: 1, max: 10000 }), absolute: fc.boolean() });
    fc.assert(
      fc.property(axis, axis, (row, column) => {
        const ref: Reference = {
          rows: { start: row, end: row },
          columns: { start: column, end: column },
        };
        expect(parseA1(formatA1(ref))).toEqual(ref);
        expect(parseR1C1(formatR1C1(ref, origin), origin)).toEqual(ref);
      }),
    );
  });
});
