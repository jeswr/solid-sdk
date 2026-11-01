// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  applyDrag,
  CalendarDragError,
  type DragErrorCode,
  type DragInput,
  MAX_DAY_DELTA,
  MAX_DELTA_MINUTES,
  MAX_EPOCH_MS,
  MAX_TIME_ZONE_LENGTH,
  MIN_EPOCH_MS,
  SNAP_MINUTES,
} from "../src/apps/calendar/lib/drag";
import { DAY_MS, MINUTE_MS, Zone } from "../src/apps/calendar/lib/drag/zone";

const at = Date.parse;
const base: DragInput = {
  start: at("2026-01-15T09:00:00Z"),
  end: at("2026-01-15T10:00:00Z"),
  timeZone: "UTC",
  kind: "move",
  deltaMinutes: 0,
  snapMinutes: 15,
};

function drag(changes: Partial<DragInput> = {}) {
  return applyDrag({ ...base, ...changes });
}

function error(changes: Partial<DragInput>, code: DragErrorCode) {
  expect(() => drag(changes)).toThrowError(new CalendarDragError(code));
  try {
    drag(changes);
  } catch (caught) {
    expect(caught).toBeInstanceOf(CalendarDragError);
    expect((caught as CalendarDragError).code).toBe(code);
  }
}

