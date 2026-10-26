// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  classifyTrend,
  type DailyTotal,
  type DateRange,
  dailyGoalProgress,
  type GoalContext,
  type HealthMetric,
  type HealthSeries,
  HealthTrendsError,
  type HealthTrendsErrorCode,
  personalBests,
  rollingAverages,
} from "../src/apps/health/lib/trends";

// Entirely synthetic daily totals, with no personal or clinical records.
const total = (date: string, value: number): DailyTotal => ({
  timestamp: Date.parse(`${date}T12:00:00Z`),
  value,
});
const series = (
  totals: readonly DailyTotal[] = [],
  metric: HealthMetric = "steps",
  timeZone = "UTC",
): HealthSeries => ({ metric, timeZone, totals });
const context = (at = "2024-03-11T23:00:00Z"): GoalContext => ({ clock: () => Date.parse(at) });
const code = (action: () => unknown, expected: HealthTrendsErrorCode = "invalid-input") => {
  expect(action).toThrow(HealthTrendsError);
  expect(action).toThrow(expect.objectContaining({ name: "HealthTrendsError", code: expected }));
};

describe("daily health goals", () => {
  it.each<HealthMetric>([
    "steps",
    "sleepMinutes",
    "activeMinutes",
  ])("tracks %s progress, exact achievement and overachievement without mutation", (metric) => {
    const totals = Object.freeze([
      Object.freeze(total("2024-03-11", 15)),
      Object.freeze(total("2024-03-09", 10)),
      Object.freeze(total("2024-03-10", 10)),
    ]);
    const clock = vi.fn(() => Date.parse("2024-03-11T23:00:00Z"));
    expect(dailyGoalProgress(series(totals, metric), 10, { clock })).toEqual({
      date: "2024-03-11",
      value: 15,
      target: 10,
      ratio: 1.5,
      achieved: true,
      currentStreak: 3,
      longestStreak: 3,
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(dailyGoalProgress(series([total("2024-03-11", 10)], metric), 10, context()).ratio).toBe(
      1,
    );
    expect(totals[0]?.value).toBe(15);
  });

  it("distinguishes missing and zero today; allows today to remain unfinished", () => {
    expect(dailyGoalProgress(series(), 10, context())).toEqual({
      date: "2024-03-11",
      value: null,
      target: 10,
      ratio: null,
      achieved: false,
      currentStreak: 0,
      longestStreak: 0,
    });
    const history = [total("2024-03-09", 10), total("2024-03-10", 10)];
    expect(dailyGoalProgress(series(history), 10, context())).toMatchObject({
      value: null,
      ratio: null,
      currentStreak: 2,
      longestStreak: 2,
    });
    expect(
      dailyGoalProgress(series([...history, total("2024-03-11", 0)]), 10, context()),
    ).toMatchObject({
      value: 0,
      ratio: 0,
      achieved: false,
      currentStreak: 2,
      longestStreak: 2,
    });
    expect(dailyGoalProgress(series([total("2024-03-11", 5)]), 10, context())).toMatchObject({
      ratio: 0.5,
      currentStreak: 0,
    });
  });

  it("breaks at missed/missing completed days and reports the longest historical run", () => {
    const history = [
      total("2024-03-01", 10),
      total("2024-03-02", 10),
      total("2024-03-03", 10),
      total("2024-03-04", 9),
      total("2024-03-05", 10),
      total("2024-03-07", 10),
    ];
    expect(dailyGoalProgress(series(history), 10, context())).toMatchObject({
      currentStreak: 0,
      longestStreak: 3,
    });
    expect(
      dailyGoalProgress(series([...history, total("2024-03-11", 10)]), 10, context()),
    ).toMatchObject({ currentStreak: 1, longestStreak: 3 });
    expect(
      dailyGoalProgress(series([total("2024-03-09", 0), total("2024-03-10", 10)]), 10, context()),
    ).toMatchObject({ currentStreak: 1, longestStreak: 1 });
    expect(dailyGoalProgress(series([total("2024-03-10", 0)]), 10, context()).currentStreak).toBe(
      0,
    );
  });

  it.each([
    ["2024-03-09T17:00:00Z", "2024-03-10T16:00:00Z", "2024-03-11T04:00:00Z", "2024-03-11"],
    ["2024-11-02T16:00:00Z", "2024-11-03T17:00:00Z", "2024-11-04T05:00:00Z", "2024-11-04"],
  ])("keeps streaks through short/long DST days", (a, b, now, date) => {
    const totals = [a, b].map((at) => ({ timestamp: Date.parse(at), value: 10 }));
    expect(
      dailyGoalProgress(series(totals, "steps", "America/New_York"), 10, context(now)),
    ).toMatchObject({ date, currentStreak: 2 });
  });

  it("uses the injected local day across year/leap boundaries and offset timezones", () => {
    expect(
      dailyGoalProgress(
        series([total("2023-12-31", 10), total("2024-01-01", 10)]),
        10,
        context("2024-01-02T00:00:00Z"),
      ).currentStreak,
    ).toBe(2);
    expect(
      dailyGoalProgress(
        series([total("2024-02-28", 10), total("2024-02-29", 10)]),
        10,
        context("2024-03-01T00:00:00Z"),
      ).currentStreak,
    ).toBe(2);
    expect(
      dailyGoalProgress(series([], "steps", "Asia/Kathmandu"), 10, context("2024-03-11T18:15:00Z"))
        .date,
    ).toBe("2024-03-12");
    expect(
      dailyGoalProgress(
        series([], "steps", "America/Los_Angeles"),
        10,
        context("2024-03-11T00:00:00Z"),
      ).date,
    ).toBe("2024-03-10");
    expect(dailyGoalProgress(series(), 10, context("0001-01-01T00:00:00Z")).currentStreak).toBe(0);
  });

  it("keeps a skipped civil date as a streak gap", () => {
    const totals = ["2011-12-29T22:00:00Z", "2011-12-30T22:00:00Z"].map((at) => ({
      timestamp: Date.parse(at),
      value: 10,
    }));
    expect(
      dailyGoalProgress(
        series(totals, "steps", "Pacific/Apia"),
        10,
        context("2011-12-31T00:00:00Z"),
      ),
    ).toMatchObject({ currentStreak: 1, longestStreak: 1 });
  });

  it("supports fractional minutes and rejects unusable targets, clocks, future data and overflow", () => {
    expect(
      dailyGoalProgress(series([total("2024-03-11", 30.5)], "activeMinutes"), 30.5, context())
        .achieved,
    ).toBe(true);
    for (const target of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
      code(() => dailyGoalProgress(series(), target, context()));
    for (const bad of [undefined, null, {}, { clock: 0 }])
      code(() => dailyGoalProgress(series(), 10, bad as GoalContext));
    for (const at of [NaN, Infinity, 0.5, Date.parse("0000-01-01T00:00:00Z")])
      code(() => dailyGoalProgress(series(), 10, { clock: () => at }), "invalid-clock");
    code(
      () =>
        dailyGoalProgress(series(), 10, {
          clock: () => {
            throw new Error("synthetic failure");
          },
        }),
      "invalid-clock",
    );
    code(
      () => dailyGoalProgress(series([total("2024-03-12", 10)]), 10, context()),
      "future-observation",
    );
    code(
      () =>
        dailyGoalProgress(series([total("2024-03-11", 10)]), 10, context("2024-03-11T11:59:59Z")),
      "future-observation",
    );
    code(
      () =>
        dailyGoalProgress(
          series([total("2024-03-11", 10)], "sleepMinutes"),
          Number.MIN_VALUE,
          context(),
        ),
      "arithmetic-overflow",
    );
  });
});

describe("calendar rolling averages", () => {
  const totals = Array.from({ length: 61 }, (_, i) => ({
    timestamp: Date.parse("2024-02-01T12:00:00Z") + i * 86_400_000,
    value: i,
  }));
  it("calculates independent full 7/30-day windows including history before the range", () => {
    const result = rollingAverages(series(Object.freeze(totals)), {
      start: "2024-02-01",
      end: "2024-03-01",
    });
    expect(result[0]).toEqual({ date: "2024-02-01", value: 0, average7: null, average30: null });
    expect(result[5]?.average7).toBeNull();
    expect(result[6]?.average7).toBeCloseTo(3);
    expect(result[28]?.average30).toBeNull();
    expect(result[29]).toMatchObject({ date: "2024-03-01", value: 29 });
    expect(result[29]?.average7).toBeCloseTo(26);
    expect(result[29]?.average30).toBeCloseTo(14.5);
    expect(rollingAverages(series(totals), { start: "2024-03-01", end: "2024-03-01" })).toEqual([
      result[29],
    ]);
  });

  it("propagates leading/internal/trailing gaps and resumes only after complete windows", () => {
    const gapped = totals.filter((_, i) => i !== 30);
    const result = rollingAverages(series(gapped), { start: "2024-03-02", end: "2024-04-01" });
    expect(result[0]).toEqual({ date: "2024-03-02", value: null, average7: null, average30: null });
    expect(result[6]?.average7).toBeNull();
    expect(result[7]?.average7).toBeCloseTo(34);
    expect(result[29]?.average30).toBeNull();
    expect(result[30]?.average30).toBeCloseTo(45.5);
    expect(rollingAverages(series(), { start: "2023-12-31", end: "2024-01-01" })).toEqual([
      { date: "2023-12-31", value: null, average7: null, average30: null },
      { date: "2024-01-01", value: null, average7: null, average30: null },
    ]);
  });

  it("counts DST days by calendar, preserves zero, fractional minutes and boundary years", () => {
    const readings = Array.from({ length: 7 }, (_, i) =>
      total(`2024-03-${String(i + 5).padStart(2, "0")}`, 0.5),
    );
    expect(
      rollingAverages(series(readings, "sleepMinutes", "America/New_York"), {
        start: "2024-03-11",
        end: "2024-03-11",
      })[0]?.average7,
    ).toBeCloseTo(0.5);
    expect(
      rollingAverages(series(readings.map((t) => ({ ...t, value: 0 }))), {
        start: "2024-03-11",
        end: "2024-03-11",
      })[0]?.average7,
    ).toBe(0);
    for (const date of ["0001-01-01", "9999-12-31"])
      expect(rollingAverages(series(), { start: date, end: date })).toEqual([
        { date, value: null, average7: null, average30: null },
      ]);
  });

  it("rejects malformed, impossible, reversed and unsupported date ranges", () => {
    for (const range of [
      null,
      undefined,
      {},
      { start: 42, end: "2024-03-01" },
      ...[
        "bad",
        "2023-02-29",
        "2024-02-30",
        "2024-13-01",
        "2024-00-01",
        "2024-2-01",
        "0000-01-01",
        "+010000-01-01",
      ].map((start) => ({ start, end: "2024-03-01" })),
      { start: "2024-03-02", end: "2024-03-01" },
      { start: "2024-03-01", end: "bad" },
    ])
      code(() => rollingAverages(series(), range as DateRange));
  });
});

describe("least-squares trends and personal records", () => {
  it("uses calendar-day distances, sorted immutable input and explicit absolute thresholds", () => {
    const input = series(Object.freeze([total("2024-01-11", 30), total("2024-01-01", 10)]));
    expect(classifyTrend(input, 1)).toEqual({ classification: "up", slope: 2, count: 2 });
    expect(classifyTrend(input, 2).classification).toBe("flat");
    expect(classifyTrend(input, 3).classification).toBe("flat");
    const decreasing = series([total("2024-01-01", 30), total("2024-01-11", 10)]);
    expect(classifyTrend(decreasing, 1)).toEqual({ classification: "down", slope: -2, count: 2 });
    expect(classifyTrend(decreasing, 2).classification).toBe("flat");
    expect(classifyTrend(series([total("2024-01-01", 10), total("2024-01-02", 10)]), 0)).toEqual({
      classification: "flat",
      slope: 0,
      count: 2,
    });
  });

  it("fits noisy points by least squares, with gaps and no clinical interpretation", () => {
    const input = series([total("2024-02-28", 1), total("2024-02-29", 4), total("2024-03-02", 2)]);
    // x=[0,1,3], y=[1,4,2]: covariance=2/3, variance=14/3, slope=1/7.
    expect(classifyTrend(input, 0).slope).toBeCloseTo(1 / 7);
    expect(classifyTrend(input, 0.2).classification).toBe("flat");
    const dst = series(
      [total("2024-03-09", 10), total("2024-03-11", 12)],
      "steps",
      "America/New_York",
    );
    expect(classifyTrend(dst, 0).slope).toBe(1);
    expect(classifyTrend(series(), 0)).toEqual({ classification: null, slope: null, count: 0 });
    expect(classifyTrend(series([total("2024-01-01", 0)]), 0)).toEqual({
      classification: null,
      slope: null,
      count: 1,
    });
    for (const threshold of [-1, NaN, Infinity, "1"])
      code(() => classifyTrend(series(), threshold as number));
  });

  it("finds strict record highs, including an initial zero, with ties and lower days excluded", () => {
    expect(personalBests(series())).toEqual([]);
    const input = Object.freeze([
      Object.freeze(total("2024-01-05", 11)),
      Object.freeze(total("2024-01-01", 0)),
      Object.freeze(total("2024-01-02", 10)),
      Object.freeze(total("2024-01-03", 10)),
      Object.freeze(total("2024-01-04", 9)),
    ] as const);
    expect(personalBests(series(input))).toEqual(
      [input[1], input[2], input[0]].map((t) => ({
        ...t,
        date: new Date(t.timestamp).toISOString().slice(0, 10),
      })),
    );
    const records = personalBests(series(input));
    records[0] = { date: "2024-01-01", timestamp: 0, value: 100 };
    expect(input[1]?.value).toBe(0);
    expect(
      personalBests(series([total("2024-01-01", 0.5), total("2024-01-03", 0.75)], "sleepMinutes")),
    ).toHaveLength(2);
  });

  it("preserves small changes on a large baseline and keeps constant fractional totals flat", () => {
    const readings = ["2024-01-01", "2024-01-02", "2024-01-05"];
    const constant = series(
      readings.map((date) => total(date, 0.1)),
      "sleepMinutes",
    );
    expect(classifyTrend(constant, 0)).toEqual({ classification: "flat", slope: 0, count: 3 });
    const baseline = Number.MAX_SAFE_INTEGER - 10;
    const rising = series([
      total("2024-01-01", baseline),
      total("2024-01-02", baseline + 1),
      total("2024-01-05", baseline + 4),
    ]);
    expect(classifyTrend(rising, 0).slope).toBeCloseTo(1);
    expect(
      dailyGoalProgress(
        series([total("2024-03-11", Number.MAX_SAFE_INTEGER)]),
        Number.MAX_SAFE_INTEGER,
        context(),
      ).ratio,
    ).toBe(1);
  });
});

describe("fail-closed shared input validation", () => {
  const actions = [
    (input: HealthSeries) => dailyGoalProgress(input, 10, context()),
    (input: HealthSeries) => rollingAverages(input, { start: "2024-03-01", end: "2024-03-11" }),
    (input: HealthSeries) => classifyTrend(input, 0),
    personalBests,
  ];

  it("rejects malformed shapes, unknown metrics/timezones, invalid timestamps and totals in every API", () => {
    const invalid = [
      null,
      undefined,
      {},
      { ...series(), totals: null },
      { ...series(), totals: [null] },
      { ...series(), totals: [undefined] },
      { ...series(), metric: "weight" },
      ...[undefined, "", "Fictional/Zone"].map((timeZone) => ({ ...series(), timeZone })),
      ...[NaN, Infinity, -Infinity, -1, 0.5, "10", Number.MAX_SAFE_INTEGER + 1].map((value) =>
        series([{ timestamp: 0, value } as DailyTotal]),
      ),
      ...[
        NaN,
        Infinity,
        0.5,
        "2024-01-01",
        Number.MAX_SAFE_INTEGER,
        Date.parse("0000-01-01T00:00:00Z"),
        Date.parse("+010000-01-01T00:00:00Z"),
      ].map((timestamp) => series([{ timestamp, value: 10 } as DailyTotal])),
    ];
    for (const action of actions)
      for (const input of invalid) code(() => action(input as HealthSeries));
  });

  it("rejects duplicates by local day, including repeated DST hours, through every API", () => {
    const duplicate = series(
      [
        { timestamp: Date.parse("2024-11-03T05:30:00Z"), value: 10 },
        { timestamp: Date.parse("2024-11-03T06:30:00Z"), value: 20 },
      ],
      "steps",
      "America/New_York",
    );
    for (const action of actions) code(() => action(duplicate), "duplicate-day");
    expect(
      personalBests(
        series(
          [
            { timestamp: Date.parse("2024-03-11T03:59:59Z"), value: 10 },
            { timestamp: Date.parse("2024-03-11T04:00:00Z"), value: 20 },
          ],
          "steps",
          "America/New_York",
        ),
      ),
    ).toHaveLength(2);
  });
});
