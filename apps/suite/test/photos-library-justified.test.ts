// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { getOrientationTransform, layoutJustifiedRows } from "../src/apps/photos/lib/library";

describe("justified photo rows", () => {
  it("handles an empty library", () => {
    expect(layoutJustifiedRows([], 320, { targetRowHeight: 200 })).toEqual({
      width: 320,
      height: 0,
      rows: [],
    });
  });

  it("justifies completed rows with spacing and caps a trailing row", () => {
    const ratios = Object.freeze([2, 1, 1, 0.5]);
    expect(layoutJustifiedRows(ratios, 310, { targetRowHeight: 100, gap: 10 })).toEqual({
      width: 310,
      height: 210,
      rows: [
        {
          top: 0,
          height: 100,
          justified: true,
          items: [
            { index: 0, left: 0, width: 200 },
            { index: 1, left: 210, width: 100 },
          ],
        },
        {
          top: 110,
          height: 100,
          justified: false,
          items: [
            { index: 2, left: 0, width: 100 },
            { index: 3, left: 110, width: 50 },
          ],
        },
      ],
    });
    expect(ratios).toEqual([2, 1, 1, 0.5]);
  });

  it("shrinks a completed row and has no trailing vertical gap", () => {
    const result = layoutJustifiedRows([1, 1, 1], 250, { targetRowHeight: 100, gap: 5 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.height).toBe(80);
    expect(result.rows[0]?.justified).toBe(true);
    expect(result.rows[0]?.items.map(({ width }) => width)).toEqual([80, 80, 80]);
    expect(result.height).toBe(80);
  });

  it("supports a single panorama, a single portrait, and an exact fit with default gap", () => {
    expect(layoutJustifiedRows([10], 320, { targetRowHeight: 200 }).rows[0]).toEqual({
      top: 0,
      height: 32,
      justified: true,
      items: [{ index: 0, left: 0, width: 320 }],
    });
    expect(layoutJustifiedRows([0.25], 320, { targetRowHeight: 200 }).rows[0]).toEqual({
      top: 0,
      height: 200,
      justified: false,
      items: [{ index: 0, left: 0, width: 50 }],
    });
    expect(layoutJustifiedRows([1, 1], 200, { targetRowHeight: 100 }).rows[0]?.height).toBe(100);
  });

  it.each([100, 101])("breaks rows when gap %s leaves no room for another item", (gap) => {
    const result = layoutJustifiedRows([0.5, 0.5], 100, { targetRowHeight: 100, gap });
    expect(result.rows.map(({ height, justified }) => ({ height, justified }))).toEqual([
      { height: 200, justified: true },
      { height: 100, justified: false },
    ]);
    expect(result.rows[1]?.top).toBe(200 + gap);
    expect(result.height).toBe(300 + gap);
  });

  it.each([
    1, 320, 375, 768, 1280,
  ])("preserves order, aspect ratios, row widths and non-overlap at width %s", (width) => {
    // Deterministic synthetic portrait/landscape ratios, including oriented dimensions.
    const ratios = Array.from(
      { length: 97 },
      (_, index) =>
        getOrientationTransform(100 + ((index * 137) % 1000), 200, (index % 8) + 1).aspectRatio,
    );
    const gap = 4;
    const result = layoutJustifiedRows(ratios, width, { targetRowHeight: 160, gap });
    const indices: number[] = [];
    let previousBottom = -gap;
    for (const row of result.rows) {
      expect(row.top).toBeCloseTo(previousBottom + gap);
      expect(row.height).toBeGreaterThan(0);
      let previousRight = -gap;
      for (const item of row.items) {
        indices.push(item.index);
        expect(item.left).toBeCloseTo(previousRight + gap);
        expect(item.width / row.height).toBeCloseTo(ratios[item.index] as number);
        previousRight = item.left + item.width;
      }
      expect(previousRight).toBeLessThanOrEqual(width + 1e-9);
      if (row.justified) expect(previousRight).toBeCloseTo(width);
      else expect(row.height).toBeLessThanOrEqual(160);
      previousBottom = row.top + row.height;
    }
    expect(indices).toEqual(ratios.map((_, index) => index));
    expect(result.height).toBeCloseTo(previousBottom);
    expect(layoutJustifiedRows(ratios, width, { targetRowHeight: 160, gap })).toEqual(result);
  });

  it("retains fractional geometry", () => {
    const row = layoutJustifiedRows([1.5, 1.5], 100.5, { targetRowHeight: 50, gap: 0.5 }).rows[0];
    expect(row?.height).toBeCloseTo(100 / 3);
    expect(row?.items[1]?.left).toBeCloseTo(50.5);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid dimensions/ratios %s", (value) => {
    expect(() => layoutJustifiedRows([], value, { targetRowHeight: 100 })).toThrow(RangeError);
    expect(() => layoutJustifiedRows([], 320, { targetRowHeight: value })).toThrow(RangeError);
    expect(() => layoutJustifiedRows([1, value], 320, { targetRowHeight: 100 })).toThrow(
      RangeError,
    );
  });

  it.each([-1, NaN, Infinity, -Infinity])("rejects invalid gap %s", (gap) => {
    expect(() => layoutJustifiedRows([], 320, { targetRowHeight: 100, gap })).toThrow(RangeError);
  });

  it("rejects sparse ratio arrays", () => {
    expect(() => layoutJustifiedRows(new Array(1), 320, { targetRowHeight: 100 })).toThrow(
      RangeError,
    );
  });

  it("rejects numeric overflow and underflow instead of emitting invalid geometry", () => {
    const max = Number.MAX_VALUE;
    const min = Number.MIN_VALUE;
    expect(() => layoutJustifiedRows([1, 1], max, { targetRowHeight: max })).toThrow(RangeError);
    expect(() => layoutJustifiedRows([max], min, { targetRowHeight: 100 })).toThrow(RangeError);
    expect(() => layoutJustifiedRows([min], min, { targetRowHeight: min })).toThrow(RangeError);
  });
});
