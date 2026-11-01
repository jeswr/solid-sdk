// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { completedGroups } from "../../src/apps/tasks/lib/views/completed";
import { view } from "./tasks-views-fixtures";

describe("completed day groups", () => {
  const now = new Date(2026, 9, 27, 12);
  it("orders by completion, groups by local day, and labels relative and previous years", () => {
    const todayEarly = view("today early", {
      state: "closed",
      completedAt: new Date(2026, 9, 27, 1),
    });
    const todayLate = view("today late", {
      state: "closed",
      completedAt: new Date(2026, 9, 27, 11),
    });
    const yesterday = view("yesterday", {
      state: "closed",
      completedAt: new Date(2026, 9, 26, 23),
    });
    const saturday = view("Saturday", { state: "closed", completedAt: new Date(2026, 9, 24) });
    const lastYear = view("previous year", { state: "closed", completedAt: new Date(2025, 9, 25) });
    const earlier1 = view("no date1", { state: "closed" });
    const earlier2 = view("no date2", { state: "closed" });
    const tasks = [
      earlier1,
      lastYear,
      todayEarly,
      view("open", { completedAt: now }),
      earlier2,
      saturday,
      yesterday,
      todayLate,
    ];
    const before = [...tasks];
    expect(completedGroups(tasks, { page: 0 }, now)).toEqual({
      groups: [
        { dayKey: "2026-10-27", label: "Today", tasks: [todayLate, todayEarly] },
        { dayKey: "2026-10-26", label: "Yesterday", tasks: [yesterday] },
        { dayKey: "2026-10-24", label: "Sat 24 Oct", tasks: [saturday] },
        { dayKey: "2025-10-25", label: "25 Oct 2025", tasks: [lastYear] },
        { dayKey: undefined, label: "Earlier", tasks: [earlier1, earlier2] },
      ],
      hasMore: false,
    });
    expect(tasks).toEqual(before);
  });

  it("groups an occurrence after UTC midnight by its local completion day", () => {
    const task = view("copy", {
      state: "closed",
      completedAt: new Date("2026-06-30T23:30:00Z"),
      derivedFrom: "https://pod.test/task#it",
    });
    expect(completedGroups([task], { page: 0 }, new Date(2026, 6, 1, 12)).groups[0]).toEqual({
      dayKey: "2026-07-01",
      label: "Today",
      tasks: [task],
    });
  });

  it("skips invalid completion dates before pagination while retaining undated completions", () => {
    const invalid = Array.from({ length: 51 }, (_, index) =>
      view(`invalid ${index}`, { state: "closed", completedAt: new Date(Number.NaN) }),
    );
    const valid = view("valid", { state: "closed", completedAt: now });
    const undated = view("undated", { state: "closed" });
    expect(completedGroups([...invalid, undated, valid], { page: 0 }, now)).toEqual({
      groups: [
        { dayKey: "2026-10-27", label: "Today", tasks: [valid] },
        { dayKey: undefined, label: "Earlier", tasks: [undated] },
      ],
      hasMore: false,
    });
  });

  it("paginates rows after filtering and sorting, including a split day and unknown dates", () => {
    const tasks = Array.from({ length: 101 }, (_, index) =>
      view(String(index), {
        state: "closed",
        projectUrl: index % 2 === 0 ? "a" : "b",
        completedAt: new Date(2026, 9, 27, 0, index),
      }),
    );
    const unknown = view("unknown", { state: "closed", projectUrl: "a" });
    const rows = [...tasks, unknown];
    const first = completedGroups(rows, { page: 0 }, now);
    const second = completedGroups(rows, { page: 1 }, now);
    const third = completedGroups(rows, { page: 2 }, now);
    expect(first.groups[0]?.tasks).toEqual(tasks.toReversed().slice(0, 50));
    expect(first.hasMore).toBe(true);
    expect(second.groups[0]?.tasks).toEqual(tasks.toReversed().slice(50, 100));
    expect(second.hasMore).toBe(true);
    expect(third.groups.flatMap((group) => group.tasks)).toEqual([tasks[0], unknown]);
    expect(third.hasMore).toBe(false);
    expect(completedGroups(rows, { projectUrl: "a", page: 0 }, now).hasMore).toBe(true);
    expect(
      completedGroups(rows, { projectUrl: "a", page: 1 }, now).groups.flatMap(
        (group) => group.tasks,
      ),
    ).toEqual([tasks[0], unknown]);
    expect(completedGroups(rows, { projectUrl: "b", page: 0 }, now).hasMore).toBe(false);
    expect(completedGroups(rows, { projectUrl: "missing", page: 0 }, now)).toEqual({
      groups: [],
      hasMore: false,
    });
    expect(completedGroups([], { page: 0 }, now)).toEqual({ groups: [], hasMore: false });
    expect(completedGroups(rows, { page: 3 }, now)).toEqual({ groups: [], hasMore: false });
    for (const page of [-1, 1.5, Number.NaN])
      expect(() => completedGroups(rows, { page }, now)).toThrow(TypeError);
  });
});
