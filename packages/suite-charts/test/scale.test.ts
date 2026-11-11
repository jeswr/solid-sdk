// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { leastSquares, linearScale, niceTicks, pearson, timeScale, toTime } from "../src/scale.js";

describe("linearScale", () => {
  it("maps endpoints, interpolates and extrapolates", () => {
    const scale = linearScale([0, 10], [20, 120]);
    expect([scale(0), scale(5), scale(10), scale(-1)]).toEqual([20, 70, 120, 10]);
  });
  it("supports reversed and negative domains and reversed ranges", () => {
    expect(linearScale([10, -10], [100, 0])(0)).toBe(50);
    expect(linearScale([-5, 5], [10, -10])(-5)).toBe(10);
  });
  it("centres a constant domain, including zero", () => {
    expect(linearScale([3, 3], [0, 10])(3)).toBe(5);
    expect(linearScale([0, 0], [-10, 10])(0)).toBe(0);
  });
  it("rejects nonfinite bounds and handles a very wide finite domain", () => {
    expect(() => linearScale([0, NaN], [0, 1])).toThrow(TypeError);
    expect(() => linearScale([0, 1], [0, Infinity])).toThrow(TypeError);
    expect(linearScale([-1e308, 1e308], [0, 100])(0)).toBe(50);
  });
});
describe("toTime", () => {
  it.each([
    ["2024-02-29", Date.UTC(2024, 1, 29)],
    ["2026-03-02T14:30:00+02:00", Date.UTC(2026, 2, 2, 12, 30)],
    ["2026-03-02T14:30:00-05:30", Date.UTC(2026, 2, 2, 20)],
    ["2026-03-02T14:30:00Z", Date.UTC(2026, 2, 2, 14, 30)],
    ["2026-03-02T14:30", Date.UTC(2026, 2, 2, 14, 30)],
    [new Date("2026-01-01T00:00:00Z"), Date.UTC(2026, 0, 1)],
    [42, 42],
    [0, 0],
    [-1, -1],
  ])("parses %s", (input, expected) => expect(toTime(input)).toBe(expected));
  it.each([
    "not-a-date",
    "",
    "01/02/2026",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-01-01T25:00Z",
    new Date(NaN),
  ])("rejects invalid input %s", (input) => expect(() => toTime(input)).toThrow(TypeError));
  it("leaves numeric nonfinite inputs available to the caller's data filter", () =>
    expect(toTime(NaN)).toBeNaN());
});
describe("timeScale", () => {
  it("accepts dates, timestamps, and ISO strings interchangeably", () => {
    const scale = timeScale(["2026-01-01", new Date("2026-01-03")], [0, 100]);
    expect(scale("2026-01-02")).toBe(50);
    expect(scale(Date.UTC(2026, 0, 3))).toBe(100);
    expect(scale(new Date("2026-01-01"))).toBe(0);
    expect(() => scale("wrong")).toThrow(TypeError);
  });
  it("centres a single instant and rejects invalid domain input", () => {
    expect(timeScale(["2026-01-01", "2026-01-01"], [0, 100])("2026-01-01")).toBe(50);
    expect(() => timeScale(["invalid", 0], [0, 1])).toThrow(TypeError);
  });
});
describe("niceTicks", () => {
  it.each([
    [0, 10, 6, [0, 2, 4, 6, 8, 10]],
    [0, 0.5, 6, [0, 0.1, 0.2, 0.3, 0.4, 0.5]],
    [-10, 0, 6, [-10, -8, -6, -4, -2, 0]],
    [-1, 1, 5, [-1, -0.5, 0, 0.5, 1]],
    [4, 4, 5, [4]],
    [0, 0, 5, [0]],
    [0, 10, 1, [0]],
    [0, 10, 0, []],
    [10, 0, 6, [10, 8, 6, 4, 2, 0]],
    [0.11, 0.12, 5, [0.11, 0.115, 0.12]],
    [0.1, 0.3, 3, [0.1, 0.2, 0.3]],
    [-0.3, -0.1, 3, [-0.3, -0.2, -0.1]],
    [0.3, 0.1, 3, [0.3, 0.2, 0.1]],
  ])("returns readable ticks for %s to %s (%s)", (min, max, count, expected) =>
    expect(niceTicks(min, max, count)).toEqual(expected));
  it("uses a sensible default and rejects nonfinite inputs", () => {
    expect(niceTicks(0, 10).length).toBeGreaterThan(1);
    expect(() => niceTicks(0, Infinity, 5)).toThrow(TypeError);
    expect(() => niceTicks(0, 10, NaN)).toThrow(TypeError);
  });
  it.each([
    [0.3, 0.1 + 0.2, 0.3],
    [1, 1 + 2.2e-16, 1],
    [1e20, 1e20 + 1e6, 1e20],
  ])("deduplicates rounded ticks for float noise between %s and %s", (min, max, tick) => {
    expect(niceTicks(min, max)).toEqual([tick]);
    expect(niceTicks(max, min)).toEqual([tick]);
  });
  it("remains bounded for excessive counts and extremes", () => {
    expect(niceTicks(0, 100, 1e8).length).toBeLessThanOrEqual(1001);
    expect(niceTicks(-1e308, 1e308, 5)).toEqual([-1e308, 1e308]);
    expect(niceTicks(0, Number.MIN_VALUE, 5)).toEqual([0, Number.MIN_VALUE]);
  });
});
describe("pearson", () => {
  it("finds perfect positive and negative correlation", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([-1, 0, 1], [1, 0, 1])).toBeCloseTo(0);
  });
  it("requires three observations and variance on both axes", () => {
    expect(pearson([], [])).toBeUndefined();
    expect(pearson([1, 2], [2, 3])).toBeUndefined();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeUndefined();
    expect(pearson([1, 2, 3], [2, 2, 2])).toBeUndefined();
    expect(pearson([1, NaN, 3], [1, 2, 3])).toBeUndefined();
  });
  it("throws on every length mismatch, even for short arrays", () => {
    expect(() => pearson([1], [])).toThrow(RangeError);
    expect(() => pearson([1, 2, 3], [1, 2])).toThrow(RangeError);
  });
});
describe("leastSquares", () => {
  it("fits a slope and intercept with two or more points", () => {
    expect(
      leastSquares([
        { x: 1, y: 5 },
        { x: 2, y: 8 },
        { x: 3, y: 11 },
      ]),
    ).toEqual({ slope: 3, intercept: 2 });
    expect(
      leastSquares([
        { x: -1, y: 4 },
        { x: 1, y: 0 },
      ]),
    ).toEqual({ slope: -2, intercept: 2 });
  });
  it("fits a constant y and a noisy series", () => {
    expect(
      leastSquares([
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ]),
    ).toEqual({ slope: 0, intercept: 2 });
    const fit = leastSquares([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    expect(fit?.slope).toBeCloseTo(0.5);
    expect(fit?.intercept).toBeCloseTo(2 / 3);
  });
  it("returns undefined for insufficient, nonfinite or zero-x-variance data", () => {
    expect(leastSquares([])).toBeUndefined();
    expect(leastSquares([{ x: 1, y: 1 }])).toBeUndefined();
    expect(
      leastSquares([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toBeUndefined();
    expect(
      leastSquares([
        { x: 1, y: 1 },
        { x: 2, y: Infinity },
      ]),
    ).toBeUndefined();
  });
});
