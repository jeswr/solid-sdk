// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { moveDown, moveUp, positionForDrop } from "../../src/apps/tasks/lib/views/positions";
import { view } from "./tasks-views-fixtures";

describe("manual numeric positions", () => {
  const rows = [view("a", { position: 1 }), view("b", { position: 2 }), view("c", { position: 3 })];
  it("uses means and ±1 at either end, without mutating display order", () => {
    expect(positionForDrop([], 0)).toEqual({ position: 0 });
    expect(positionForDrop(rows, 0)).toEqual({ position: 0 });
    expect(positionForDrop(rows, 1)).toEqual({ position: 1.5 });
    expect(positionForDrop(rows, 3)).toEqual({ position: 4 });
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
    for (const index of [-1, 4, 0.5, Number.NaN])
      expect(() => positionForDrop(rows, index)).toThrow(TypeError);
  });

  it("renumbers every sibling when any gap is too small, even away from the insertion", () => {
    const crowded = [
      view("a", { position: 1 }),
      view("b", { position: 1 + 1e-8 }),
      view("c", { position: 5 }),
    ];
    const renumber = crowded.map((row, index) => ({ url: row.url, position: index + 1 }));
    expect(positionForDrop(crowded, 1)).toEqual({ position: 1.5, renumber });
    expect(positionForDrop(crowded, 3)).toEqual({ position: 4, renumber });
    expect(positionForDrop([view("a", { position: 0 }), view("b", { position: 1e-6 })], 1)).toEqual(
      { position: 0.5e-6 },
    );
  });

  it.each([
    [undefined, 2],
    [2, undefined],
    [2, 2],
    [3, 1],
    [Number.NaN, 2],
    [1, Infinity],
  ])("repairs missing, reversed, duplicate and nonfinite positions: %s, %s", (a, b) => {
    const siblings = [view("a", { position: a }), view("b", { position: b })];
    expect(positionForDrop(siblings, 1)).toEqual({
      position: 1.5,
      renumber: [
        { url: siblings[0]?.url, position: 1 },
        { url: siblings[1]?.url, position: 2 },
      ],
    });
  });

  it("repairs floating-point overflow or an end step that cannot change a large number", () => {
    const large = [view("large", { position: Number.MAX_VALUE })];
    expect(positionForDrop(large, 1)).toEqual({
      position: 2,
      renumber: [{ url: large[0]?.url, position: 1 }],
    });
    expect(positionForDrop(large, 0)).toEqual({
      position: 0,
      renumber: [{ url: large[0]?.url, position: 1 }],
    });
    const pair = [view("first", { position: 1e308 }), view("second", { position: 1.5e308 })];
    expect(positionForDrop(pair, 1).position).toBe(1.5);
  });

  it("moves one row to its neighbour's other side and reports missing/edge rows as no-ops", () => {
    expect(moveUp(rows, rows[1]?.url as string)).toEqual({ position: 0 });
    expect(moveDown(rows, rows[1]?.url as string)).toEqual({ position: 4 });
    expect(moveUp(rows, rows[2]?.url as string)).toEqual({ position: 1.5 });
    expect(moveDown(rows, rows[0]?.url as string)).toEqual({ position: 2.5 });
    expect(moveUp(rows, rows[0]?.url as string)).toBeUndefined();
    expect(moveDown(rows, rows[2]?.url as string)).toBeUndefined();
    expect(moveUp(rows, "missing")).toBeUndefined();
    expect(moveDown([], "missing")).toBeUndefined();
  });
});
