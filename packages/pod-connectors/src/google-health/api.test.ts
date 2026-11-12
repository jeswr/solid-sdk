// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  listFilter,
  nativeSource,
  parsePoint,
  parseRollup,
  point,
  preferred,
  sourceToken,
  timestamp,
} from "./api.js";
import { EXERCISE, HEART_RATE, SLEEP, STEPS, WEIGHT } from "./fixtures.js";

type Raw = Record<string, unknown>;
const withHeartRate = (heartRate: Raw) => ({
  ...HEART_RATE,
  heartRate: { ...HEART_RATE.heartRate, ...heartRate },
});
const withSampleTime = (sampleTime: Raw) =>
  withHeartRate({ sampleTime: { ...HEART_RATE.heartRate.sampleTime, ...sampleTime } });
const withExercise = (exercise: Raw) => ({
  ...EXERCISE,
  exercise: { ...EXERCISE.exercise, ...exercise },
});
const withSleep = (sleep: Raw) => ({ ...SLEEP, sleep: { ...SLEEP.sleep, ...sleep } });
const stage0 = SLEEP.sleep.stages[0] as Raw;

describe("Google Health provider boundary", () => {
  it.each([
    null,
    0,
    "",
    "2026-02-30T00:00:00Z",
    "2026-06-08T24:00:00Z",
    "2026-06-08T07:60:00Z",
    "2026-06-08T07:00:60Z",
    "2026-06-08T07:00:00",
    "2026-06-08T07:00:00.1234567890Z",
    "1969-12-31T23:59:59Z",
    "9999-12-31T23:59:59-01:00",
    "x".repeat(41),
  ])("rejects invalid or unrepresentable time %j", (value) => {
    expect(timestamp(value)).toBeUndefined();
  });

  it("normalizes equivalent instants (including nanosecond precision) before constructing deterministic sample ids", () => {
    expect(timestamp("2026-06-08T09:12:00+02:00")).toBe("2026-06-08T07:12:00.000Z");
    expect(timestamp("2026-06-08T07:12:00.987654321Z")).toBe("2026-06-08T07:12:00.987Z");
    expect(point("heart-rate", HEART_RATE)?.key).toBe(
      point("heart-rate", withSampleTime({ physicalTime: "2026-06-08T09:12:00+02:00" }))?.key,
    );
  });

  it("builds documented filters: physical sample time, sleep end time, widened exercise civil start", () => {
    const day = {
      start: Date.parse("2026-06-08T00:00:00Z"),
      end: Date.parse("2026-06-09T00:00:00Z"),
    };
    expect(listFilter("weight", day)).toBe(
      'weight.sample_time.physical_time >= "2026-06-08T00:00:00Z" AND weight.sample_time.physical_time < "2026-06-09T00:00:00Z"',
    );
    expect(listFilter("heart-rate", { ...day, end: Date.parse("2026-06-08T07:12:00.250Z") })).toBe(
      'heart_rate.sample_time.physical_time >= "2026-06-08T00:00:00Z" AND heart_rate.sample_time.physical_time < "2026-06-08T07:12:00.250Z"',
    );
    expect(listFilter("sleep", day)).toBe(
      'sleep.interval.end_time >= "2026-06-08T00:00:00Z" AND sleep.interval.end_time < "2026-06-09T00:00:00Z"',
    );
    expect(listFilter("exercise", day)).toBe(
      'exercise.interval.civil_start_time >= "2026-06-07T10:00:00" AND exercise.interval.civil_start_time < "2026-06-09T14:00:00"',
    );
  });

  it.each([
    [null, "shape"],
    [[], "shape"],
    [{}, "shape"],
    [{ ...HEART_RATE, heartRate: null }, "shape"],
    [withHeartRate({ sampleTime: undefined }), "shape"],
    [withSampleTime({ physicalTime: 7 }), "shape"],
    [withSampleTime({ physicalTime: "yesterday" }), "shape"],
    [withSampleTime({ physicalTime: "2026-02-30T00:00:00Z" }), "value"],
    [withSampleTime({ utcOffset: "3600" }), "shape"],
    [withSampleTime({ utcOffset: "86400s" }), "value"],
    [withSampleTime({ civilTime: { date: "2026-06-08" } }), "shape"],
    [withSampleTime({ civilTime: { date: { year: 2026, month: 2, day: 30 } } }), "value"],
    [
      withSampleTime({
        civilTime: { date: { year: 2026, month: 6, day: 8 }, time: { hours: 24 } },
      }),
      "value",
    ],
    [withHeartRate({ beatsPerMinute: undefined }), "shape"],
    [withHeartRate({ beatsPerMinute: {} }), "shape"],
    [withHeartRate({ beatsPerMinute: "NaN" }), "shape"],
    [withHeartRate({ beatsPerMinute: "1e2" }), "shape"],
    [withHeartRate({ beatsPerMinute: "-1" }), "value"],
    [withHeartRate({ beatsPerMinute: 72.5 }), "value"],
    [withHeartRate({ beatsPerMinute: "0" }), "value"],
    [withHeartRate({ beatsPerMinute: "301" }), "value"],
    [{ ...HEART_RATE, name: 1 }, "shape"],
    [{ ...HEART_RATE, name: "x".repeat(513) }, "value"],
    [{ ...HEART_RATE, name: "users/me/dataTypes/weight/dataPoints/1" }, "value"],
    [{ ...HEART_RATE, dataSource: "phone" }, "shape"],
    [{ ...HEART_RATE, dataSource: { a: { b: { c: { d: 1 } } } } }, "value"],
  ])("refuses malformed or invalid sample %j as %s", (raw, reason) => {
    expect(parsePoint("heart-rate", raw)).toBe(reason);
  });

  it.each([
    [{ stages: null }, "shape"],
    [{ stages: [null] }, "shape"],
    [{ stages: [{ ...stage0, type: "DOZING" }] }, "value"],
    [{ stages: [{ ...stage0, type: 3 }] }, "shape"],
    [{ stages: [{ ...stage0, startTime: "bad" }] }, "shape"],
    [{ stages: [{ ...stage0, startTime: "2026-06-08T21:00:00Z" }] }, "value"],
    [{ stages: [{ ...stage0, endTime: "2026-06-09T07:00:00Z" }] }, "value"],
    [{ stages: [{ ...stage0, endTime: stage0.startTime }] }, "value"],
    [{ metadata: { processed: "yes" } }, "shape"],
    [{ interval: { ...SLEEP.sleep.interval, endTime: SLEEP.sleep.interval.startTime } }, "value"],
  ])("refuses invalid sleep payload %j as %s", (sleep, reason) => {
    expect(parsePoint("sleep", withSleep(sleep))).toBe(reason);
  });

  it.each([
    [{ displayName: "\ud800" }, "value"],
    [{ displayName: "" }, "value"],
    [{ displayName: 7 }, "shape"],
    [{ exerciseType: undefined }, "shape"],
    [{ exerciseType: "Running" }, "value"],
    [{ metricsSummary: { distanceMillimeters: -1 } }, "value"],
    [{ metricsSummary: { distanceMillimeters: "Infinity" } }, "shape"],
    [{ metricsSummary: 5 }, "shape"],
    [{ interval: undefined }, "shape"],
  ])("refuses unsafe exercise payload %j as %s before path or RDF construction", (exercise, reason) => {
    expect(parsePoint("exercise", withExercise(exercise))).toBe(reason);
  });

  it("bounds sample values and accepts absent optional members, offsets and stages", () => {
    expect(
      point("weight", { ...WEIGHT, weight: { ...WEIGHT.weight, weightGrams: 0 } }),
    ).toBeUndefined();
    expect(
      point("weight", { ...WEIGHT, weight: { ...WEIGHT.weight, weightGrams: "70500.5" } })?.value,
    ).toBe(70.5005);
    expect(
      point("exercise", withExercise({ metricsSummary: undefined }))?.distanceKm,
    ).toBeUndefined();
    expect(point("sleep", withSleep({ stages: undefined }))?.stages).toEqual([]);
    const { utcOffset: _, civilTime: __, ...bare } = HEART_RATE.heartRate.sampleTime;
    expect(point("heart-rate", withHeartRate({ sampleTime: bare }))?.value).toBe(72);
    expect(
      nativeSource("https://evil.test/users/me/dataTypes/weight/dataPoints/1", "weight"),
    ).toBeUndefined();
  });

  it("reads one-day rollup buckets, treats an absent value member as no data and refuses other spans", () => {
    expect(parseRollup("steps", STEPS)).toEqual({ type: "steps", date: "2026-06-08", value: 6120 });
    expect(parseRollup("steps", { ...STEPS, steps: {} })).toMatchObject({ value: 0 });
    expect(parseRollup("steps", { civilStartTime: STEPS.civilStartTime })).toBeNull();
    expect(
      parseRollup("distance", { ...STEPS, steps: undefined, distance: { millimetersSum: "1500" } }),
    ).toMatchObject({ value: 1.5 });
    expect(
      parseRollup("total-calories", { ...STEPS, totalCalories: { kcalSum: 2000.25 } }),
    ).toMatchObject({ value: 2000.25 });
    expect(parseRollup("steps", { ...STEPS, steps: { countSum: "1e3" } })).toBe("shape");
    expect(parseRollup("steps", { ...STEPS, steps: 5 })).toBe("shape");
    expect(parseRollup("steps", { steps: STEPS.steps })).toBe("shape");
    expect(
      parseRollup("steps", { ...STEPS, civilEndTime: { date: { year: 2026, month: 6, day: 10 } } }),
    ).toBe("value");
    expect(
      parseRollup("steps", {
        ...STEPS,
        civilStartTime: { ...STEPS.civilStartTime, time: { hours: 6 } },
      }),
    ).toBe("value");
    expect(parseRollup("heart-rate", STEPS)).toBe("shape");
    expect(parsePoint("steps", STEPS)).toBe("shape");
  });

  it("renders a start's wall-clock time with Z for legacy Fitbit matching", () => {
    expect(
      point(
        "exercise",
        withExercise({
          interval: {
            ...EXERCISE.exercise.interval,
            startTime: "2026-06-07T21:12:00Z",
            startUtcOffset: "36000s",
            civilStartTime: undefined,
          },
        }),
      )?.wallStart,
    ).toBe("2026-06-08T07:12:00.000Z");
  });

  it("keys samples by data source and resolves same-source conflicts deterministically", () => {
    const phone = point("heart-rate", {
      ...HEART_RATE,
      dataSource: { platform: "HEALTH_CONNECT" },
    })!;
    const watch = point("heart-rate", {
      ...HEART_RATE,
      dataSource: { platform: "FITBIT", device: { formFactor: "WATCH" } },
    })!;
    expect(phone.key).not.toBe(watch.key);
    expect(
      point("heart-rate", { ...HEART_RATE, dataSource: { platform: "HEALTH_CONNECT" } })?.key,
    ).toBe(phone.key);
    expect(sourceToken("")).toMatch(/^[0-9a-f]{16}$/);
    for (const dataSource of [
      [],
      { "bad key": 1 },
      { a: { b: { c: { d: 1 } } } },
      { a: "x".repeat(257) },
      { list: [1] },
    ])
      expect(point("heart-rate", { ...HEART_RATE, dataSource })).toBeUndefined();
    expect(point("sleep", withSleep({ updateTime: "yesterday" }))).toBeUndefined();
    const older = point("sleep", withSleep({ updateTime: "2026-06-09T07:00:00Z" }))!;
    const newer = point("sleep", withSleep({ updateTime: "2026-06-09T08:00:00Z", stages: [] }))!;
    expect(preferred(older, newer)).toBe(newer);
    expect(preferred(newer, older)).toBe(newer);
    const a = point("weight", WEIGHT)!;
    const b = point("weight", { ...WEIGHT, weight: { ...WEIGHT.weight, weightGrams: 71_000 } })!;
    expect(preferred(a, b)).toBe(b);
    expect(preferred(b, a)).toBe(b);
  });
});