describe("calendar drag", () => {
  it("moves and snaps the resulting start, retaining exact duration", () => {
    const input = Object.freeze({ ...base, deltaMinutes: 7.5 });
    const result = applyDrag(input);
    expect(result.start).toBe(at("2026-01-15T09:15:00Z"));
    expect(result.end).toBe(at("2026-01-15T10:15:00Z"));
    expect(result.clamped).toBe(false);
    expect(result.dstAdjusted).toBe(false);
    expect(result.scope).toBe("this");
    expect(result.seriesOffset).toEqual({
      startMs: 15 * MINUTE_MS,
      endMs: 15 * MINUTE_MS,
      startWallMinutes: 15,
      endWallMinutes: 15,
      startDayDelta: 0,
      endDayDelta: 0,
    });
  });

  it.each(SNAP_MINUTES)("accepts a %i-minute step and rounds ties upward", (snapMinutes) => {
    expect(drag({ snapMinutes, deltaMinutes: snapMinutes / 2 }).start).toBe(
      base.start + snapMinutes * MINUTE_MS,
    );
    expect(drag({ snapMinutes, deltaMinutes: -snapMinutes / 2 }).start).toBe(base.start);
    expect(drag({ snapMinutes, deltaMinutes: snapMinutes / 2 - 1 / 60 }).start).toBe(base.start);
  });

  it.each([-1, 1])("accepts decimal minute deltas with floating-point roundoff (%i)", (sign) => {
    expect(drag({ deltaMinutes: sign * 4.1, snapMinutes: 5 }).start).toBe(
      base.start + sign * 5 * MINUTE_MS,
    );
    expect(drag({ deltaMinutes: sign * 0.00005, snapMinutes: 5 }).start).toBe(base.start);
    expect(drag({ deltaMinutes: sign * 525_599.99995 }).start).toBe(
      base.start + sign * MAX_DELTA_MINUTES * MINUTE_MS,
    );
  });

  it.each([
    "move",
    "resize-start",
    "resize-end",
  ] as const)("uses normalized integer milliseconds at a half-up snap tie for %s", (kind) => {
    const result = drag({
      kind,
      start: kind === "resize-end" ? -3_600_000 : -396_000,
      end: kind === "resize-end" ? -396_000 : 3_600_000,
      deltaMinutes: 4.1, // Exactly 246,000 ms takes the moving edge to -150,000 ms.
      snapMinutes: 5,
    });
    expect(kind === "resize-end" ? result.end : result.start).toBe(0);
  });

  it("snaps the resulting edge rather than the delta; preserves subsecond duration", () => {
    const start = base.start + 6 * MINUTE_MS + 123;
    const end = base.end + 456;
    const moved = drag({ start, end, deltaMinutes: 3 });
    expect(moved.start).toBe(base.start + 15 * MINUTE_MS);
    expect(moved.end - moved.start).toBe(end - start);
  });

  it("snaps negative epochs half up and rolls across month/year boundaries", () => {
    expect(drag({ start: -600_000, end: 600_000, deltaMinutes: 2.5 }).start).toBe(0);
    const moved = drag({
      start: at("2025-12-31T23:45Z"),
      end: at("2026-01-01T00:45Z"),
      deltaMinutes: 30,
    });
    expect(moved.start).toBe(at("2026-01-01T00:15Z"));
    expect(moved.end).toBe(at("2026-01-01T01:15Z"));
  });

  it("uses the zone's midnight grid, including quarter-hour offsets", () => {
    const moved = drag({ timeZone: "Asia/Kathmandu", snapMinutes: 60 });
    expect(moved.start).toBe(at("2026-01-15T09:15Z")); // 15:00 local
  });

  it("combines signed week-view days with wall-clock minutes", () => {
    expect(drag({ dayDelta: 2, deltaMinutes: -15 }).start).toBe(
      base.start + 2 * DAY_MS - 15 * MINUTE_MS,
    );
    expect(drag({ dayDelta: -2, deltaMinutes: 15 }).start).toBe(
      base.start - 2 * DAY_MS + 15 * MINUTE_MS,
    );
  });

  it.each([
    "resize-start",
    "resize-end",
  ] as const)("resizes %s and keeps the other edge fixed", (kind) => {
    const result = drag({ kind, deltaMinutes: 17, allDay: false });
    expect(result.start).toBe(base.start + (kind === "resize-start" ? 15 * MINUTE_MS : 0));
    expect(result.end).toBe(base.end + (kind === "resize-end" ? 15 * MINUTE_MS : 0));
    expect(result.clamped).toBe(false);
  });

  it.each(["resize-start", "resize-end"] as const)("clamps a crossed %s to one step", (kind) => {
    const result = drag({ kind, deltaMinutes: kind === "resize-start" ? 180 : -180 });
    expect(result.end - result.start).toBe(15 * MINUTE_MS);
    expect(result.clamped).toBe(true);
  });

  it("leaves an exact minimum unclamped and repairs shorter input durations on resize", () => {
    expect(drag({ kind: "resize-start", deltaMinutes: 45 }).clamped).toBe(false);
    expect(drag({ kind: "resize-end", deltaMinutes: -45 }).clamped).toBe(false);
    expect(drag({ end: base.start + 1, kind: "resize-end" }).end).toBe(base.start + 15 * MINUTE_MS);
    // Moving an existing short event still preserves its exact duration.
    expect(drag({ end: base.start + 1 }).end).toBe(base.start + 1);
  });

  it("clamps outward on the local grid when the fixed edge has seconds", () => {
    const start = base.start + 123;
    const end = base.end + 456;
    expect(drag({ start, end, kind: "resize-end", deltaMinutes: -180 }).end).toBe(
      base.start + 30 * MINUTE_MS,
    );
    expect(drag({ start, end, kind: "resize-start", deltaMinutes: 180 }).start).toBe(
      base.end - 15 * MINUTE_MS,
    );
  });

  it("allows timed resizes to cross midnight in either direction", () => {
    expect(drag({ kind: "resize-start", deltaMinutes: -600 }).start).toBe(at("2026-01-14T23:00Z"));
    expect(drag({ kind: "resize-end", deltaMinutes: 900 }).end).toBe(at("2026-01-16T01:00Z"));
  });
});

