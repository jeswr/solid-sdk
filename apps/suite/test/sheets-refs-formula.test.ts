// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type FormulaContext,
  SheetReferenceError,
  type StructuralEdit,
  shiftFormula,
} from "../src/apps/sheets/lib/refs";

const edit: StructuralEdit = { sheet: "Plan", axis: "row", kind: "insert", index: 3, count: 2 };
const context = { sheet: "Plan" };
describe("formula reference tokenization and shifting", () => {
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
  ])("rewrites %s", (before, after) => expect(shiftFormula(before, edit, context)).toBe(after));

  it("honours qualified targets independently of the formula's sheet", () => {
    expect(shiftFormula("=A3+Plan!A3", edit, { sheet: "Other", notation: "A1" })).toBe(
      "=A3+'Plan'!A5",
    );
    expect(shiftFormula("='Dana''s plan'!A3", { ...edit, sheet: "Dana's plan" }, context)).toBe(
      "='Dana''s plan'!A5",
    );
  });
  it("emits #REF! for deleted targets and contracts surviving ranges", () => {
    const change = { ...edit, kind: "delete" } as const;
    const formula = shiftFormula("=$A$3+SUM(A2:A5,3:4,Other!A3)", change, context);
    expect(formula).toBe("=#REF!+SUM(A2:A3,#REF!,Other!A3)");
    expect(shiftFormula(formula, edit, context)).toBe("=#REF!+SUM(A2:A5,#REF!,Other!A3)");
    expect(shiftFormula("=SUM(B:D,C3)", { ...change, axis: "column" }, context)).toBe(
      "=SUM(B:B,#REF!)",
    );
  });
  it.each([
    ["=R[-2]C+RC+R1C1", "=R[-4]C+RC+R1C1"],
    ["=R3C1+R[1]C[1]", "=R5C1+R[1]C[1]"],
    ["=Other!RC+R1:R8+C1:C3", "='Other'!R[-2]C+R1:R10+C1:C3"],
    ['=IF(RC="R3C1",RC,R1C1)', '=IF(RC="R3C1",RC,R1C1)'],
  ])("moves R1C1 target and origin in %s", (before, after) => {
    expect(
      shiftFormula(before, edit, {
        sheet: "Plan",
        notation: "R1C1",
        origin: { row: 4, column: 2 },
      }),
    ).toBe(after);
  });
  it("moves column origins and keeps references on unaffected sheets", () => {
    const ctx = { sheet: "Plan", notation: "R1C1", origin: { row: 4, column: 4 } } as const;
    expect(shiftFormula("=R1C1+RC[-1]", { ...edit, axis: "column" }, ctx)).toBe("=R1C1+RC[-1]");
    expect(shiftFormula("=Plan!RC+RC", edit, { ...ctx, sheet: "Other" })).toBe("='Plan'!R[2]C+RC");
    expect(shiftFormula("=RC", { ...edit, sheet: "Other" }, ctx)).toBe("=RC");
    expect(shiftFormula("=R3C1+RC", { ...edit, kind: "delete", index: 3, count: 1 }, ctx)).toBe(
      "=#REF!+RC",
    );
    expect(shiftFormula("=r[0]c[0]", { ...edit, index: 10 }, ctx)).toBe("=r[0]c[0]");
    expect(() => shiftFormula("=RC (R1C1)", edit, ctx)).toThrow(SheetReferenceError);
  });
  it("rejects a deleted R1C1 origin", () => {
    expect(() =>
      shiftFormula(
        "=RC",
        { ...edit, kind: "delete" },
        { sheet: "Plan", notation: "R1C1", origin: { row: 3, column: 2 } },
      ),
    ).toThrow(SheetReferenceError);
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
  ])("fails closed on %j", (formula) => {
    expect(() => shiftFormula(formula, edit, context)).toThrow(SheetReferenceError);
  });
  it("rejects unsupported notation and bounds complexity", () => {
    expect(() =>
      shiftFormula("=A1", edit, { sheet: "Plan", notation: "other" } as unknown as FormulaContext),
    ).toThrow(SheetReferenceError);
    expect(() => shiftFormula(`="${"x".repeat(8192)}"`, edit, context)).toThrow(
      SheetReferenceError,
    );
    expect(() => shiftFormula(`=${"(".repeat(260)}1${")".repeat(260)}`, edit, context)).toThrow(
      SheetReferenceError,
    );
    expect(() =>
      shiftFormula("=R0C1", edit, {
        sheet: "Plan",
        notation: "R1C1",
        origin: { row: 1, column: 1 },
      }),
    ).toThrow(SheetReferenceError);
  });
});
