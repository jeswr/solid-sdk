// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type BusyInterval,
  expandRecurrence,
  mergeBusyIntervals,
  RecurrenceError,
} from "../src/apps/calendar/lib/recurrence/index";

describe("free/busy interval union", () => {
  it("returns fresh sorted, coalesced intervals for duplicates, containment, overlap and touching endpoints", () => {
    const intervals = Object.freeze([
      Object.freeze({ start: 20, end: 30 }),
      Object.freeze({ start: 1, end: 4 }),
      Object.freeze({ start: 3, end: 6 }),
      Object.freeze({ start: 6, end: 10 }),
      Object.freeze({ start: 2, end: 3 }),
      Object.freeze({ start: 1, end: 4 }),
      Object.freeze({ start: 20, end: 25 }),
      Object.freeze({ start: -2, end: 0 }),
    ]);
    const result = mergeBusyIntervals(intervals);
    expect(result).toEqual([
      { start: -2, end: 0 },
      { start: 1, end: 10 },
      { start: 20, end: 30 },
    ]);
    expect(result.every((r) => !intervals.some((i) => i === r))).toBe(true);
    expect(mergeBusyIntervals([])).toEqual([]);
    expect(mergeBusyIntervals([{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
  });

  it("merges expanded occurrences from multiple synthetic calendars", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const window = { start, end: start + 86_400_000 };
    const mira = expandRecurrence(
      { start: "2026-01-01T09:00:00", timeZone: "UTC", durationMs: 3_600_000 },
      window,
    );
    const noel = expandRecurrence(
      { start: "2026-01-01T09:30:00", timeZone: "UTC", durationMs: 3_600_000 },
      window,
    );
    expect(mergeBusyIntervals([...mira, ...noel])).toEqual([
      { start: start + 32_400_000, end: start + 37_800_000 },
    ]);
  });

  it.each([
    null,
    {},
    [null],
    new Array(1),
    [{ start: NaN, end: 2 }],
    [{ start: 1, end: Infinity }],
    [{ start: 1.5, end: 2 }],
    [{ start: 2, end: 1 }],
    [{ start: 2, end: 2 }],
    [{ start: 1, end: 2, extra: 3 }],
  ])("rejects invalid intervals %#", (values) => {
    expect(() => mergeBusyIntervals(values as readonly BusyInterval[])).toThrow(RecurrenceError);
  });
});