describe("DST arithmetic", () => {
  const ny = { timeZone: "America/New_York" };

  it.each([
    ["2026-03-07T14:00Z", "2026-03-08T13:00Z", 1],
    ["2026-03-08T13:00Z", "2026-03-07T14:00Z", -1],
    ["2026-10-31T13:00Z", "2026-11-01T14:00Z", 1],
  ] as const)("keeps 09:00 from %s to %s", (from, to, dayDelta) => {
    const start = at(from);
    const result = drag({ ...ny, start, end: start + 3_600_123, dayDelta });
    expect(result.start).toBe(at(to));
    expect(result.end - result.start).toBe(3_600_123);
    expect(result.seriesOffset.startWallMinutes).toBe(dayDelta * 1440);
    expect(result.dstAdjusted).toBe(false);
  });

  it("treats 1440 minutes as a wall-clock day too", () => {
    expect(
      drag({
        ...ny,
        start: at("2026-03-07T14:00Z"),
        end: at("2026-03-07T15:00Z"),
        deltaMinutes: 1440,
      }).start,
    ).toBe(at("2026-03-08T13:00Z"));
  });

  it("moves a gap target to the first valid instant, not by the gap's length", () => {
    const result = drag({
      ...ny,
      start: at("2026-03-07T07:30Z"),
      end: at("2026-03-07T08:30Z"),
      dayDelta: 1,
    });
    expect(result.start).toBe(at("2026-03-08T07:00Z"));
    expect(result.end).toBe(at("2026-03-08T08:00Z"));
    expect(result.dstAdjusted).toBe(true);
    expect(result.seriesOffset.startWallMinutes).toBe(1470);
    expect(result.seriesOffset.startMs).toBe(23.5 * 3_600_000);
  });

  it.each([
    ["resize-start", "2026-03-08T06:30Z", "2026-03-08T08:00Z", 60],
    ["resize-end", "2026-03-08T05:00Z", "2026-03-08T06:30Z", 60],
  ] as const)("resolves a gap for %s", (kind, from, to, deltaMinutes) => {
    const result = drag({ ...ny, start: at(from), end: at(to), kind, deltaMinutes });
    expect(kind === "resize-start" ? result.start : result.end).toBe(at("2026-03-08T07:00Z"));
    expect(result.dstAdjusted).toBe(true);
  });

  it("handles a half-hour gap whose first valid instant is off the hourly grid", () => {
    const result = drag({
      start: at("2026-10-02T15:30Z"), // Oct 3 02:00 +10:30
      end: at("2026-10-02T16:30Z"),
      timeZone: "Australia/Lord_Howe",
      snapMinutes: 60,
      dayDelta: 1,
    });
    expect(result.start).toBe(at("2026-10-03T15:30Z")); // Oct 4 02:30 +11
    expect(result.dstAdjusted).toBe(true);
  });

  it("handles a whole skipped date", () => {
    const result = drag({
      timeZone: "Pacific/Apia",
      start: at("2011-12-29T19:00Z"), // Dec 29 09:00 -10
      end: at("2011-12-29T20:00Z"),
      dayDelta: 1,
    });
    expect(result.start).toBe(at("2011-12-30T10:00Z")); // Dec 31 00:00 +14
    expect(result.dstAdjusted).toBe(true);
  });

  it.each([
    "2026-11-01T05:30Z",
    "2026-11-01T06:30Z",
  ])("retains the existing fold occurrence %s", (value) => {
    const start = at(value);
    expect(drag({ ...ny, start, end: start + 3_600_000 }).start).toBe(start);
  });

  it.each(["earlier", "later"] as const)("honours explicit %s overlap selection", (overlap) => {
    const result = drag({
      ...ny,
      start: at("2026-10-31T05:30Z"),
      end: at("2026-10-31T06:30Z"),
      dayDelta: 1,
      overlap,
    });
    expect(result.start).toBe(
      at(overlap === "earlier" ? "2026-11-01T05:30Z" : "2026-11-01T06:30Z"),
    );
    expect(result.dstAdjusted).toBe(false);
  });

  it("fails closed for an overlap with neither original offset and allows caller choice", () => {
    const input: Partial<DragInput> = {
      timeZone: "Pacific/Apia",
      start: at("2011-04-02T13:30Z"), // 03:30 -10
      end: at("2011-04-02T15:30Z"),
      dayDelta: 365, // Apr 1 2012 03:30, either +13 or +14
    };
    error(input, "AMBIGUOUS_TIME");
    expect(drag({ ...input, overlap: "earlier" }).start).toBe(at("2012-03-31T13:30Z"));
    expect(drag({ ...input, overlap: "later" }).start).toBe(at("2012-03-31T14:30Z"));
  });

  it("preserves exact elapsed duration even if the event spans a DST transition", () => {
    const result = drag({
      ...ny,
      start: at("2026-03-07T06:00Z"),
      end: at("2026-03-07T09:00Z"),
      dayDelta: 1,
    });
    expect(result.start).toBe(at("2026-03-08T06:00Z"));
    expect(result.end).toBe(at("2026-03-08T09:00Z")); // 05:00 local
    expect(result.seriesOffset.endWallMinutes).toBe(1500);
  });

  it.each([
    ["resize-start", "2026-03-08T05:00Z", "2026-03-08T07:35Z", 300, 60, "2026-03-08T06:00Z"],
    ["resize-end", "2026-03-08T06:40Z", "2026-03-08T08:00Z", -300, 60, "2026-03-08T08:00Z"],
    ["resize-start", "2026-11-01T04:00Z", "2026-11-01T06:30Z", 300, 15, "2026-11-01T05:15Z"],
    ["resize-end", "2026-11-01T05:30Z", "2026-11-01T08:00Z", -300, 15, "2026-11-01T06:45Z"],
  ] as const)("clamps %s safely around transitions from %s", (kind, start, end, deltaMinutes, snapMinutes, edge) => {
    const result = drag({ ...ny, kind, start: at(start), end: at(end), deltaMinutes, snapMinutes });
    expect(kind === "resize-start" ? result.start : result.end).toBe(at(edge));
    expect(result.end - result.start).toBeGreaterThanOrEqual(snapMinutes * MINUTE_MS);
    expect(result.clamped).toBe(true);
  });
});

