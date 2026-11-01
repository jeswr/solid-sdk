// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  dateFromDayKey,
  localDayKey,
  startOfWeek,
} from "../../src/apps/tasks/lib/views/days";

describe("local calendar days", () => {
  it("uses local fields, pads dates, and rejects invalid dates and day keys", () => {
    expect(localDayKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    expect(localDayKey(new Date(2026, 0, 3))).toBe("2026-01-03");
    expect(dateFromDayKey("2026-07-01")).toEqual(new Date(2026, 6, 1));
    for (const value of ["2026-02-30", "2026-2-03", "no-date"])
      expect(() => dateFromDayKey(value)).toThrow(TypeError);
    expect(() => localDayKey(new Date(Number.NaN))).toThrow(TypeError);
  });

  it.each([
    [new Date(2026, 2, 28, 12, 15), 1, new Date(2026, 2, 29, 12, 15), 23],
    [new Date(2026, 9, 24, 12, 15), 1, new Date(2026, 9, 25, 12, 15), 25],
    [new Date(2026, 0, 1), -1, new Date(2025, 11, 31), -24],
  ])("adds calendar days across DST and year boundaries", (date, count, expected, hours) => {
    const before = date.getTime();
    const result = addDays(date, count);
    expect(result).toEqual(expected);
    expect(result.getTime() - before).toBe(hours * 3_600_000);
    expect(date.getTime()).toBe(before);
  });

  it("starts Monday or Sunday at local midnight, including an already matching day", () => {
    const date = new Date(2026, 9, 25, 17);
    expect(startOfWeek(date, "monday")).toEqual(new Date(2026, 9, 19));
    expect(startOfWeek(date, "sunday")).toEqual(new Date(2026, 9, 25));
    expect(startOfWeek(new Date(2026, 9, 26), "monday")).toEqual(new Date(2026, 9, 26));
    expect(date.getHours()).toBe(17);
  });

  it.each(["en-US", "en-GB"])("uses the runtime's %s locale week start", (locale) => {
    const options = new Intl.DateTimeFormat(locale).resolvedOptions();
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue(options);
    try {
      expect(startOfWeek(new Date(2026, 9, 28), "locale")).toEqual(
        new Date(2026, 9, locale === "en-US" ? 25 : 26),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
