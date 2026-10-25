// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type Aggregation,
  aggregateObservations,
  type BucketOptions,
  bucketKey,
  convertUnit,
  detectGaps,
  type HealthUnit,
  movingAverage,
  type Observation,
} from "../src/apps/health/lib/stats";

// Synthetic readings only. UTC milliseconds keep fixtures independent of the test host.
const reading = (at: string, value = 1): Observation => ({ timestamp: Date.parse(at), value });
const utc: BucketOptions = { period: "day", timeZone: "UTC" };
const ny: BucketOptions = { period: "day", timeZone: "America/New_York" };

describe("unit conversion", () => {
  it.each<[HealthUnit, HealthUnit, number, number]>([
    ["lb", "kg", 1, 0.45359237],
    ["mi", "km", 1, 1.609344],
    ["kcal", "kJ", 1, 4.184],
    ["mmol/L", "mg/dL", 5, 90],
  ])("converts %s ↔ %s without rounding", (from, to, input, output) => {
    expect(convertUnit(input, from, to)).toBeCloseTo(output, 12);
    expect(convertUnit(output, to, from)).toBeCloseTo(input, 12);
    expect(convertUnit(0, from, to)).toBe(0);
    expect(convertUnit(-input, from, to)).toBeCloseTo(-output, 12);
  });

  it.each<HealthUnit>([
    "kg",
    "lb",
    "km",
    "mi",
    "kcal",
    "kJ",
    "mmol/L",
    "mg/dL",
  ])("preserves identity and round trips for %s", (unit) => {
    expect(convertUnit(1.23456789, unit, unit)).toBe(1.23456789);
  });

  it("rejects incompatible, unknown, inherited, non-finite and overflowing values", () => {
    expect(() => convertUnit(1, "kg", "km")).toThrow(RangeError);
    expect(() => convertUnit(1, "oz" as HealthUnit, "kg")).toThrow(RangeError);
    expect(() => convertUnit(1, "kg", "constructor" as HealthUnit)).toThrow(RangeError);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => convertUnit(value, "kg", "kg")).toThrow(RangeError);
    }
    expect(() => convertUnit(Number.MAX_VALUE, "kg", "lb")).toThrow(RangeError);
  });
});

describe("timezone-aware calendar buckets", () => {
  it.each([
    ["2024-03-10T04:59:59.999Z", "2024-03-09"],
    ["2024-03-10T05:00:00.000Z", "2024-03-10"],
    ["2024-03-10T06:59:59.999Z", "2024-03-10"],
    ["2024-03-10T07:00:00.000Z", "2024-03-10"],
    ["2024-03-11T03:59:59.999Z", "2024-03-10"],
    ["2024-03-11T04:00:00.000Z", "2024-03-11"],
    ["2024-11-03T05:30:00.000Z", "2024-11-03"],
    ["2024-11-03T06:30:00.000Z", "2024-11-03"],
    ["2024-11-04T04:59:59.999Z", "2024-11-03"],
    ["2024-11-04T05:00:00.000Z", "2024-11-04"],
  ])("buckets %s around US spring/fall DST", (at, expected) => {
    expect(bucketKey(Date.parse(at), ny)).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["Europe/London", "2024-03-31T23:00:00Z", "2024-04-01"],
    ["Europe/London", "2024-10-27T23:30:00Z", "2024-10-27"],
    ["Australia/Sydney", "2024-10-06T13:00:00Z", "2024-10-07"],
    ["Australia/Lord_Howe", "2024-10-06T13:00:00Z", "2024-10-07"],
    ["Asia/Kathmandu", "2024-01-01T18:15:00Z", "2024-01-02"],
    ["America/Sao_Paulo", "2018-11-04T03:00:00Z", "2018-11-04"],
    ["Pacific/Kiritimati", "2023-12-31T10:00:00Z", "2024-01-01"],
    ["America/Los_Angeles", "2024-01-01T00:00:00Z", "2023-12-31"],
  ])("uses the calendar in %s", (timeZone, at, expected) => {
    expect(bucketKey(Date.parse(at), { ...utc, timeZone })).toBe(expected);
  });

  it("uses Gregorian months and Monday weeks, including year and leap boundaries", () => {
    expect(bucketKey(Date.parse("2021-01-01T12:00:00Z"), { ...utc, period: "week" })).toBe(
      "2020-12-28",
    );
    expect(bucketKey(Date.parse("2024-03-11T04:00:00Z"), { ...ny, period: "week" })).toBe(
      "2024-03-11",
    );
    expect(bucketKey(Date.parse("2024-03-01T04:59:59Z"), { ...ny, period: "month" })).toBe(
      "2024-02-01",
    );
    expect(bucketKey(Date.parse("2024-03-01T05:00:00Z"), { ...ny, period: "month" })).toBe(
      "2024-03-01",
    );
    expect(bucketKey(Date.parse("0099-01-02T12:00:00Z"), utc)).toBe("0099-01-02");
  });

  it("rejects invalid timestamps, timezones and periods even for empty series", () => {
    for (const at of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => bucketKey(at, utc)).toThrow(RangeError);
    }
    for (const timeZone of ["", undefined, "Fictional/Zone"]) {
      expect(() => aggregateObservations([], { ...utc, timeZone } as BucketOptions, "sum")).toThrow(
        RangeError,
      );
    }
    expect(() => bucketKey(0, { ...utc, period: "year" } as unknown as BucketOptions)).toThrow(
      RangeError,
    );
    for (const at of ["0000-01-01T00:00:00Z", "+010000-01-01T00:00:00Z"]) {
      expect(() => bucketKey(Date.parse(at), utc)).toThrow(RangeError);
    }
  });
});