describe("all-day dates and recurrence plans", () => {
  const dates = {
    allDay: true,
    start: at("2026-01-15T00:00Z"),
    end: at("2026-01-18T00:00Z"),
  };

  it("moves only whole dates and keeps the exclusive multi-day end", () => {
    const result = drag({ ...dates, dayDelta: 1, deltaMinutes: 1440 });
    expect(result.start).toBe(at("2026-01-17T00:00Z"));
    expect(result.end).toBe(at("2026-01-20T00:00Z"));
    expect(result.clamped).toBe(false);
  });

  it("resizes the exclusive end date and clamps to at least one date", () => {
    expect(drag({ ...dates, kind: "resize-end", dayDelta: 1 }).end).toBe(at("2026-01-19T00:00Z"));
    const clamped = drag({ ...dates, kind: "resize-end", dayDelta: -5 });
    expect(clamped.start).toBe(dates.start);
    expect(clamped.end).toBe(at("2026-01-16T00:00Z"));
    expect(clamped.clamped).toBe(true);
    expect(drag({ ...dates, kind: "resize-end", dayDelta: -2 }).clamped).toBe(false);
  });

  it.each([
    ["2026-03-07T05:00Z", "2026-03-08T05:00Z", "2026-03-09T04:00Z", 23],
    ["2026-10-31T04:00Z", "2026-11-01T04:00Z", "2026-11-02T05:00Z", 25],
  ] as const)("retains one local date across DST from %s", (from, to, end, hours) => {
    const result = drag({
      allDay: true,
      timeZone: "America/New_York",
      start: at(from),
      end: at(to),
      dayDelta: 1,
    });
    expect(result.start).toBe(at(to));
    expect(result.end).toBe(at(end));
    expect(result.end - result.start).toBe(hours * 3_600_000);
    expect(result.seriesOffset.startWallMinutes).toBe(1440);
    expect(result.seriesOffset.endWallMinutes).toBe(1440);
  });

  it.each([
    undefined,
    "earlier",
    "later",
  ] as const)("uses the first midnight for moved all-day boundaries with overlap %s", (overlap) => {
    const input = {
      allDay: true,
      timeZone: "America/Havana",
      start: at("2026-11-02T05:00Z"),
      end: at("2026-11-03T05:00Z"),
      ...(overlap === undefined ? {} : { overlap }),
    };
    const movedStart = drag({ ...input, dayDelta: -1 });
    expect(movedStart.start).toBe(at("2026-11-01T04:00Z"));
    expect(movedStart.end).toBe(at("2026-11-02T05:00Z"));
    expect(movedStart.end - movedStart.start).toBe(25 * 3_600_000);
    expect(movedStart.dstAdjusted).toBe(false);
    expect(movedStart.seriesOffset.startMs).toBe(-25 * 3_600_000);
    expect(movedStart.seriesOffset.startDayDelta).toBe(-1);
    expect(movedStart.seriesOffset.endDayDelta).toBe(-1);

    const movedEnd = drag({ ...input, dayDelta: -2 });
    expect(movedEnd.start).toBe(at("2026-10-31T04:00Z"));
    expect(movedEnd.end).toBe(at("2026-11-01T04:00Z"));
  });

  it.each([
    undefined,
    "earlier",
    "later",
  ] as const)("validates the first midnight and rejects the second with overlap %s", (overlap) => {
    const input = {
      allDay: true,
      timeZone: "America/Havana",
      ...(overlap === undefined ? {} : { overlap }),
    };
    for (const kind of ["move", "resize-end"] as const) {
      const firstStart = {
        ...input,
        kind,
        start: at("2026-11-01T04:00Z"),
        end: at("2026-11-02T05:00Z"),
      };
      expect(drag(firstStart).start).toBe(firstStart.start);
      expect(drag(firstStart).end).toBe(firstStart.end);
      error({ ...firstStart, start: at("2026-11-01T05:00Z") }, "INVALID_ALL_DAY");

      const firstEnd = {
        ...input,
        kind,
        start: at("2026-10-31T04:00Z"),
        end: at("2026-11-01T04:00Z"),
      };
      expect(drag(firstEnd).start).toBe(firstEnd.start);
      expect(drag(firstEnd).end).toBe(firstEnd.end);
      error({ ...firstEnd, end: at("2026-11-01T05:00Z") }, "INVALID_ALL_DAY");
    }
  });

  it.each([
    undefined,
    "earlier",
    "later",
  ] as const)("uses the first midnight for resized and clamped all-day ends with overlap %s", (overlap) => {
    const input = {
      allDay: true,
      kind: "resize-end" as const,
      timeZone: "America/Havana",
      start: at("2026-10-31T04:00Z"),
      end: at("2026-11-02T05:00Z"),
      ...(overlap === undefined ? {} : { overlap }),
    };
    const resized = drag({ ...input, dayDelta: -1 });
    expect(resized.start).toBe(input.start);
    expect(resized.end).toBe(at("2026-11-01T04:00Z"));
    expect(resized.clamped).toBe(false);
    expect(resized.dstAdjusted).toBe(false);
    const clamped = drag({ ...input, dayDelta: -3 });
    expect(clamped.start).toBe(input.start);
    expect(clamped.end).toBe(resized.end);
    expect(clamped.clamped).toBe(true);
  });

  it("supports a date whose first instant follows a midnight gap, including re-use", () => {
    const result = drag({
      allDay: true,
      timeZone: "America/Havana",
      start: at("2026-03-07T05:00Z"),
      end: at("2026-03-08T05:00Z"), // March 8 begins at 01:00
      dayDelta: 1,
    });
    expect(result.start).toBe(at("2026-03-08T05:00Z"));
    expect(result.end).toBe(at("2026-03-09T04:00Z"));
    expect(result.dstAdjusted).toBe(true);
    expect(drag({ ...result, allDay: true, timeZone: "America/Havana" }).start).toBe(result.start);
  });

  it("reports a gap at the moved all-day end and at a resized end", () => {
    const input = {
      allDay: true,
      timeZone: "America/Havana",
      start: at("2026-03-06T05:00Z"),
      end: at("2026-03-07T05:00Z"),
      dayDelta: 1,
    };
    expect(drag(input).dstAdjusted).toBe(true);
    expect(drag({ ...input, kind: "resize-end" }).dstAdjusted).toBe(true);
  });

  it("keeps date offsets independent of midnight gap clock changes", () => {
    const result = drag({
      allDay: true,
      timeZone: "America/Havana",
      start: at("2026-03-07T05:00Z"),
      end: at("2026-03-08T05:00Z"),
      dayDelta: 1,
    });
    expect(result.seriesOffset.startDayDelta).toBe(1);
    expect(result.seriesOffset.endDayDelta).toBe(1);
    expect(result.seriesOffset.startWallMinutes).toBe(1500);
    expect(result.seriesOffset.endWallMinutes).toBe(1380);
  });

  it("adjusts a skipped all-day start but rejects an impossible moved date span", () => {
    const input = {
      allDay: true,
      timeZone: "Pacific/Apia",
      start: at("2011-12-29T10:00Z"),
      end: at("2011-12-30T10:00Z"), // Dec 31, since Dec 30 is skipped
      dayDelta: 1,
    };
    const result = drag(input);
    expect(result.start).toBe(at("2011-12-30T10:00Z")); // Dec 31
    expect(result.end).toBe(at("2012-01-01T10:00Z")); // Jan 2, retaining two calendar days
    expect(result.dstAdjusted).toBe(true);
    error(
      {
        ...input,
        start: at("2011-12-28T10:00Z"),
        end: at("2011-12-29T10:00Z"),
      },
      "INVALID_RANGE",
    ); // Would require the end to be on the skipped date.
  });

  it.each([
    "this",
    "following",
    "all",
  ] as const)("returns %s scope with actual per-edge series offsets", (scope) => {
    const result = drag({ scope, kind: "resize-end", deltaMinutes: 7.5 });
    expect(result.scope).toBe(scope);
    expect(result.seriesOffset).toEqual({
      startMs: 0,
      endMs: 900_000,
      startWallMinutes: 0,
      endWallMinutes: 15,
      startDayDelta: 0,
      endDayDelta: 0,
    });
  });
});

