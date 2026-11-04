// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { MAX_DAY_DELTA } from "../src/apps/calendar/lib/drag";
import type { CalendarEvent } from "../src/apps/calendar/lib/model";
import {
  columnAt,
  dayDistance,
  dayPinned,
  draggedEvent,
  dragThreshold,
  dropAnnouncement,
  GRID_SNAP_MINUTES,
  PX_PER_MINUTE,
  passedThreshold,
  pointerMinutes,
  sameTiming,
} from "../src/apps/calendar/state/drag";

const zone = "Europe/London";
const timed: CalendarEvent = {
  name: "Planning",
  start: new Date("2026-11-01T11:00:00Z"),
  end: new Date("2026-11-01T12:00:00Z"),
  location: "Studio",
};
const iso = (event: CalendarEvent | undefined) =>
  event && {
    start: event.start instanceof Date ? event.start.toISOString() : event.start,
    end: event.end instanceof Date ? event.end.toISOString() : event.end,
  };

describe("pointer geometry", () => {
  it("uses a small threshold so clicks stay clicks, larger for touch", () => {
    expect(dragThreshold("mouse")).toBe(4);
    expect(dragThreshold("pen")).toBe(4);
    expect(dragThreshold("touch")).toBe(10);
    expect(passedThreshold(3, 0, "mouse")).toBe(false);
    expect(passedThreshold(3, 3, "mouse")).toBe(true);
    expect(passedThreshold(6, 6, "touch")).toBe(false);
    expect(passedThreshold(0, -10, "touch")).toBe(true);
  });
  it("converts vertical travel to whole minutes on the 48px-per-hour grid", () => {
    expect(PX_PER_MINUTE * 60).toBe(48);
    expect(GRID_SNAP_MINUTES).toBe(30);
    expect(pointerMinutes(48)).toBe(60);
    expect(pointerMinutes(-24)).toBe(-30);
    expect(pointerMinutes(10.3)).toBe(13);
    expect(Object.is(pointerMinutes(-0.1), 0)).toBe(true);
  });
  it("finds the column under the pointer and clamps outside the grid", () => {
    const columns = [{ left: 100 }, { left: 200 }, { left: 300 }];
    expect(columnAt(50, columns)).toBe(0);
    expect(columnAt(100, columns)).toBe(0);
    expect(columnAt(199.5, columns)).toBe(0);
    expect(columnAt(250, columns)).toBe(1);
    expect(columnAt(9999, columns)).toBe(2);
    expect(columnAt(10, [])).toBe(-1);
  });
  it("counts civil days between date keys independent of DST", () => {
    expect(dayDistance("2026-10-25", "2026-11-01")).toBe(7);
    expect(dayDistance("2026-11-04", "2026-11-01")).toBe(-3);
    expect(dayDistance("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("dayPinned", () => {
  const base: CalendarEvent = {
    name: "Gym",
    start: new Date("2026-11-02T08:00:00Z"),
    end: new Date("2026-11-02T09:00:00Z"),
    recurrence: { frequency: "WEEKLY", byDay: ["MO", "WE", "FR"] },
  };
  const at = (start: string): CalendarEvent => ({ ...base, start: new Date(start) });
  it("pins a by-day series moved to another day", () => {
    expect(dayPinned(base, at("2026-11-03T08:00:00Z"), "UTC")).toBe(true);
  });
  it("allows time-only moves and series without by-rules", () => {
    expect(dayPinned(base, at("2026-11-02T10:00:00Z"), "UTC")).toBe(false);
    const plain: CalendarEvent = { ...base, recurrence: { frequency: "WEEKLY" } };
    expect(dayPinned(plain, at("2026-11-03T08:00:00Z"), "UTC")).toBe(false);
  });
  it("compares civil days in the viewer's zone", () => {
    // 11:30 UTC on the 2nd is a time-only move in UTC but already the 3rd in Auckland.
    expect(dayPinned(base, at("2026-11-02T11:30:00Z"), "UTC")).toBe(false);
    expect(dayPinned(base, at("2026-11-02T11:30:00Z"), "Pacific/Auckland")).toBe(true);
  });
  it("pins month-day and month rules, and compares all-day dates directly", () => {
    const monthly: CalendarEvent = {
      name: "Rent",
      start: "2026-11-02",
      recurrence: { frequency: "MONTHLY", byMonthDay: [2] },
    };
    expect(dayPinned(monthly, { ...monthly, start: "2026-11-03" }, "UTC")).toBe(true);
    expect(dayPinned(monthly, monthly, "UTC")).toBe(false);
    const yearly: CalendarEvent = {
      ...monthly,
      recurrence: { frequency: "YEARLY", byMonth: [11] },
    };
    expect(dayPinned(yearly, { ...yearly, start: "2026-11-03" }, "UTC")).toBe(true);
    expect(dayPinned({ ...monthly, recurrence: undefined }, monthly, "UTC")).toBe(false);
  });
});
describe("sameTiming", () => {
  it("compares timed, all-day and open-ended timings", () => {
    expect(sameTiming(timed, { ...timed, name: "Other" })).toBe(true);
    expect(sameTiming(timed, { ...timed, end: undefined })).toBe(false);
    expect(sameTiming({ name: "a", start: "2026-11-01" }, { name: "b", start: "2026-11-01" })).toBe(
      true,
    );
    expect(sameTiming({ name: "a", start: "2026-11-01" }, { name: "a", start: "2026-11-02" })).toBe(
      false,
    );
  });
});

describe("draggedEvent (timed)", () => {
  it("moves across days and snaps vertical travel to the slot", () => {
    const next = draggedEvent(timed, { kind: "move", minutes: 182, days: -1 }, zone);
    expect(iso(next)).toEqual({
      start: "2026-10-31T14:00:00.000Z",
      end: "2026-10-31T15:00:00.000Z",
    });
    expect(next?.name).toBe("Planning");
    expect(next?.location).toBe("Studio");
  });
  it("treats travel within half a slot as no change", () => {
    expect(draggedEvent(timed, { kind: "move", minutes: 10, days: 0 }, zone)).toBeUndefined();
    expect(draggedEvent(timed, { kind: "move", minutes: 0, days: 0 }, zone)).toBeUndefined();
  });
  it("resizes only the end, ignores days and keeps at least one slot", () => {
    expect(iso(draggedEvent(timed, { kind: "resize-end", minutes: 60, days: 3 }, zone))).toEqual({
      start: "2026-11-01T11:00:00.000Z",
      end: "2026-11-01T13:00:00.000Z",
    });
    expect(iso(draggedEvent(timed, { kind: "resize-end", minutes: -300, days: 0 }, zone))).toEqual({
      start: "2026-11-01T11:00:00.000Z",
      end: "2026-11-01T11:30:00.000Z",
    });
  });
  it("keeps an open end open on moves and gives it one on resize", () => {
    const open = { ...timed, end: undefined };
    const moved = draggedEvent(open, { kind: "move", minutes: 60, days: 0 }, zone);
    expect(moved?.start).toEqual(new Date("2026-11-01T12:00:00Z"));
    expect(moved?.end).toBeUndefined();
    expect(iso(draggedEvent(open, { kind: "resize-end", minutes: 30, days: 0 }, zone))).toEqual({
      start: "2026-11-01T11:00:00.000Z",
      end: "2026-11-01T12:00:00.000Z",
    });
  });
  it("keeps the wall-clock time on a day-only move, across DST", () => {
    // 23 Oct is BST (UTC+1); 26 Oct is GMT.
    const standUp: CalendarEvent = {
      name: "Stand-up",
      start: new Date("2026-10-23T08:30:00Z"),
      end: new Date("2026-10-23T08:45:00Z"),
    };
    expect(iso(draggedEvent(standUp, { kind: "move", minutes: 0, days: 3 }, zone))).toEqual({
      start: "2026-10-26T09:30:00.000Z",
      end: "2026-10-26T09:45:00.000Z",
    });
  });
  it("keeps an off-grid time exactly on a day-only move", () => {
    const odd: CalendarEvent = {
      name: "Odd",
      start: new Date("2026-10-23T08:47:30Z"),
      end: new Date("2026-10-23T09:47:30Z"),
    };
    expect(iso(draggedEvent(odd, { kind: "move", minutes: 0, days: 3 }, zone))).toEqual({
      start: "2026-10-26T09:47:30.000Z",
      end: "2026-10-26T10:47:30.000Z",
    });
    const fiveMinute = {
      ...odd,
      start: new Date("2026-11-02T09:05:00Z"),
      end: new Date("2026-11-02T09:20:00Z"),
    };
    expect(draggedEvent(fiveMinute, { kind: "move", minutes: 0, days: 1 }, zone)?.start).toEqual(
      new Date("2026-11-03T09:05:00Z"),
    );
  });
  it("returns undefined when the drag maths rejects the gesture", () => {
    expect(
      draggedEvent(timed, { kind: "move", minutes: 30, days: MAX_DAY_DELTA + 1 }, zone),
    ).toBeUndefined();
    expect(
      draggedEvent(timed, { kind: "move", minutes: 30, days: 0 }, "Not/AZone"),
    ).toBeUndefined();
  });
});

describe("draggedEvent (all-day)", () => {
  const trip: CalendarEvent = { name: "Trip", start: "2026-11-01", end: "2026-11-04" };
  it("moves a multi-day span as a block", () => {
    expect(iso(draggedEvent(trip, { kind: "move", minutes: 0, days: 7 }, zone))).toEqual({
      start: "2026-11-08",
      end: "2026-11-11",
    });
    expect(iso(draggedEvent(trip, { kind: "move", minutes: 0, days: -6 }, zone))).toEqual({
      start: "2026-10-26",
      end: "2026-10-29",
    });
  });
  it("keeps an open end open and rejects no-ops and resizes", () => {
    const day = { name: "Day", start: "2026-11-01" };
    expect(iso(draggedEvent(day, { kind: "move", minutes: 0, days: 1 }, zone))).toEqual({
      start: "2026-11-02",
      end: undefined,
    });
    expect(draggedEvent(trip, { kind: "move", minutes: 0, days: 0 }, zone)).toBeUndefined();
    expect(draggedEvent(trip, { kind: "resize-end", minutes: 0, days: 1 }, zone)).toBeUndefined();
  });
});

describe("dropAnnouncement", () => {
  it("names the event and its new day and time", () => {
    const next = { ...timed, start: new Date("2026-11-10T14:00:00Z") };
    expect(dropAnnouncement("Planning", next, "move", zone)).toBe(
      "Moved Planning to Tue 10 Nov, 14:00",
    );
    expect(
      dropAnnouncement(
        "Planning",
        { ...timed, end: new Date("2026-11-01T15:00:00Z") },
        "resize-end",
        zone,
      ),
    ).toBe("Resized Planning to end Sun 1 Nov, 15:00");
    expect(
      dropAnnouncement(
        "Trip",
        { name: "Trip", start: "2026-11-10", end: "2026-11-12" },
        "move",
        zone,
      ),
    ).toBe("Moved Trip to Tue 10 Nov");
    // Summer time is announced in local time.
    expect(
      dropAnnouncement(
        "Planning",
        { ...timed, start: new Date("2026-07-01T13:00:00Z") },
        "move",
        zone,
      ),
    ).toBe("Moved Planning to Wed 1 Jul, 14:00");
  });
});
