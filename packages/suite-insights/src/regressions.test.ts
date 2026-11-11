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
  it("analyses over 100,000 raw observations across multiple pairs and lags within 1500 ms", () => {
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
    expect(performance.now() - before).toBeLessThan(1500);
    expect(result.length).toBeGreaterThan(0);
  });
});