describe("aggregation", () => {
  const unsorted = Object.freeze([
    Object.freeze(reading("2024-01-02T20:00:00Z", 20)),
    Object.freeze(reading("2024-01-01T20:00:00Z", -2)),
    Object.freeze(reading("2024-01-01T10:00:00Z", 0)),
    Object.freeze(reading("2024-01-01T20:00:00Z", 8)),
    Object.freeze(reading("2024-01-01T05:00:00Z", 6)),
  ]);

  it.each<[Aggregation, number]>([
    ["sum", 12],
    ["mean", 3],
    ["min", -2],
    ["max", 8],
    ["last", 8],
  ])("computes %s chronologically with stable timestamp ties and no mutation", (method, value) => {
    expect(aggregateObservations(unsorted, utc, method)).toEqual([
      { key: "2024-01-01", value, count: 4 },
      { key: "2024-01-02", value: 20, count: 1 },
    ]);
    expect(aggregateObservations([], utc, method)).toEqual([]);
  });

  it.each<[BucketOptions["period"], string, string]>([
    ["day", "2024-03-10", "2024-03-11"],
    ["week", "2024-03-04", "2024-03-11"],
    ["month", "2024-02-01", "2024-03-01"],
  ])("runs every reducer on %s buckets", (period, first, second) => {
    const at =
      period === "month"
        ? ["2024-02-28", "2024-02-29", "2024-03-01"]
        : ["2024-03-10", "2024-03-10", "2024-03-11"];
    const observations = at.map((date, i) => reading(`${date}T12:00:00Z`, i + 1));
    for (const [method, expected] of [
      ["sum", 3],
      ["mean", 1.5],
      ["min", 1],
      ["max", 2],
      ["last", 2],
    ] as const) {
      expect(aggregateObservations(observations, { ...ny, period }, method)).toEqual([
        { key: first, value: expected, count: 2 },
        { key: second, value: 3, count: 1 },
      ]);
    }
  });

  it.each([
    [
      "2024-03-10T05:00:00Z",
      "2024-03-11T03:59:59Z",
      "2024-03-11T04:00:00Z",
      "2024-03-10",
      "2024-03-11",
    ],
    [
      "2024-11-03T05:30:00Z",
      "2024-11-03T06:30:00Z",
      "2024-11-04T05:00:00Z",
      "2024-11-03",
      "2024-11-04",
    ],
  ])("groups short/long DST days and their boundary", (a, b, c, first, second) => {
    expect(aggregateObservations([reading(a, 2), reading(b, 4), reading(c, 8)], ny, "sum")).toEqual(
      [
        { key: first, value: 6, count: 2 },
        { key: second, value: 8, count: 1 },
      ],
    );
  });

  it("normalises units before aggregating and distinguishes absent buckets from zero", () => {
    const observations = [
      reading("2024-01-01T12:00:00Z", convertUnit(1, "mi", "km")),
      reading("2024-01-03T12:00:00Z", 0),
    ];
    expect(aggregateObservations(observations, utc, "sum")).toEqual([
      { key: "2024-01-01", value: 1.609344, count: 1 },
      { key: "2024-01-03", value: 0, count: 1 },
    ]);
  });

  it("rejects invalid reducer, values and overflow", () => {
    expect(() => aggregateObservations([], utc, "median" as Aggregation)).toThrow(RangeError);
    expect(() => aggregateObservations([{ timestamp: 0, value: NaN }], utc, "last")).toThrow(
      RangeError,
    );
    expect(() => aggregateObservations([{ timestamp: NaN, value: 0 }], utc, "sum")).toThrow(
      RangeError,
    );
    expect(() =>
      aggregateObservations(
        [
          { timestamp: 0, value: Number.MAX_VALUE },
          { timestamp: 0, value: Number.MAX_VALUE },
        ],
        utc,
        "sum",
      ),
    ).toThrow(RangeError);
  });
});

