// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  compareDue,
  overdueCount,
  taskDayKey,
  todayCount,
  todayGroups,
} from "../../src/apps/tasks/lib/views/today";
import { view } from "./tasks-views-fixtures";

describe("Today and overdue across projects", () => {
  const now = new Date(2026, 6, 1, 12);

  it("includes subtasks, uses all-day markers, and excludes undated, closed and future tasks", () => {
    const yesterday = view("yesterday", { due: new Date(2026, 5, 30, 23, 59) });
    // Persisted midnight from a different zone falls on yesterday locally.
    const allDay = view("all day", {
      allDay: "2026-07-01",
      due: new Date("2026-06-30T10:00:00Z"),
      position: 5,
    });
    const child = view("subtask", {
      due: new Date(2026, 6, 1, 17),
      parentId: "https://pod.test/parent#it",
      projectUrl: "https://other.test/project",
    });
    const tasks = [
      child,
      view("closed", { state: "closed", due: now }),
      yesterday,
      allDay,
      view("undated"),
      view("future", { allDay: "2026-07-02" }),
    ];
    const before = [...tasks];
    expect(todayGroups(tasks, now)).toEqual({ overdue: [yesterday], today: [allDay, child] });
    expect(todayCount(tasks, now)).toBe(3);
    expect(overdueCount(tasks, now)).toBe(1);
    expect(tasks).toEqual(before);
    expect(todayGroups([], now)).toEqual({ overdue: [], today: [] });
    expect(todayCount([], now)).toBe(0);
  });

  it("sorts overdue ascending and today's all-day/time ties by position, absent last", () => {
    const old = view("old", { allDay: "2026-06-28", due: new Date(2026, 6, 1) });
    const recent = view("recent", { due: new Date(2026, 5, 30, 10) });
    const allDay1 = view("all1", { allDay: "2026-07-01", position: 1 });
    const allDay2 = view("all2", { allDay: "2026-07-01", position: 2 });
    const allDayMissing = view("all missing", { allDay: "2026-07-01" });
    const midnight = view("midnight", { due: new Date(2026, 6, 1), position: 0 });
    const morning1 = view("morning1", { due: new Date(2026, 6, 1, 9), position: 1 });
    const morning2 = view("morning2", { due: new Date(2026, 6, 1, 9), position: 2 });
    const morningMissing = view("morning missing", { due: new Date(2026, 6, 1, 9) });
    const evening = view("evening", { due: new Date(2026, 6, 1, 19) });
    const expected = [
      allDay1,
      allDay2,
      allDayMissing,
      midnight,
      morning1,
      morning2,
      morningMissing,
      evening,
    ];
    expect(todayGroups([recent, ...expected.toReversed(), old], now)).toEqual({
      overdue: [old, recent],
      today: expected,
    });
    expect(compareDue(midnight, allDay1)).toBeGreaterThan(0);
    expect(compareDue(allDayMissing, allDay1)).toBeGreaterThan(0);
    expect(compareDue(view("a"), view("b"))).toBe(0);
    expect(taskDayKey(view("none"))).toBeUndefined();
  });

  it("treats elapsed times today as today, with midnight boundaries across DST", () => {
    const time = new Date(2026, 9, 25, 17);
    const midnight = view("midnight", { due: new Date(2026, 9, 25) });
    const before = view("before", { due: new Date(2026, 9, 24, 23, 59, 59, 999) });
    const tomorrow = view("after", { due: new Date(2026, 9, 26) });
    expect(todayGroups([tomorrow, before, midnight], time)).toEqual({
      overdue: [before],
      today: [midnight],
    });
  });
});
