// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { nativeSource, point, timestamp } from "./api.js";
import { EXERCISE, HEART_RATE, SLEEP, STEPS, WEIGHT } from "./fixtures.js";

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
    "1969-12-31T23:59:59Z",
    "9999-12-31T23:59:59-01:00",
    "x".repeat(41),
  ])("rejects invalid or unrepresentable time %j", (value) => {
    expect(timestamp(value)).toBeUndefined();
  });

  it("normalizes equivalent instants before constructing deterministic sample ids", () => {
    expect(timestamp("2026-06-08T09:12:00+02:00")).toBe("2026-06-08T07:12:00.000Z");
    expect(point("heart-rate", HEART_RATE)?.key).toBe(
      point("heart-rate", { ...HEART_RATE, time: "2026-06-08T09:12:00+02:00" })?.key,
    );
  });

  it.each([
    null,
    [],
    {},
    { ...STEPS, steps: null },
    { ...STEPS, steps: { count: "12" } },
    { ...STEPS, steps: { count: 1.5 } },
    { ...STEPS, steps: { count: -1 } },
    { ...STEPS, steps: { count: 1e9 + 1 } },
    { ...STEPS, endTime: STEPS.startTime },
    { ...STEPS, endTime: "2026-06-07T00:00:00Z" },
    { ...STEPS, endTime: "2026-06-10T00:00:00Z" },
    { ...STEPS, name: 1 },
    { ...STEPS, name: "x".repeat(513) },
    { ...STEPS, name: "users/me/dataTypes/weight/dataPoints/1" },
  ])("skips malformed or ambiguous summary %j", (raw) => {
    expect(point("steps", raw)).toBeUndefined();
  });

  it.each([
    {},
    { stages: null },
    { stages: [null] },
    { stages: [{ ...SLEEP.sleep.stages[0], stage: "bad\u0000label" }] },
    { stages: [{ ...SLEEP.sleep.stages[0], startTime: "bad" }] },
    { stages: [{ ...SLEEP.sleep.stages[0], startTime: "2026-06-08T21:00:00Z" }] },
    { stages: [{ ...SLEEP.sleep.stages[0], endTime: "2026-06-09T07:00:00Z" }] },
    { stages: [{ ...SLEEP.sleep.stages[0], endTime: SLEEP.startTime }] },
  ])("skips invalid sleep stage payloads %j", (sleep) => {
    expect(point("sleep", { ...SLEEP, sleep })).toBeUndefined();
  });

  it.each([
    { activityName: "\ud800" },
    { activityName: "" },
    { activityName: "Run", distanceMeters: -1 },
    { activityName: "Run", distanceMeters: "5200" },
  ])("skips unsafe exercise payloads %j before path or RDF construction", (exerciseSession) => {
    expect(point("exercise-session", { ...EXERCISE, exerciseSession })).toBeUndefined();
  });

  it("bounds sample values and accepts absent optional exercise distance and empty stages", () => {
    expect(
      point("heart-rate", { ...HEART_RATE, heartRate: { beatsPerMinute: 1001 } }),
    ).toBeUndefined();
    expect(point("weight", { ...WEIGHT, weight: { kilograms: -1 } })).toBeUndefined();
    expect(
      point("exercise-session", { ...EXERCISE, exerciseSession: { activityName: "Run" } })
        ?.distanceKm,
    ).toBeUndefined();
    expect(point("sleep", { ...SLEEP, sleep: { stages: [] } })?.stages).toEqual([]);
    expect(
      nativeSource("https://evil.test/users/me/dataTypes/weight/dataPoints/1", "weight"),
    ).toBeUndefined();
  });
});
