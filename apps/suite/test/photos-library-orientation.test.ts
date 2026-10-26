// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { getOrientationTransform } from "../src/apps/photos/lib/library";

describe("EXIF layout transforms", () => {
  // Expected locations of source corners TL, TR, BR, BL in continuous edge coordinates.
  it.each([
    [
      1,
      6,
      4,
      [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    ],
    [
      2,
      6,
      4,
      [
        [6, 0],
        [0, 0],
        [0, 4],
        [6, 4],
      ],
    ],
    [
      3,
      6,
      4,
      [
        [6, 4],
        [0, 4],
        [0, 0],
        [6, 0],
      ],
    ],
    [
      4,
      6,
      4,
      [
        [0, 4],
        [6, 4],
        [6, 0],
        [0, 0],
      ],
    ],
    [
      5,
      4,
      6,
      [
        [0, 0],
        [0, 6],
        [4, 6],
        [4, 0],
      ],
    ],
    [
      6,
      4,
      6,
      [
        [4, 0],
        [4, 6],
        [0, 6],
        [0, 0],
      ],
    ],
    [
      7,
      4,
      6,
      [
        [4, 6],
        [4, 0],
        [0, 0],
        [0, 6],
      ],
    ],
    [
      8,
      4,
      6,
      [
        [0, 6],
        [0, 0],
        [4, 0],
        [4, 6],
      ],
    ],
  ] as const)("maps all corners for orientation %s", (orientation, width, height, expected) => {
    const result = getOrientationTransform(6, 4, orientation);
    const [a, b, c, d, e, f] = result.matrix;
    const actual = [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f]);
    expect(actual).toEqual(expected);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.aspectRatio).toBe(width / height);
  });

  it("defaults to identity and accepts fractional dimensions", () => {
    expect(getOrientationTransform(1.5, 2.5)).toEqual({
      width: 1.5,
      height: 2.5,
      aspectRatio: 0.6,
      matrix: [1, 0, 0, 1, 0, 0],
    });
    expect(getOrientationTransform(2, 2, 8).aspectRatio).toBe(1);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("rejects invalid dimensions %s", (value) => {
    expect(() => getOrientationTransform(value, 4)).toThrow(RangeError);
    expect(() => getOrientationTransform(6, value)).toThrow(RangeError);
  });

  it.each([0, 9, -1, 1.5, NaN, Infinity])("rejects invalid orientation %s", (value) => {
    expect(() => getOrientationTransform(6, 4, value)).toThrow(RangeError);
  });

  it.each([
    [Number.MAX_VALUE, Number.MIN_VALUE],
    [Number.MIN_VALUE, Number.MAX_VALUE],
  ])("rejects unrepresentable aspect ratios", (width, height) =>
    expect(() => getOrientationTransform(width, height)).toThrow(RangeError));

  it("returns fresh matrices", () => {
    const first = getOrientationTransform(6, 4, 6);
    expect(getOrientationTransform(6, 4, 6).matrix).not.toBe(first.matrix);
  });
});
