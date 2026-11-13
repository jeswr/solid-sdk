// AUTHORED-BY Codex GPT-6.1-Sol
import type { IWorkbookData } from "@univerjs/core";
import { expect, it } from "vitest";
import { decodeCell, encodeCell } from "../src/apps/sheets/lib/collaboration/formulas";
import type { Axes } from "../src/apps/sheets/lib/collaboration/model";
import { formulaReferences } from "../src/apps/sheets/lib/refs/formula";

function fixture() {
  const workbook = {
    sheets: { data: { name: "Data" }, other: { name: "Other Sheet" } },
  } as unknown as IWorkbookData;
  const positions = new Map<string, Axes>([
    ["data", { rowIds: ["r1", "r2", "r3", "r4"], colIds: ["c1", "c2", "c3", "c4"] }],
    ["other", { rowIds: ["s1", "s2", "s3", "s4"], colIds: ["d1", "d2", "d3", "d4"] }],
  ]);
  return { workbook, positions };
}

it("preserves strings, escaped quotes, function names, scientific numbers and unsupported references", () => {
  const f = '=IF("A1"="""B2""",LOG10(1E10),SUM(B3:A1))+named_value+Unknown!A1';
  const { workbook, positions } = fixture();
  const cell = encodeCell({ f }, "data", workbook, positions);
  expect(decodeCell(cell, workbook, positions)).toEqual({ f });
  expect(formulaReferences(f).map((token) => token.text)).toEqual(["B3:A1", "Unknown!A1"]);
  expect(
    decodeCell(encodeCell({ v: "plain" }, "data", workbook, positions), workbook, positions),
  ).toEqual({ v: "plain" });
  expect(
    decodeCell(encodeCell({ f: "=A1" }, "missing", workbook, positions), workbook, positions),
  ).toEqual({ f: "=A1" });
});

it("stores cell/range endpoints and absolute/mixed references against sheet, row and column IDs", () => {
  const { workbook, positions } = fixture();
  const f = "=SUM($A$1:B$3)+$B3+B$3+'Other Sheet'!$A1";
  const cell = encodeCell({ f }, "data", workbook, positions);
  expect(decodeCell(cell, workbook, positions)).toEqual({ f });
  positions.set("data", {
    rowIds: ["new", "r1", "r2", "r3", "r4"],
    colIds: ["new", "c1", "c2", "c3", "c4"],
  });
  positions.set("other", {
    rowIds: ["new", "s1", "s2", "s3", "s4"],
    colIds: ["new", "d1", "d2", "d3", "d4"],
  });
  expect(decodeCell(cell, workbook, positions).f).toBe("=SUM($B$2:C$4)+$C4+C$4+'Other Sheet'!$B2");
  expect(decodeCell(cell, workbook, positions)).not.toHaveProperty("stableFormula");
});

it("resolves whole rows, whole columns and references with differently cased sheet names", () => {
  const { workbook, positions } = fixture();
  const cell = encodeCell({ f: "=SUM($A:$B)+SUM($1:3)+data!A1" }, "data", workbook, positions);
  expect(decodeCell(cell, workbook, positions).f).toBe("=SUM($A:$B)+SUM($1:3)+data!A1");
  positions.set("data", {
    rowIds: ["new", "r1", "r2", "r3", "r4"],
    colIds: ["new", "c1", "c2", "c3", "c4"],
  });
  expect(decodeCell(cell, workbook, positions).f).toBe("=SUM($B:$C)+SUM($2:4)+data!B2");
});

it.each([
  "rowIds",
  "colIds",
] as const)("renders deleted %s as #REF! and retains unallocated endpoints", (axis) => {
  const { workbook, positions } = fixture();
  const cell = encodeCell({ f: "=A1+SUM(A1:B3)+Z99" }, "data", workbook, positions);
  positions.get("data")?.[axis].splice(0, 1);
  expect(decodeCell(cell, workbook, positions).f).toBe(
    axis === "rowIds" ? "=#REF!+SUM(#REF!)+Z98" : "=#REF!+SUM(#REF!)+Y99",
  );
});

it("invalidates references to absent sheets or structures", () => {
  const { workbook, positions } = fixture();
  workbook.sheets.unnamed = {} as IWorkbookData["sheets"][string];
  const cell = encodeCell({ f: "='Other Sheet'!A1" }, "data", workbook, positions);
  delete workbook.sheets.other;
  expect(decodeCell(cell, workbook, positions).f).toBe("=#REF!");
  positions.delete("other");
  expect(decodeCell(cell, workbook, positions).f).toBe("=#REF!");
  expect(encodeCell({ f: "=Absent!A1" }, "data", workbook, positions).f).toBe("=Absent!A1");
});

it("round-trips unallocated references and shifts them by net axis insertions/deletions", () => {
  const { workbook, positions } = fixture();
  const f = "=SUM(A1:A2000)+$ZZ$9+SUM(999:2000)+SUM(Z:ZZ)";
  const cell = encodeCell({ f }, "data", workbook, positions);
  expect(decodeCell(cell, workbook, positions)).toEqual({ f });
  positions.get("data")?.rowIds.splice(1, 0, "inserted");
  positions.get("data")?.colIds.splice(1, 0, "inserted");
  expect(decodeCell(cell, workbook, positions).f).toBe(
    "=SUM(A1:A2001)+$AAA$10+SUM(1000:2001)+SUM(AA:AAA)",
  );
  positions.get("data")?.rowIds.splice(2, 2);
  positions.get("data")?.colIds.splice(2, 2);
  expect(decodeCell(cell, workbook, positions).f).toBe(
    "=SUM(A1:A1999)+$ZY$8+SUM(998:1999)+SUM(Y:ZY)",
  );
});

it("retains reversed endpoint order and absolute flags while encoding normalized bounds", () => {
  const { workbook, positions } = fixture();
  const cell = encodeCell({ f: "=SUM($B3:A$1)+SUM(3:$1)+SUM(B:$A)" }, "data", workbook, positions);
  positions.get("data")?.rowIds.unshift("inserted");
  positions.get("data")?.colIds.unshift("inserted");
  expect(decodeCell(cell, workbook, positions).f).toBe("=SUM($C4:B$2)+SUM(4:$2)+SUM(C:$B)");
});
