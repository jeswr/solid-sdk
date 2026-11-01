// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { localDayKey } from "../../src/apps/tasks/lib/views/days";
import {
  agenda,
  rescheduleToDay,
  shiftWeek,
  weekStrip,
} from "../../src/apps/tasks/lib/views/upcoming";
import { view } from "./tasks-views-fixtures";

describe("Upcoming week strip and agenda", () => {
  const now = new Date(2026, 9, 24, 17);
  const first = view("today", { allDay: "2026-10-24" });
  const firstTimed = view("today timed", { due: new Date(2026, 9, 24, 18) });
  const last = view("last", { due: new Date(2026, 9, 30, 23, 59) });
  const beyond = view("beyond", { due: new Date(2026, 9, 31) });
  const overdue = view("overdue", { allDay: "2026-10-23" });
  const tasks = [
    view("none"),
    last,
    beyond,
    overdue,
    firstTimed,
    first,
    view("closed", { state: "closed", due: now }),
  ];

  it("shows seven local midnights and open counts across a DST change", () => {
    const strip = weekStrip(now, tasks, now);
    expect(strip).toHaveLength(7);
    expect(strip[0]).toEqual({
      dayKey: "2026-10-24",
      date: new Date(2026, 9, 24),
      weekdayLetter: "S",
      dayOfMonth: 24,
      count: 2,
      isToday: true,
    });
    expect(strip.map((day) => day.dayKey)).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(strip.map((day) => day.count)).toEqual([2, 0, 0, 0, 0, 0, 1]);
    expect(strip.filter((day) => day.isToday)).toHaveLength(1);
    expect(strip.every((day) => day.date.getHours() === 0)).toBe(true);
    expect(
      weekStrip(shiftWeek(now, 1), [], now).every((day) => !day.isToday && day.count === 0),
    ).toBe(true);
  });

  it("groups seven days, sorted rows, overdue only for today, and later from the eighth day", () => {
    const farther = view("farther", { allDay: "2026-11-10" });
    const result = agenda(now, [farther, ...tasks], now);
    expect(result.overdue).toEqual([overdue]);
    expect(result.days).toHaveLength(7);
    expect(result.days[0]).toEqual({
      dayKey: "2026-10-24",
      label: "Sat 24 Oct",
      tasks: [first, firstTimed],
    });
    expect(result.days[6]?.tasks).toEqual([last]);
    expect(result.days[1]?.tasks).toEqual([]);
    expect(result.later).toEqual([beyond, farther]);
    expect(agenda(shiftWeek(now, 1), tasks, now)).not.toHaveProperty("overdue");
    expect(agenda(shiftWeek(now, -1), tasks, now)).not.toHaveProperty("overdue");
    expect(agenda(now, [], now).overdue).toEqual([]);
    expect(shiftWeek(shiftWeek(now, 1), -1)).toEqual(now);
  });

  it("navigates weeks across months and years retaining local time", () => {
    expect(shiftWeek(new Date(2026, 11, 28, 17), 1)).toEqual(new Date(2027, 0, 4, 17));
    expect(shiftWeek(new Date(2026, 9, 24, 17), 1).getHours()).toBe(17);
  });
});

describe("rescheduling to a local day", () => {
  it.each([
    [new Date(2026, 2, 28, 17, 12, 13, 14), "2026-03-29"],
    [new Date(2026, 9, 24, 17, 12, 13, 14), "2026-10-25"],
  ])("keeps timed tasks' wall time across DST", (due, key) => {
    const task = view("timed", { due });
    const result = rescheduleToDay(task, key);
    expect(localDayKey(result.due)).toBe(key);
    expect([
      result.due.getHours(),
      result.due.getMinutes(),
      result.due.getSeconds(),
      result.due.getMilliseconds(),
    ]).toEqual([17, 12, 13, 14]);
    expect(result).not.toHaveProperty("allDay");
    expect(task.due).toBe(due);
  });

  it("keeps all-day tasks all-day and gives undated tasks local midnight", () => {
    const result = { due: new Date(2026, 6, 1), allDay: "2026-07-01" };
    expect(
      rescheduleToDay(
        view("all", { allDay: "2026-06-30", due: new Date(2026, 5, 30) }),
        "2026-07-01",
      ),
    ).toEqual(result);
    expect(rescheduleToDay(view("undated"), "2026-07-01")).toEqual(result);
    expect(() => rescheduleToDay(view("bad"), "2026-02-29")).toThrow(TypeError);
  });

  it("uses Date's compatible resolution for a missing or repeated wall time", () => {
    expect(
      rescheduleToDay(view("gap", { due: new Date(2026, 2, 28, 1, 30) }), "2026-03-29").due,
    ).toEqual(new Date(2026, 2, 29, 2, 30));
    expect(
      rescheduleToDay(
        view("fold", { due: new Date(2026, 9, 24, 1, 30) }),
        "2026-10-25",
      ).due.toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
  });
});