describe("limits and typed failures", () => {
  it("passes a zone at the length bound to Intl and rejects bound+1 before regex or Intl", () => {
    const Original = Intl.DateTimeFormat;
    // Exercise the length contract independently of the host's available IANA names.
    function zoneFormatter(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return new Original(locales, { ...options, timeZone: "UTC" });
    }
    const intl = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(zoneFormatter);
    const atBound = "A".repeat(MAX_TIME_ZONE_LENGTH);
    try {
      expect(drag({ timeZone: atBound }).start).toBe(base.start);
      expect(intl).toHaveBeenCalledWith("en-GB", expect.objectContaining({ timeZone: atBound }));
      intl.mockClear();
      const oversized = `${atBound}A`;
      const regex = vi.spyOn(RegExp.prototype, "test");
      error({ timeZone: oversized }, "INVALID_INPUT");
      expect(regex).not.toHaveBeenCalledWith(oversized);
      expect(intl).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([-1, 1])("accepts the signed minute/day bounds (%i)", (sign) => {
    expect(drag({ deltaMinutes: sign * MAX_DELTA_MINUTES }).start).toBe(
      base.start + sign * MAX_DELTA_MINUTES * MINUTE_MS,
    );
    expect(drag({ dayDelta: sign * MAX_DAY_DELTA }).start).toBe(
      base.start + sign * MAX_DAY_DELTA * DAY_MS,
    );
    expect(
      drag({ deltaMinutes: sign * MAX_DELTA_MINUTES, dayDelta: sign * MAX_DAY_DELTA }).start,
    ).toBe(base.start + sign * (MAX_DELTA_MINUTES * MINUTE_MS + MAX_DAY_DELTA * DAY_MS));
  });

  it.each([-1, 1])("rejects bound+1 before Intl work (%i)", (sign) => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    error({ deltaMinutes: sign * (MAX_DELTA_MINUTES + 1) }, "DELTA_TOO_LARGE");
    error({ dayDelta: sign * (MAX_DAY_DELTA + 1) }, "DELTA_TOO_LARGE");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    -1, 1,
  ])("rejects submillisecond deltas beyond roundoff before Intl work (%i)", (sign) => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    try {
      for (const milliseconds of [1e-8, 0.5, 1.0000001, 246_000.001, 31_535_999_999.999]) {
        error({ deltaMinutes: (sign * milliseconds) / MINUTE_MS }, "INVALID_DELTA");
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("accepts the epoch bounds and rejects one millisecond beyond", () => {
    expect(drag({ start: MIN_EPOCH_MS, end: MIN_EPOCH_MS + 1 }).start).toBe(MIN_EPOCH_MS);
    expect(drag({ start: MAX_EPOCH_MS - 899_999, end: MAX_EPOCH_MS }).end).toBe(MAX_EPOCH_MS);
    error({ start: MIN_EPOCH_MS - 1 }, "INVALID_RANGE");
    error({ end: MAX_EPOCH_MS + 1 }, "INVALID_RANGE");
  });

  it.each([
    0,
    1,
    7,
    20,
    45,
    61,
    NaN,
    Infinity,
    "15",
    null,
    undefined,
  ])("rejects snap %s", (snapMinutes) => {
    error({ snapMinutes: snapMinutes as number }, "INVALID_SNAP");
  });

  it.each([
    { deltaMinutes: NaN },
    { deltaMinutes: Infinity },
    { deltaMinutes: -Infinity },
    { deltaMinutes: "15" },
    { deltaMinutes: null },
    { deltaMinutes: undefined },
    { deltaMinutes: 1 / 7 },
    { dayDelta: NaN },
    { dayDelta: Infinity },
    { dayDelta: 0.5 },
    { dayDelta: null },
  ])("rejects malformed deltas %j", (input) => error(input as Partial<DragInput>, "INVALID_DELTA"));

  it.each([
    { start: NaN },
    { end: Infinity },
    { start: base.start + 0.5 },
    { end: base.start },
    { end: base.start - 1 },
    { start: "0" },
  ])("rejects malformed or reversed range %j", (input) =>
    error(input as Partial<DragInput>, "INVALID_RANGE"));

  it.each([null, undefined, 5, "drag"])("rejects non-object input %s", (input) => {
    expect(() => applyDrag(input as unknown as DragInput)).toThrowError(
      new CalendarDragError("INVALID_INPUT"),
    );
  });

  it.each([
    "Unknown/Zone",
    "",
    "+01:00",
    "-05:00",
    undefined,
    5,
  ])("rejects zone %s without exposing it", (timeZone) => {
    error({ timeZone: timeZone as string }, "UNKNOWN_TIME_ZONE");
  });

  it("rejects unsupported gesture/scope/overlap/all-day flags", () => {
    error({ kind: "rotate" as DragInput["kind"] }, "INVALID_GESTURE");
    error({ scope: "series" as NonNullable<DragInput["scope"]> }, "INVALID_SCOPE");
    error({ overlap: "guess" as NonNullable<DragInput["overlap"]> }, "INVALID_OVERLAP");
    error({ allDay: "true" as unknown as boolean }, "INVALID_ALL_DAY");
  });

  it("rejects partial-day gestures, start resizing and non-date all-day ranges", () => {
    const dates = { allDay: true, start: at("2026-01-15T00:00Z"), end: at("2026-01-16T00:00Z") };
    error({ ...dates, deltaMinutes: 1 }, "INVALID_ALL_DAY");
    error({ ...dates, kind: "resize-start" }, "INVALID_GESTURE");
    error({ ...dates, start: dates.start + 1 }, "INVALID_ALL_DAY");
    error({ ...dates, end: dates.end + 1 }, "INVALID_ALL_DAY");
    error({ ...dates, end: dates.start + 1 }, "INVALID_ALL_DAY");
    // A repeated midnight is not a positive date span.
    error(
      {
        allDay: true,
        timeZone: "America/Havana",
        start: at("2026-11-01T04:00Z"),
        end: at("2026-11-01T05:00Z"),
      },
      "INVALID_ALL_DAY",
    );
  });

  it("rejects output overflow and local dates outside the supported epoch range", () => {
    error({ start: MIN_EPOCH_MS, end: MIN_EPOCH_MS + DAY_MS, dayDelta: -1 }, "INVALID_RANGE");
    error({ start: MAX_EPOCH_MS - DAY_MS + 1, end: MAX_EPOCH_MS, dayDelta: 1 }, "INVALID_RANGE");
    error(
      { start: MAX_EPOCH_MS - DAY_MS + 1, end: MAX_EPOCH_MS, deltaMinutes: 15 },
      "INVALID_RANGE",
    );
    error(
      { start: MIN_EPOCH_MS, end: MIN_EPOCH_MS + DAY_MS, timeZone: "America/New_York" },
      "INVALID_RANGE",
    );
    error(
      { start: MAX_EPOCH_MS - DAY_MS + 1, end: MAX_EPOCH_MS, timeZone: "Asia/Tokyo" },
      "INVALID_RANGE",
    );
    error(
      {
        start: MAX_EPOCH_MS - DAY_MS + 1,
        end: MAX_EPOCH_MS - 3_600_000,
        deltaMinutes: 60,
        timeZone: "Asia/Tokyo",
      },
      "INVALID_RANGE",
    );
  });

  it("supports historical offsets with seconds", () => {
    const result = drag({
      timeZone: "Europe/Paris",
      start: at("1900-01-01T08:50:39Z"),
      end: at("1900-01-01T09:50:39Z"),
      dayDelta: 1,
    });
    expect(result.start).toBe(at("1900-01-02T08:50:39Z")); // local 09:00, +00:09:21
    expect(result.dstAdjusted).toBe(false);
  });

  it("fails closed if Intl cannot bracket a nonexistent time", () => {
    const zone = new Zone("UTC");
    // Exercise the defensive guard without relying on a broken host tz database.
    vi.spyOn(zone, "wall").mockReturnValue(base.start);
    expect(() => zone.resolve(base.start + 1, 0)).toThrowError(
      new CalendarDragError("INVALID_RANGE"),
    );
  });
});
