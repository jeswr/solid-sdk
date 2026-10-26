// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatA1,
  intersectRanges,
  parseA1,
  type Reference,
  unionRanges,
} from "../src/apps/sheets/lib/refs";

describe("exact reference geometry", () => {
  it.each([
    ["A1:C4", "B3:D5", "$B$3:$C$4"],
    ["A1", "$A$1", "$A$1"],
    ["A:C", "B:D", "$B:$C"],
    ["1:3", "2:4", "$2:$3"],
    ["B:D", "2:4", "$B$2:$D$4"],
    ["A1", "A2", null],
    ["A1", "B1", null],
    ["Plan!A1", "Other!A1", null],
    ["Plan!A1", "A1", null],
    ["Plan!A1", "PLAN!A1", "'Plan'!$A$1"],
  ])("intersects %s and %s", (a, b, expected) => {
    const result = intersectRanges(parseA1(a), parseA1(b));
    expect(result === null ? null : formatA1(result)).toBe(expected);
  });
  it.each([
    ["A1:C4", "B2", ["$A$1:$C$4"]],
    ["B2", "A1:C4", ["$A$1:$C$4"]],
    ["A1", "A1", ["$A$1"]],
    ["A1:A2", "A3:A5", ["$A$1:$A$5"]],
    ["A3:A5", "A1:A2", ["$A$1:$A$5"]],
    ["A1:B2", "B1:D2", ["$A$1:$D$2"]],
    ["A1:B2", "C1:D2", ["$A$1:$D$2"]],
    ["C1:D2", "A1:B2", ["$A$1:$D$2"]],
    ["A:C", "D:E", ["$A:$E"]],
    ["1:3", "4:5", ["$1:$5"]],
    ["A1", "C1", ["$A$1", "$C$1"]],
    ["A1", "A3", ["$A$1", "$A$3"]],
    ["A1:B2", "B2:C3", ["$A$1:$B$2", "$B$2:$C$3"]],
    ["A:B", "1:2", ["$A:$B", "$1:$2"]],
    ["Plan!A1", "Other!A1", ["'Plan'!$A$1", "'Other'!$A$1"]],
    ["Plan!A1", "PLAN!A2", ["'Plan'!$A$1:$A$2"]],
  ])("unions %s and %s without adding cells", (a, b, expected) => {
    expect(unionRanges(parseA1(a), parseA1(b)).map(formatA1)).toEqual(expected);
  });
  it("matches explicit cell sets for arbitrary small rectangles", () => {
    const range = fc
      .tuple(...Array.from({ length: 4 }, () => fc.integer({ min: 1, max: 8 })))
      .map(([r1, r2, c1, c2]) => {
        const pair = (x: number, y: number) => ({
          start: { index: Math.min(x, y), absolute: false },
          end: { index: Math.max(x, y), absolute: false },
        });
        return {
          rows: pair(r1 as number, r2 as number),
          columns: pair(c1 as number, c2 as number),
        };
      });
    const cells = (ref: Reference) => {
      const output: string[] = [];
      for (let r = ref.rows?.start.index as number; r <= (ref.rows?.end.index as number); r++) {
        for (
          let c = ref.columns?.start.index as number;
          c <= (ref.columns?.end.index as number);
          c++
        )
          output.push(`${r},${c}`);
      }
      return output;
    };
    fc.assert(
      fc.property(range, range, (a, b) => {
        const ac = new Set(cells(a)),
          bc = new Set(cells(b));
        expect(new Set(unionRanges(a, b).flatMap(cells))).toEqual(new Set([...ac, ...bc]));
        const intersection = intersectRanges(a, b);
        expect(new Set(intersection === null ? [] : cells(intersection))).toEqual(
          new Set([...ac].filter((cell) => bc.has(cell))),
        );
      }),
      { numRuns: 300 },
    );
  });
});
