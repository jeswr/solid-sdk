// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  deserializeSnapshot,
  type Snapshot,
  serializeSnapshot,
} from "../../src/apps/sheets/lib/model";

describe("opaque engine snapshot JSON", () => {
  it("preserves formulas, formatting, multi-sheet state and all JSON primitives", () => {
    const repeated = { v: null };
    const snapshot: Snapshot = {
      id: "book",
      sheetOrder: ["s2", "s1"],
      sheets: {
        s1: { cellData: { 0: { 0: { f: "=SUM(A2:A10)", v: 42, s: { bold: true } } } } },
        s2: { values: [null, false, -1.5, "🍃", repeated, repeated] },
      },
    };
    expect(deserializeSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
    expect(deserializeSnapshot('{"__proto__":{"x":1}}')).toHaveProperty("__proto__");
  });
  it("rejects non-objects, invalid JSON, unsupported objects and lossy values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const values: unknown[] = [
      null,
      [],
      true,
      1,
      "s",
      undefined,
      { v: undefined },
      { v: NaN },
      { v: Infinity },
      { v: BigInt(1) },
      { v: () => 1 },
      { v: Symbol() },
      { v: new Date() },
      { v: new Map() },
      { v: Array(1) },
      cyclic,
      { [Symbol()]: 1 },
    ];
    for (const value of values)
      expect(() => serializeSnapshot(value as Snapshot)).toThrow(TypeError);
    expect(() => deserializeSnapshot("{")).toThrow(SyntaxError);
    expect(() => deserializeSnapshot("null")).toThrow(TypeError);
    expect(() => deserializeSnapshot('{"a":1e999}')).toThrow(TypeError);
  });
});
