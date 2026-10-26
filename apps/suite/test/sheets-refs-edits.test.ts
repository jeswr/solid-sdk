// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatA1,
  parseA1,
  SheetReferenceError,
  type StructuralEdit,
  shiftReference,
} from "../src/apps/sheets/lib/refs";

const edit: StructuralEdit = { sheet: "Plan", axis: "row", kind: "insert", index: 3, count: 2 };
const apply = (text: string, change: StructuralEdit): string => {
  const ref = shiftReference(parseA1(text), change, "Plan");
  return ref === null ? "#REF!" : formatA1(ref);
};
describe("structural reference edits", () => {
  it.each([
    ["A1", "A1"],
    ["A3", "A5"],
    ["$A$3", "$A$5"],
    ["A1:A3", "A1:A5"],
    ["A3:B5", "A5:B7"],
    ["1:2", "1:2"],
    ["1:3", "1:5"],
    ["3:5", "5:7"],
    ["A:B", "A:B"],
    ["'plan'!A3", "'plan'!A5"],
    ["Other!A3", "'Other'!A3"],
  ])("inserts rows in %s", (before, after) => expect(apply(before, edit)).toBe(after));
  it.each([
    ["A1", "A1"],
    ["A3", "#REF!"],
    ["$A$4", "#REF!"],
    ["A5", "A3"],
    ["A1:A2", "A1:A2"],
    ["A1:A3", "A1:A2"],
    ["A1:A4", "A1:A2"],
    ["A1:A5", "A1:A3"],
    ["A3:A4", "#REF!"],
    ["A3:A6", "A3:A4"],
    ["A4:A6", "A3:A4"],
    ["A5:A6", "A3:A4"],
    ["$A$3:B$6", "$A$3:B$4"],
    ["3:4", "#REF!"],
    ["2:5", "2:3"],
    ["A:B", "A:B"],
  ])("deletes rows in %s", (before, after) =>
    expect(apply(before, { ...edit, kind: "delete" })).toBe(after));
  it.each([
    ["insert", "C3", "E3"],
    ["insert", "$A1:$D4", "$A1:$F4"],
    ["insert", "C:D", "E:F"],
    ["insert", "3:5", "3:5"],
    ["delete", "C3", "#REF!"],
    ["delete", "B:E", "B:C"],
    ["delete", "A1:D4", "A1:B4"],
    ["delete", "1:3", "1:3"],
  ] as const)("%s columns in %s", (kind, before, after) => {
    expect(apply(before, { ...edit, axis: "column", kind })).toBe(after);
  });
  it("rejects invalid edits and overflow", () => {
    for (const invalid of [
      { index: 0 },
      { count: -1 },
      { count: 1.5 },
      { index: Number.MAX_SAFE_INTEGER, count: 2 },
      { axis: "cell" },
      { kind: "move" },
      { sheet: "" },
    ]) {
      expect(() =>
        shiftReference(parseA1("A1"), { ...edit, ...invalid } as StructuralEdit, "Plan"),
      ).toThrow(SheetReferenceError);
    }
    expect(() => apply(`A${Number.MAX_SAFE_INTEGER}`, edit)).toThrow(SheetReferenceError);
    expect(() => shiftReference(parseA1("A1"), edit, "")).toThrow(SheetReferenceError);
  });
  it("does not mutate the caller's reference or edit", () => {
    const ref = parseA1("$A$3:B5"),
      original = structuredClone(ref);
    shiftReference(ref, edit, "Plan");
    expect(ref).toEqual(original);
    expect(edit).toEqual({ sheet: "Plan", axis: "row", kind: "insert", index: 3, count: 2 });
  });
  it("contracts exactly the surviving rows for arbitrary deletion intervals", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 10 }),
        (start, width, index, count) => {
          const end = start + width;
          const survivors = Array.from({ length: width + 1 }, (_, i) => start + i)
            .filter((row) => row < index || row >= index + count)
            .map((row) => (row < index ? row : row - count));
          const result = shiftReference(
            parseA1(`A${start}:A${end}`),
            { ...edit, kind: "delete", index, count },
            "Plan",
          );
          if (survivors.length === 0) expect(result).toBeNull();
          else
            expect([result?.rows?.start.index, result?.rows?.end.index]).toEqual([
              survivors[0],
              survivors.at(-1),
            ]);
        },
      ),
    );
  });
});
