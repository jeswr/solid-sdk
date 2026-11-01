// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { nextBoundary } from "../../src/apps/tasks/state/clock";

describe("Tasks wall clock boundaries", () => {
  it("updates at the next minute, including exactly on a minute", () => {
    expect(nextBoundary(new Date(2026, 10, 1, 16, 59, 32, 123))).toEqual(new Date(2026, 10, 1, 17));
    expect(nextBoundary(new Date(2026, 10, 1, 17))).toEqual(new Date(2026, 10, 1, 17, 1));
  });
  it.each([
    [2026, 2, 29],
    [2026, 9, 25],
    [2026, 11, 31],
  ])("uses local midnight across DST and year boundaries (%s-%s-%s)", (year, month, day) => {
    const before = new Date(year, month, day, 23, 59, 59, 999);
    const expected = new Date(before);
    expected.setHours(24, 0, 0, 0);
    expect(nextBoundary(before)).toEqual(expected);
  });
  it("follows the spring-forward and repeated autumn minute", () => {
    expect(nextBoundary(new Date("2026-03-29T00:59:50Z"))).toEqual(
      new Date("2026-03-29T01:00:00Z"),
    );
    expect(nextBoundary(new Date("2026-10-25T01:20:50Z"))).toEqual(
      new Date("2026-10-25T01:21:00Z"),
    );
    expect(nextBoundary(new Date("2026-10-25T00:59:50Z"))).toEqual(
      new Date("2026-10-25T01:00:00Z"),
    );
  });
});
