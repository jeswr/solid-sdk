// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../src/apps/calendar/lib/model";
import {
  layoutMonth,
  monthBarLabel,
  monthEventRange,
} from "../src/apps/calendar/state/month-layout";
import type { Occurrence } from "../src/apps/calendar/state/view";

function event(id: string, start: string | Date, end?: string | Date): Occurrence {
  return {
    id,
    url: `https://pod.example/${id}`,
    etag: null,
    data: { name: id, start, end },
    calendar: {
      url: "https://pod.example/calendar",
      title: "Personal",
      colour: "var(--app-calendar)",
      container: "https://pod.example/",
      etag: null,
    },
  };
}
const timed = (id: string, day: number, hour: number) => event(id, new Date(2026, 10, day, hour));

describe("month occurrence layout", () => {
  it("splits at week boundaries, clips the grid, and preserves continuation ends", () => {
    const trip = event("Trip", "2026-10-24", "2026-11-12");
    const rows = layoutMonth([trip], 2026, 11, 1, 2);
    expect(rows.map((row) => row.bars.length)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(rows[0]?.bars[0]).toMatchObject({
      column: 0,
      span: 7,
      lane: 0,
      continuesBefore: true,
      continuesAfter: true,
      event: trip,
    });
    expect(rows[1]?.bars[0]).toMatchObject({
      column: 0,
      span: 7,
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(rows[2]?.bars[0]).toMatchObject({
      column: 0,
      span: 3,
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(
      rows.flatMap((row) => row.days).find((day) => day.date === "2026-11-12")?.events,
    ).toEqual([]);
  });

  it("reuses lanes for touching spans and packs overlapping all-day and timed spans together", () => {
    const events = [
      event("Long", "2026-11-02", "2026-11-05"),
      event("Short", "2026-11-03", "2026-11-04"),
      event("Later", "2026-11-05"),
      event("Overnight", new Date(2026, 10, 4, 23), new Date(2026, 10, 6, 1)),
    ];
    const row = layoutMonth(events, 2026, 11, 1, 4)[1];
    expect(row?.bars.map(({ id, lane, span }) => ({ id, lane, span }))).toEqual([
      { id: "Long", lane: 0, span: 3 },
      { id: "Short", lane: 1, span: 1 },
      { id: "Overnight", lane: 1, span: 3 },
      { id: "Later", lane: 0, span: 1 },
    ]);
    expect(layoutMonth([...events].reverse(), 2026, 11, 1, 4).map((row) => row.bars)).toEqual(
      layoutMonth(events, 2026, 11, 1, 4).map((row) => row.bars),
    );
  });

  it("puts bars before timed events and counts every hidden occurrence on each covered day", () => {
    const events = [
      timed("Late", 3, 16),
      timed("Early", 3, 8),
      event("Trip", "2026-11-02", "2026-11-05"),
      event("Other", "2026-11-02", "2026-11-05"),
      event("Hidden", "2026-11-02", "2026-11-04"),
    ];
    const row = layoutMonth(events, 2026, 11, 1, 2)[1];
    expect(row?.bars).toHaveLength(2);
    expect(row?.days[0]?.hidden).toBe(1);
    expect(row?.days[1]).toMatchObject({ timed: [], hidden: 3 });
    expect(row?.days[2]?.hidden).toBe(0);
    const mixed = layoutMonth(
      [events[2] as Occurrence, timed("Late", 3, 16), timed("Early", 3, 8)],
      2026,
      11,
      1,
      2,
    )[1];
    expect(mixed?.days[1]?.timed.map((event) => event.id)).toEqual(["Early"]);
    expect(mixed?.days[1]?.hidden).toBe(1);
    expect(mixed?.days[2]?.hidden).toBe(0);
  });

  it("orders tied timed events deterministically, leaves empty weeks empty and honours Sunday start", () => {
    const events = [timed("B", 1, 9), timed("A", 1, 9), timed("C", 1, 10)];
    const rows = layoutMonth(events, 2026, 11, 0, 2);
    expect(rows[0]?.startDate).toBe("2026-11-01");
    expect(rows[0]?.days[0]?.timed.map((event) => event.id)).toEqual(["A", "B"]);
    expect(rows[0]?.days[0]?.hidden).toBe(1);
    expect(rows[1]).toMatchObject({ barLanes: 0, bars: [] });
    expect(
      layoutMonth([], 2026, 11, 1, 2).every((row) => row.days.every((day) => day.hidden === 0)),
    ).toBe(true);
  });

  it("uses empty day columns for timed events without shifting a continued bar's lane", () => {
    const rows = layoutMonth(
      [
        event("Sunday A", "2026-11-01"),
        event("Sunday B", "2026-11-01"),
        event("Monday meeting", new Date(2026, 9, 26, 9)),
      ],
      2026,
      11,
      1,
      2,
    );
    expect(rows[0]?.barLanes).toBe(2);
    expect(rows[0]?.days[0]).toMatchObject({ barLanes: 0, hidden: 0 });
    expect(rows[0]?.days[0]?.timed.map((event) => event.id)).toEqual(["Monday meeting"]);
    expect(rows[0]?.days[6]).toMatchObject({ barLanes: 2, hidden: 0, timed: [] });
  });

  it.each([
    [new Date(2026, 2, 28, 23), new Date(2026, 2, 30), "2026-03-28", "2026-03-30", 3],
    [new Date(2026, 9, 24, 23), new Date(2026, 9, 26), "2026-10-24", "2026-10-26", 10],
  ] as const)("uses civil days through a DST change (%s)", (start, end, from, to, month) => {
    const item = event("DST", start, end);
    expect(monthEventRange(item.data)).toEqual({ startDate: from, endDate: to });
    const days = layoutMonth([item], 2026, month, 1, 2)
      .flatMap((row) => row.days)
      .filter((day) => day.events.length);
    expect(days.map((day) => day.date)).toEqual([
      from,
      to === "2026-03-30" ? "2026-03-29" : "2026-10-25",
    ]);
    expect(
      layoutMonth([item], 2026, month, 1, 2)
        .flatMap((row) => row.bars)
        .reduce((sum, bar) => sum + bar.span, 0),
    ).toBe(2);
  });

  it("handles exclusive midnight ends, missing ends, and a zero-duration timed event", () => {
    expect(monthEventRange({ name: "All day", start: "2026-11-03" })).toEqual({
      startDate: "2026-11-03",
      endDate: "2026-11-04",
    });
    const start = new Date(2026, 10, 3, 8);
    expect(monthEventRange({ name: "Zero", start, end: start })).toEqual({
      startDate: "2026-11-03",
      endDate: "2026-11-04",
    });
    const midnight = event("Midnight", start, new Date(2026, 10, 4));
    const row = layoutMonth([midnight], 2026, 11, 1, 2)[1];
    expect(row?.bars).toEqual([]);
    expect(row?.days[1]?.timed).toEqual([midnight]);
    expect(row?.days[2]?.events).toEqual([]);
    expect(
      monthEventRange({
        name: "Non-date end",
        start: "2026-11-03",
        end: new Date(2026, 10, 4),
      } as CalendarEvent).endDate,
    ).toBe("2026-11-04");
  });

  it("names bars with their full inclusive date range, including month and year boundaries", () => {
    expect(monthBarLabel({ name: "Trip", start: "2026-11-02", end: "2026-11-05" })).toBe(
      "Trip, Mon 2 Nov 2026 – Wed 4 Nov 2026",
    );
    expect(monthBarLabel({ name: "Day", start: "2026-11-02" })).toBe("Day, Mon 2 Nov 2026");
    expect(monthBarLabel({ name: "New Year", start: "2026-12-31", end: "2027-01-02" })).toContain(
      "Thu 31 Dec 2026 – Fri 1 Jan 2027",
    );
  });
});
