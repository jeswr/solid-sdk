// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it, vi } from "vitest";
import {
  alignDailyPoints,
  calendarDay,
  dailySeries,
  insights,
  pearson,
  type Series,
  shiftDay,
} from "./index.js";

const sequence = (id: string, offset = 0): Series => ({
  id,
  label: id,
  unit: "units",
  aggregation: "mean",
  points: Array.from({ length: 90 }, (_, i) => ({
    at: shiftDay("2026-01-01", i + offset),
    value: ((i * 17) % 31) + (i % 7) ** 2,
  })),
});
describe("analysis regression coverage", () => {
  it("caches the calendar formatter per time zone across callers", () => {
    const formatterSpy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      for (let i = 0; i < 10; i++) calendarDay(0, "Africa/Abidjan");
      dailySeries([{ at: 0, value: 1 }], "Africa/Abidjan", "sum");
      expect(new Set(formatterSpy.mock.contexts).size).toBe(1);
      calendarDay(0, "Pacific/Marquesas");
      expect(new Set(formatterSpy.mock.contexts).size).toBe(2);
    } finally {
      formatterSpy.mockRestore();
    }
  });
  it("aligns prepared days with the default lag and missing policy", () => {
    expect(
      alignDailyPoints(
        [{ day: "2026-01-01", value: 1, count: 1 }],
        [{ day: "2026-01-01", value: 2, count: 1 }],
      ),
    ).toEqual([{ day: "2026-01-01", x: 1, y: 2 }]);
  });
  it("discovers both lag directions independently of series ordering", () => {
    const x = sequence("Steps"),
      y = sequence("Sleep", 1);
    const forward = insights([x, y], { timeZone: "UTC" }).find((f) => f.lagDays === 1);
    const reverse = insights([y, x], { timeZone: "UTC" }).find((f) => f.lagDays === -1);
    expect(forward?.correlation).toEqual(reverse?.correlation);
    expect(forward?.correlation.coefficient).toBeCloseTo(1);
    expect(forward?.correlation.n).toBe(90);
  });
  it("keeps only the highest-ranked lag per unordered pair before limiting findings", () => {
    const trend = (id: string, sign = 1): Series => ({
      ...sequence(id),
      points: sequence(id).points.map((point, i) => ({ ...point, value: sign * i })),
    });
    const input = [trend("Steps"), trend("Sleep", -1), trend("Music")];
    const result = insights(input, { timeZone: "UTC", limit: 6 });
    expect(result).toHaveLength(3);
    expect(new Set(result.map((f) => JSON.stringify([f.xId, f.yId].sort()))).size).toBe(3);
    expect(result.every((f) => f.lagDays === 0 && f.correlation.n === 90)).toBe(true);
    expect(insights(input, { timeZone: "UTC", lags: [1, 0, -1], limit: 6 })).toEqual(result);
    const tied = insights(input.slice(0, 2), { timeZone: "UTC", lags: [1, -1] });
    expect(tied).toHaveLength(1);
    expect(tied[0]?.lagDays).toBe(-1);
    expect(insights(input.slice(0, 2), { timeZone: "UTC", lags: [-1, 1] })).toEqual(tied);

    const x = sequence("Walk"),
      y = sequence("Rest", 1);
    const forward = insights([x, y], { timeZone: "UTC" });
    const reverse = insights([y, x], { timeZone: "UTC" });
    expect(forward).toHaveLength(1);
    expect(reverse).toHaveLength(1);
    expect(forward[0]?.lagDays).toBe(1);
    expect(reverse[0]?.lagDays).toBe(-1);
  });
  it("leaves room for weaker pairs when a strong autocorrelated pair leads every lag", () => {
    const trend = (id: string, noise = 0): Series => ({
      ...sequence(id),
      points: sequence(id).points.map((point, i) => ({ ...point, value: i + (i % 2) * noise })),
    });
    const result = insights([trend("Steps"), trend("Sleep"), trend("Music", 30)], {
      timeZone: "UTC",
      limit: 2,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ xId: "Steps", yId: "Sleep", lagDays: 0 });
    expect(result[1]?.yId).toBe("Music");
  });
  it("sentence-cases labels while preserving currency codes and initialisms", () => {
    const result = insights(
      [{ ...sequence("Spending (GBP)"), unit: "GBP" }, sequence("GBP balance")],
      { timeZone: "UTC", lags: [0] },
    );
    expect(result[0]?.description).toContain("spending (GBP)");
    expect(result[0]?.description).toContain("GBP balance");
    expect(result[0]?.description).not.toContain("gbp");
  });
  it("rejects relative floating-point noise without suppressing real variation or small units", () => {
    const tinyVariation = [1e12, 1e12 + 0.1, 1e12 - 0.1];
    expect(pearson(tinyVariation, [1, 2, 3]).strength).toBe("no variation");
    expect(pearson([1, 2, 3], [1, 1 + 1e-8, 1 - 1e-8]).coefficient).toBeNull();
    expect(pearson([0, 0, 0], [1, 2, 3]).coefficient).toBeNull();
    expect(pearson([1, 2, 3], [0, 0, 0]).coefficient).toBeNull();
    expect(pearson([1e-100, 2e-100, 3e-100], [3, 2, 1]).coefficient).toBeCloseTo(-1);
    expect(pearson([1e12, 2e12, 3e12], [1, 2, 3]).coefficient).toBeCloseTo(1);
  });
  // A loose wall-clock guard: shared CI runners vary too much for a tight budget, but a
  // quadratic regression on 100,000 observations would still blow far past it.
  it("analyses over 100,000 raw observations across multiple pairs and lags without a quadratic blow-up", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const raw = {
      ...sequence("Heart rate"),
      points: Array.from({ length: 100_001 }, (_, i) => ({
        at: start + i * 100_000,
        value: 60 + (i % 120),
      })),
    };
    const input = [
      raw,
      sequence("Steps"),
      sequence("Sleep"),
      sequence("Music"),
      sequence("Spending"),
    ];
    const before = performance.now();
    const result = insights(input, { timeZone: "Europe/London" });
    expect(performance.now() - before).toBeLessThan(10_000);
    expect(result.length).toBeGreaterThan(0);
  });
});
