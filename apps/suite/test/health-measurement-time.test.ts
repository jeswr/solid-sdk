// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import { measurementTime } from "../src/apps/health/lib/browser/measurement-time";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["Pacific/Auckland", "2026-10-31T20:15:30.123Z", "2026-11-01"],
  ["Pacific/Auckland", "2026-10-31T11:05:00.000Z", "2026-11-01"],
  ["America/New_York", "2026-11-01T06:30:00.000Z", "2026-11-01"],
  ["Pacific/Honolulu", "2026-11-02T09:59:59.999Z", "2026-11-01"],
  ["UTC", "2026-11-01T00:00:00.000Z", "2026-11-01"],
])("resolves today's date to the exact current instant in %s (%s)", (zone, instant, date) => {
  vi.stubEnv("TZ", zone);
  const now = new Date(instant);
  const result = measurementTime({ kind: "date", date }, now);
  expect(result).toBe(instant);
  expect(Date.parse(result)).toBeLessThanOrEqual(now.getTime());
});

it.each([
  ["Pacific/Auckland", "2026-11-01T12:00:00Z", "2026-10-31", "2026-10-30T23:00:00.000Z"],
  ["America/New_York", "2026-11-02T12:00:00Z", "2026-10-31", "2026-10-31T16:00:00.000Z"],
  ["America/New_York", "2026-11-02T12:00:00Z", "2026-11-01", "2026-11-01T17:00:00.000Z"],
  ["UTC", "2026-11-01T12:00:00Z", "2026-10-31", "2026-10-31T12:00:00.000Z"],
])("resolves another date to local noon in %s (%s / %s)", (zone, instant, date, expected) => {
  vi.stubEnv("TZ", zone);
  const result = measurementTime({ kind: "date", date }, new Date(instant));
  expect(result).toBe(expected);
  expect(new Date(result).getHours()).toBe(12);
});

it("preserves explicit times and empty input", () => {
  expect(measurementTime({ kind: "dateTime", dateTime: "2026-11-01T08:30:00+13:00" })).toBe(
    "2026-11-01T08:30:00+13:00",
  );
  expect(measurementTime(null)).toBe("");
});
