// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  alignDaily,
  calendarDay,
  correlationVerdict,
  dailySeries,
  hourlyAggregation,
  insights,
  laggedCorrelation,
  mean,
  pearson,
  robustSummary,
  rollingAverage,
  type Series,
  shiftDay,
  spearman,
  weekdayAggregation,
} from "./index.js";

const sample = (at: string, value: number) => ({ at, value });
function series(id: string, n = 60, sign = 1): Series {
  return {
    id,
    label: id,
    unit: "units",
    aggregation: "mean",
    points: Array.from({ length: n }, (_, i) => sample(shiftDay("2026-01-01", i), i * sign)),
  };
}
describe("calendar alignment", () => {
  it("projects instants and preserves civil dates across midnight, leap years and DST", () => {
    expect(calendarDay("2026-01-02T01:00:00Z", "America/Los_Angeles")).toBe("2026-01-01");
    expect(calendarDay(new Date("2026-03-29T23:30:00Z"), "Europe/London")).toBe("2026-03-30");
    expect(calendarDay(Date.parse("2026-10-25T01:30:00Z"), "Europe/London")).toBe("2026-10-25");
    expect(calendarDay("2024-02-29", "Pacific/Honolulu")).toBe("2024-02-29");
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDay("2026-03-29", -1)).toBe("2026-03-28");
    expect(calendarDay("2026-02-02T01:00:00+02:00", "UTC")).toBe("2026-02-01");
  });
  it.each([
    "bad",
    "2026-02-30",
    "2026-13-01",
    "2026-01-01T12:00:00",
    "2026-02-30T12:00:00Z",
    "2026-01-01T24:00:00Z",
    "Jan 1 2026Z",
  ])("rejects invalid or ambiguous dates %s", (at) =>
    expect(() => calendarDay(at, "UTC")).toThrow(RangeError));
  it("rejects invalid zones and offsets", () => {
    expect(() => calendarDay("2026-01-01", "Moon/Sea")).toThrow();
    expect(() => shiftDay("bad", 1)).toThrow();
    expect(() => shiftDay("2026-02-30", 1)).toThrow();
    expect(() => shiftDay("2026-01-01", 0.5)).toThrow();
    expect(() => dailySeries([], "bad zone", "sum")).toThrow();
  });
  it("aggregates unsorted duplicates, zero and negative values without mutating input", () => {
    const points = [
      sample("2026-01-01T23:00:00Z", 4),
      sample("2026-01-01T12:00:00Z", 0),
      sample("2026-01-01T13:00:00Z", -2),
      sample("2026-01-02", Number.NaN),
    ];
    const copy = structuredClone(points);
    expect(dailySeries(points, "UTC", "sum")).toEqual([{ day: "2026-01-01", value: 2, count: 3 }]);
    expect(dailySeries(points, "UTC", "mean")[0]?.value).toBeCloseTo(2 / 3);
    expect(dailySeries(points, "UTC", "last")[0]?.value).toBe(4);
    expect(points).toEqual(copy);
    expect(dailySeries([], "UTC", "last")).toEqual([]);
  });
  it("joins by day and explicitly distinguishes omitted, null and zero-filled gaps", () => {
    const x = [sample("2026-01-01", 0), sample("2026-01-04", 4)];
    const y = [sample("2026-01-01", 1), sample("2026-01-03", 3)];
    expect(alignDaily(x, y, { timeZone: "UTC" })).toEqual([{ day: "2026-01-01", x: 0, y: 1 }]);
    expect(alignDaily(x, y, { timeZone: "UTC", missing: "null" })).toEqual([
      { day: "2026-01-01", x: 0, y: 1 },
      { day: "2026-01-02", x: null, y: null },
      { day: "2026-01-03", x: null, y: 3 },
      { day: "2026-01-04", x: 4, y: null },
    ]);
    expect(alignDaily(x, y, { timeZone: "UTC", missing: "zero" })[1]).toEqual({
      day: "2026-01-02",
      x: 0,
      y: 0,
    });
    expect(alignDaily([], [], { timeZone: "UTC" })).toEqual([]);
    expect(() => alignDaily(x, y, { timeZone: "UTC", lagDays: 0.5 })).toThrow();
    expect(() => alignDaily(x, y, { timeZone: "UTC", lagDays: 366 })).toThrow();
    expect(() =>
      alignDaily([sample("1900-01-01", 1)], [sample("2026-01-01", 2)], { timeZone: "UTC" }),
    ).toThrow();
  });
  it("lags calendar days rather than 24-hour durations across DST in both directions", () => {
    const x = [sample("2026-03-28T23:30:00Z", 2)];
    const y = [sample("2026-03-29T22:30:00Z", 6)];
    expect(
      alignDaily(x, y, {
        timeZone: "Europe/London",
        lagDays: 1,
        xAggregation: "sum",
        yAggregation: "last",
      }),
    ).toEqual([{ day: "2026-03-28", x: 2, y: 6 }]);
    expect(alignDaily(y, x, { timeZone: "Europe/London", lagDays: -1 })).toEqual([
      { day: "2026-03-29", x: 6, y: 2 },
    ]);
  });
});
describe("time patterns", () => {
  it("averages observed days Monday-first and leaves unobserved weekdays null", () => {
    const result = weekdayAggregation([
      { day: "2026-01-05", value: 0, count: 1 },
      { day: "2026-01-12", value: 10, count: 1 },
      { day: "2026-01-06", value: null, count: 0 },
      { day: "2026-01-07", value: Number.NaN, count: 1 },
    ]);
    expect(result[0]).toEqual({ id: "1", label: "Monday", n: 2, value: 5 });
    expect(result[1]?.value).toBeNull();
    expect(result[6]?.label).toBe("Sunday");
    expect(weekdayAggregation([]).every((b) => b.value === null)).toBe(true);
  });
  it("bins actual local hours, includes midnight and combines repeated DST hours", () => {
    const points = [
      sample("2026-10-25T01:30:00Z", 4),
      sample("2026-10-25T00:30:00Z", 2),
      sample("2026-10-25T00:45:00Z", Number.NaN),
      sample("2026-10-25", 50),
    ];
    expect(hourlyAggregation(points, "Europe/London")[1]).toEqual({
      id: "1",
      label: "01:00",
      value: 3,
      n: 2,
    });
    expect(hourlyAggregation(points, "Europe/London", "sum")[1]?.value).toBe(6);
    expect(hourlyAggregation(points, "Europe/London", "last")[1]?.value).toBe(4);
    expect(hourlyAggregation([sample("2026-01-01T00:00:00Z", 0)], "UTC")[0]?.value).toBe(0);
    expect(hourlyAggregation([], "UTC")[2]?.value).toBeNull();
  });
  it("uses calendar windows with minimum sample counts and fills interior missing days", () => {
    const points = [
      { day: "2026-01-01", value: 2, count: 1 },
      { day: "2026-01-03", value: 4, count: 1 },
      { day: "2026-01-04", value: null, count: 0 },
      { day: "2026-01-05", value: Number.NaN, count: 1 },
    ];
    const result = rollingAverage(points, 3, 2);
    expect(result[0]).toEqual({ day: "2026-01-01", value: null, count: 1 });
    expect(result[1]?.value).toBeNull();
    expect(result[2]?.value).toBe(3);
    expect(result[3]?.value).toBeNull();
    expect(rollingAverage(points, 3)[2]?.value).toBeNull();
    expect(rollingAverage([], 30)).toEqual([]);
    expect(() =>
      rollingAverage(
        [
          { day: "1900-01-01", value: 1, count: 1 },
          { day: "2026-01-01", value: 1, count: 1 },
        ],
        2,
      ),
    ).toThrow();
  });
  it.each([
    [0, 0],
    [1.5, 1],
    [10001, 1],
    [3, 0],
    [3, 4],
    [3, 1.5],
  ])("rejects invalid rolling parameters %s/%s", (window, minimum) =>
    expect(() => rollingAverage([], window, minimum)).toThrow());
});
describe("robust statistics and correlations", () => {
  it("uses interpolated quartiles and reports Tukey outliers without deleting them", () => {
    expect(robustSummary([1, 2, 3, 4, 100, Number.NaN])).toEqual({
      n: 5,
      median: 3,
      q1: 2,
      q3: 4,
      iqr: 2,
      outliers: [100],
    });
    expect(robustSummary([1, 2, 3, 4]).median).toBe(2.5);
    expect(robustSummary([-Number.MAX_VALUE, Number.MAX_VALUE]).median).toBe(0);
    expect(robustSummary([7])).toEqual({ n: 1, median: 7, q1: 7, q3: 7, iqr: 0, outliers: [] });
    expect(robustSummary([])).toEqual({
      n: 0,
      median: null,
      q1: null,
      q3: null,
      iqr: null,
      outliers: [],
    });
    expect(mean([1, 3, Number.POSITIVE_INFINITY])).toBe(2);
    expect(mean([])).toBeNull();
    expect(robustSummary([-100, 1, 2, 3, 4]).outliers).toEqual([-100]);
  });
  it.each([
    [0, "negligible"],
    [0.2, "weak"],
    [0.5, "moderate"],
    [0.9, "strong"],
    [-0.8, "strong"],
  ] as const)("labels Pearson strength r=%s", (r, strength) => {
    const x = [-2, -1, 0, 1, 2];
    const z = [1, -2, 2, -2, 1];
    const y = x.map(
      (v, i) => (r * v) / Math.sqrt(10) + (Math.sqrt(1 - r * r) * (z[i] as number)) / Math.sqrt(14),
    );
    expect(pearson(x, y).coefficient).toBeCloseTo(r);
    expect(
      pearson(
        x.map((v) => v * 1e-100),
        y.map((v) => v * 1e-100),
      ).coefficient,
    ).toBeCloseTo(r);
    expect(pearson(x, y).strength).toBe(strength);
  });
  it("handles missing pairs, constant values, ties and large offsets", () => {
    expect(pearson([1, 2, Number.NaN, 4], [2, 4, 6, Number.NaN])).toMatchObject({
      n: 2,
      coefficient: expect.closeTo(1),
      strength: "strong",
    });
    expect(pearson([], [])).toEqual({ n: 0, coefficient: null, strength: "insufficient data" });
    expect(pearson([1], [2]).n).toBe(1);
    expect(pearson([1, 1, 1], [1, 2, 3]).strength).toBe("no variation");
    expect(pearson([1, 2, 3], [2, 2, 2]).coefficient).toBeNull();
    expect(pearson([1e300, 2e300, 3e300], [3e300, 2e300, 1e300]).coefficient).toBeCloseTo(-1);
    expect(() => pearson([1], [])).toThrow();
    expect(() => spearman([1], [])).toThrow();
    expect(spearman([1, 2, 2, 4, Number.NaN], [1, 3, 3, 9, 4]).coefficient).toBeCloseTo(1);
    expect(spearman([1, 2, 3], [9, 4, 1]).coefficient).toBeCloseTo(-1);
    expect(spearman([], []).n).toBe(0);
  });
});
describe("findings", () => {
  it("provides a signed calendar lag with sample size and rank correlation", () => {
    const result = laggedCorrelation(series("walk"), series("sleep"), "UTC", 1);
    expect(result.pearson.n).toBe(59);
    expect(result.pairs[0]).toEqual({ day: "2026-01-01", x: 0, y: 1 });
    expect(laggedCorrelation(series("walk"), series("sleep"), "UTC").pearson.n).toBe(60);
  });
  it.each([
    [14, "low"],
    [30, "moderate"],
    [60, "high"],
  ] as const)("requires sufficient data and describes n=%s", (n, confidence) => {
    const found = insights([series("Steps", n), series("Sleep", n)], {
      timeZone: "UTC",
      lags: [0, 0],
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.confidence).toBe(confidence);
    expect(found[0]?.description).toContain(`n=${n}, strong`);
    expect(found[0]?.description).toContain("more than on other observed days");
  });
  it("ranks deterministically, limits results, supports negative relationships and lags", () => {
    const input = [series("A"), series("B", 60, -1), series("C")];
    const result = insights(input, { timeZone: "UTC" });
    expect(result.length).toBeGreaterThan(1);
    expect(result.some((f) => f.description.includes("less than"))).toBe(true);
    expect(result.every((f) => f.lagDays === 0)).toBe(true);
    expect(insights(input, { timeZone: "UTC", lags: [1] })[0]?.description).toContain(
      "1 day later",
    );
    expect(
      insights(input, { timeZone: "UTC", lags: [-2, -1], limit: 1 })[0]?.description,
    ).toContain("earlier");
    expect(
      insights(input, { timeZone: "UTC", lags: [-2] }).some((f) =>
        f.description.includes("2 days earlier"),
      ),
    ).toBe(true);
    expect(insights(input, { timeZone: "UTC", limit: 0 })).toEqual([]);
    expect(insights(input, { timeZone: "UTC" })).toEqual(result);
  });
  it("rejects short, constant, unbalanced and outlier-driven candidate pairs", () => {
    expect(insights([series("A", 13), series("B", 13)], { timeZone: "UTC" })).toEqual([]);
    const constant = {
      ...series("C"),
      points: series("C").points.map((p) => ({ ...p, value: 1 })),
    };
    expect(insights([series("A"), constant], { timeZone: "UTC" })).toEqual([]);
    const unbalanced = {
      ...series("U"),
      points: series("U").points.map((p, i) => ({ ...p, value: i < 58 ? 0 : 1 })),
    };
    expect(insights([unbalanced, series("A")], { timeZone: "UTC", lags: [0] })).toEqual([]);
    const outlier = {
      ...series("O", 20),
      points: series("O", 20).points.map((p, i) => ({ ...p, value: i === 19 ? 5000 : -i })),
    };
    expect(insights([series("A", 20), outlier], { timeZone: "UTC", lags: [0] })).toEqual([]);
    const noise = {
      ...series("N"),
      points: series("N").points.map((p, i) => ({ ...p, value: i % 2 })),
    };
    expect(insights([series("A"), noise], { timeZone: "UTC", lags: [0] })).toEqual([]);
    expect(insights([], { timeZone: "UTC" })).toEqual([]);
  });
  it("uses cautious, non-causal verdicts with a hard 14-day floor", () => {
    expect(correlationVerdict({ n: 13, coefficient: 1, strength: "strong" })).toContain(
      "at least 14",
    );
    expect(correlationVerdict({ n: 14, coefficient: null, strength: "no variation" })).toContain(
      "do not vary",
    );
    expect(correlationVerdict({ n: 14, coefficient: 0.2, strength: "weak" })).toContain(
      "no clear relationship",
    );
    expect(correlationVerdict({ n: 14, coefficient: 0.5, strength: "moderate" })).toContain(
      "positive",
    );
    expect(correlationVerdict({ n: 14, coefficient: -0.5, strength: "moderate" })).toContain(
      "negative",
    );
  });
});
