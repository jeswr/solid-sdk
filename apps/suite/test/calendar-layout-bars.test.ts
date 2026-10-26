// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CalendarLayoutError,
  type DateEvent,
  layoutAllDayEvents,
  layoutMonthEvents,
} from "../src/apps/calendar/lib/layout";

const event = (id: string, startDate: string, endDate: string): DateEvent => ({
  id,
  startDate,
  endDate,
});

describe("date bars", () => {
  it("returns empty rows for an empty month/strip", () => {
    const rows = layoutMonthEvents([], 2026, 10, 1);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.bars.length === 0 && row.laneCount === 0)).toBe(true);
    expect(layoutAllDayEvents([], "2026-10-01", 1)).toEqual({
      startDate: "2026-10-01",
      laneCount: 0,
      bars: [],
    });
  });

  it("splits multi-day events at week boundaries and preserves continuation flags", () => {
    const rows = layoutMonthEvents(
      [event("https://example.org/calendar/trip", "2026-10-02", "2026-10-14")],
      2026,
      10,
      1,
    );
    expect(
      rows.map((row) =>
        row.bars.map((bar) => [bar.column, bar.span, bar.continuesBefore, bar.continuesAfter]),
      ),
    ).toEqual([[[4, 3, false, true]], [[0, 7, true, true]], [[0, 2, true, false]], [], [], []]);
    expect(rows[0]?.bars[0]).toMatchObject({ left: 4 / 7, width: 3 / 7, lane: 0 });
  });

  it("clips the full grid including adjacent-month cells and excludes touching/outside events", () => {
    const rows = layoutMonthEvents(
      [
        event("spanning", "2026-09-01", "2026-12-01"),
        event("before", "2026-09-01", "2026-09-28"),
        event("after", "2026-11-09", "2026-11-10"),
      ],
      2026,
      10,
      1,
    );
    expect(rows.every((row) => row.bars.length === 1 && row.laneCount === 1)).toBe(true);
    expect(
      rows
        .flatMap((row) => row.bars)
        .every((bar) => bar.width === 1 && bar.continuesBefore && bar.continuesAfter),
    ).toBe(true);
  });

  it("uses deterministic first-fit lanes, longest first, and reuses lanes at exclusive ends", () => {
    const events = Object.freeze([
      Object.freeze(event("z", "2026-10-01", "2026-10-03")),
      Object.freeze(event("b", "2026-10-01", "2026-10-05")),
      Object.freeze(event("a", "2026-10-01", "2026-10-05")),
      Object.freeze(event("next", "2026-10-03", "2026-10-04")),
    ]);
    const row = layoutAllDayEvents(events, "2026-10-01", 7);
    expect(row.laneCount).toBe(3);
    expect(row.bars.map((bar) => [bar.id, bar.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["z", 2],
      ["next", 2],
    ]);
    expect(layoutAllDayEvents([...events].reverse(), "2026-10-01", 7)).toEqual(row);
    expect(events.map((item) => item.id)).toEqual(["z", "b", "a", "next"]);
  });

  it("restarts lanes independently on each week row", () => {
    const rows = layoutMonthEvents(
      [
        event("earlier", "2026-09-28", "2026-10-05"),
        event("continuing", "2026-10-03", "2026-10-07"),
      ],
      2026,
      10,
      1,
    );
    expect(rows[0]?.bars.map((bar) => bar.lane)).toEqual([0, 1]);
    expect(rows[1]?.bars.map((bar) => bar.lane)).toEqual([0]);
  });

  it("supports one-day strips and clips both ends", () => {
    const row = layoutAllDayEvents([event("wide", "2026-09-30", "2026-10-03")], "2026-10-01", 1);
    expect(row.bars[0]).toEqual({
      id: "wide",
      column: 0,
      span: 1,
      lane: 0,
      left: 0,
      width: 1,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(
      layoutAllDayEvents([event("one", "2026-10-01", "2026-10-02")], "2026-10-01", 1).bars[0],
    ).toMatchObject({ continuesBefore: false, continuesAfter: false });
  });

  it("never overlaps bars in a lane and uses the peak concurrent lane count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 1, max: 7 })), {
          maxLength: 30,
        }),
        (ranges) => {
          const events = ranges.map(([start, length], index) =>
            event(
              String(index),
              `2026-10-0${start + 1}`,
              `2026-10-${String(start + length + 1).padStart(2, "0")}`,
            ),
          );
          const row = layoutAllDayEvents(events, "2026-10-01", 7);
          let peak = 0;
          for (let day = 0; day < 7; day++) {
            const active = row.bars.filter(
              (bar) => bar.column <= day && day < bar.column + bar.span,
            );
            expect(new Set(active.map((bar) => bar.lane)).size).toBe(active.length);
            peak = Math.max(peak, active.length);
          }
          expect(row.laneCount).toBe(peak);
        },
      ),
      { seed: 426, numRuns: 100 },
    );
  });

  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-01",
    "0000-01-01",
    "2026-10-01T00:00:00Z",
    "2026-10-01+01:00",
    "bad",
    null,
  ])("rejects invalid date %s", (value) => {
    expect(() => layoutAllDayEvents([], value as string, 1)).toThrow(CalendarLayoutError);
  });

  it("rejects invalid ranges, including invisible events, and unsafe output dates", () => {
    for (const item of [
      event("zero", "2026-10-01", "2026-10-01"),
      event("backwards", "2025-01-02", "2025-01-01"),
      event("invalid", "2025-02-30", "2025-03-02"),
      event("end", "2025-01-01", "bad"),
    ]) {
      expect(() => layoutMonthEvents([item], 2026, 10, 1)).toThrow(CalendarLayoutError);
    }
    for (const count of [0, 8, 1.5, NaN])
      expect(() => layoutAllDayEvents([], "2026-10-01", count)).toThrow(CalendarLayoutError);
    expect(() => layoutAllDayEvents([], "9999-12-31", 7)).toThrow(CalendarLayoutError);
  });

  it.each([
    null,
    {},
    [null],
    [{}],
    [{ id: 3 }],
    [{ id: " " }],
    [event("same", "2026-10-01", "2026-10-02"), event("same", "2026-10-01", "2026-10-02")],
  ])("rejects malformed collections and duplicate/empty identities", (events) => {
    expect(() => layoutAllDayEvents(events as readonly DateEvent[], "2026-10-01", 1)).toThrow(
      CalendarLayoutError,
    );
  });

  it("exposes safe typed errors with a stable code", () => {
    try {
      layoutAllDayEvents([event("secret", "private-value", "bad")], "2026-10-01", 1);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarLayoutError);
      expect(error).toMatchObject({
        name: "CalendarLayoutError",
        code: "invalid-date",
        message: "Calendar layout: invalid-date",
      });
    }
  });
});