describe("calendar gap detection", () => {
  it("finds leading, internal and trailing gaps, with duplicates and out-of-range readings", () => {
    const observations = [
      reading("2024-03-10T06:00:00Z", 0),
      reading("2024-03-10T08:00:00Z"),
      reading("2024-03-12T12:00:00Z"),
      reading("2024-03-07T12:00:00Z"),
    ];
    expect(detectGaps(observations, ny, { start: "2024-03-09", end: "2024-03-13" })).toEqual([
      "2024-03-09",
      "2024-03-11",
      "2024-03-13",
    ]);
    expect(detectGaps([], ny, { start: "2024-11-02", end: "2024-11-04" })).toEqual([
      "2024-11-02",
      "2024-11-03",
      "2024-11-04",
    ]);
    expect(
      detectGaps([reading("2024-11-03T05:30:00Z"), reading("2024-11-03T06:30:00Z")], ny, {
        start: "2024-11-03",
        end: "2024-11-03",
      }),
    ).toEqual([]);
  });

  it("includes leap dates and handles month/year rollover", () => {
    expect(detectGaps([], utc, { start: "2024-02-28", end: "2024-03-01" })).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(
      detectGaps([], { ...utc, period: "week" }, { start: "2023-12-31", end: "2024-01-08" }),
    ).toEqual(["2023-12-25", "2024-01-01", "2024-01-08"]);
    expect(
      detectGaps(
        [reading("2024-01-01T00:00:00Z")],
        { ...utc, period: "month" },
        { start: "2023-12-31", end: "2024-03-01" },
      ),
    ).toEqual(["2023-12-01", "2024-02-01", "2024-03-01"]);
  });

  it("checks occupancy of whole partial week/month buckets", () => {
    expect(
      detectGaps(
        [reading("2024-03-04T12:00:00Z")],
        { ...ny, period: "week" },
        { start: "2024-03-08", end: "2024-03-10" },
      ),
    ).toEqual([]);
    expect(
      detectGaps(
        [reading("2024-03-01T12:00:00Z")],
        { ...ny, period: "month" },
        { start: "2024-03-10", end: "2024-03-10" },
      ),
    ).toEqual([]);
  });

  it("rejects reversed, malformed and impossible dates and invalid observations", () => {
    for (const start of ["invalid", "2024-2-01", "2023-02-29", "2024-13-01"]) {
      expect(() => detectGaps([], utc, { start, end: "2024-03-01" })).toThrow(RangeError);
    }
    expect(() => detectGaps([], utc, { start: "2024-03-02", end: "2024-03-01" })).toThrow(
      RangeError,
    );
    expect(() => detectGaps([], utc, { start: "2024-03-01", end: "invalid" })).toThrow(RangeError);
    expect(() =>
      detectGaps([{ timestamp: 0, value: Infinity }], utc, {
        start: "2024-03-01",
        end: "2024-03-01",
      }),
    ).toThrow(RangeError);
  });
});

describe("moving averages", () => {
  it("aligns trailing full windows and preserves immutable input", () => {
    const values = Object.freeze([2, 4, 9, -1, 0]);
    const averages = movingAverage(values, 3);
    expect(averages.slice(0, 2)).toEqual([null, null]);
    expect(averages[2]).toBeCloseTo(5, 12);
    expect(averages[3]).toBeCloseTo(4, 12);
    expect(averages[4]).toBeCloseTo(8 / 3, 12);
    expect(movingAverage(values, 1)).toEqual(values);
    expect(movingAverage(values, 6)).toEqual([null, null, null, null, null]);
    expect(movingAverage([], 3)).toEqual([]);
  });

  it("propagates gaps, then resumes after a full window", () => {
    expect(movingAverage([2, null, 4, 8, 0], 2)).toEqual([null, null, null, 6, 4]);
    expect(movingAverage([null, 2], 2)).toEqual([null, null]);
    expect(movingAverage([null], 1)).toEqual([null]);
    expect(movingAverage([Number.MAX_VALUE, Number.MAX_VALUE], 2)).toEqual([
      null,
      Number.MAX_VALUE,
    ]);
  });

  it("rejects invalid windows and values even before a full window", () => {
    for (const window of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => movingAverage([], window)).toThrow(RangeError);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => movingAverage([value], 3)).toThrow(RangeError);
    }
  });
});
