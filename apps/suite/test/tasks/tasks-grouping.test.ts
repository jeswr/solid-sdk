// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { type GroupContext, groupTasks } from "../../src/apps/tasks/lib/views/grouping";
import {
  defaultPreferences,
  parsePreferences,
  preferencesReducer,
} from "../../src/apps/tasks/state/preferences-reducer";
import { view } from "./tasks-views-fixtures";

const context: GroupContext = {
  now: new Date("2026-11-04T12:00:00Z"),
  weekStart: "monday",
  labels: new Map([
    ["one", "Work"],
    ["two", "work"],
    ["three", "Admin"],
  ]),
};
const names = (groups: ReturnType<typeof groupTasks>) => groups.map((group) => group.title);

describe("task grouping", () => {
  it("keeps ungrouped input immutable and sorts inside every group", () => {
    const tasks = [view("Zulu"), view("Alpha")];
    expect(groupTasks([], "none", context)).toEqual([]);
    expect(groupTasks(tasks, "none", context)[0]?.tasks).toEqual(tasks);
    expect(groupTasks(tasks, "none", context, "name")[0]?.tasks.map((task) => task.title)).toEqual([
      "Alpha",
      "Zulu",
    ]);
    expect(tasks.map((task) => task.title)).toEqual(["Zulu", "Alpha"]);
  });
  it("orders due headers, honours all-day dates, and handles the end of the week", () => {
    const tasks = [
      view("No date"),
      view("Later", { allDay: "2026-11-09" }),
      view("Sunday", { allDay: "2026-11-08" }),
      view("Friday", { allDay: "2026-11-06" }),
      view("Tomorrow", { due: new Date("2026-11-05T17:00:00Z") }),
      view("Today", { allDay: "2026-11-04", due: new Date("2026-11-05T00:00:00Z") }),
      view("Overdue", { allDay: "2026-11-03" }),
    ];
    expect(names(groupTasks(tasks, "due", context))).toEqual([
      "Overdue",
      "Today",
      "Tomorrow",
      "This week",
      "Later",
      "No date",
    ]);
    expect(groupTasks(tasks, "due", context, "name")[3]?.tasks.map((task) => task.title)).toEqual([
      "Friday",
      "Sunday",
    ]);
    const sunday = { ...context, now: new Date("2026-11-08T12:00:00Z") };
    expect(names(groupTasks([view("Next week", { allDay: "2026-11-09" })], "due", sunday))).toEqual(
      ["Tomorrow"],
    );
    expect(
      names(
        groupTasks([view("Sun", { allDay: "2026-11-08" })], "due", {
          ...context,
          weekStart: "sunday",
        }),
      ),
    ).toEqual(["Later"]);
  });
  it("orders priorities P1–P4 and composes manual, name and due sorts", () => {
    const tasks = [
      view("last", { priority: 4 }),
      view("B", { priority: 1, position: 2 }),
      view("A", { priority: 1, position: 1 }),
      view("P3", { priority: 3 }),
      view("P2", { priority: 2 }),
    ];
    const groups = groupTasks(tasks, "priority", context, "manual");
    expect(names(groups)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(groups[0]?.tasks.map((task) => task.title)).toEqual(["A", "B"]);
    expect(
      groupTasks(
        [
          view("late", { due: new Date("2026-11-05Z") }),
          view("early", { due: new Date("2026-11-04Z") }),
        ],
        "priority",
        context,
        "due",
      )[0]?.tasks[0]?.title,
    ).toBe("early");
  });
  it("unions labels by name, uses the first alphabetical label for multi-labelled tasks, and puts missing labels last", () => {
    const tasks = [
      view("none"),
      view("one", { labelIds: ["one", "two", "three", "unknown"] }),
      view("two", { labelIds: ["one"] }),
      view("unknown", { labelIds: ["unknown"] }),
    ];
    const groups = groupTasks(tasks, "label", context, "name");
    expect(names(groups)).toEqual(["Admin", "Work", "No label"]);
    expect(groups.map((group) => group.tasks.length)).toEqual([1, 1, 2]);
    expect(
      names(
        groupTasks([view("empty", { labelIds: ["empty"] })], "label", {
          ...context,
          labels: new Map([["empty", ""]]),
        }),
      ),
    ).toEqual(["No label"]);
  });
  it("orders projects alphabetically with stable URL ties and assignees with Unassigned last", () => {
    const tasks = [
      view("B", { projectTitle: "Zebra", projectUrl: "z", assignee: "https://z.example/#me" }),
      view("A2", { projectTitle: "Alpha", projectUrl: "b", assignee: "https://a.example/#me" }),
      view("A", { projectTitle: "Alpha", projectUrl: "a" }),
      view("missing"),
    ];
    expect(groupTasks(tasks, "project", context).map((group) => group.id)).toEqual([
      "a",
      "b",
      tasks[3]?.projectUrl,
      "z",
    ]);
    expect(names(groupTasks(tasks, "assignee", context))).toEqual([
      "https://a.example/#me",
      "https://z.example/#me",
      "Unassigned",
    ]);
  });
});

it("validates and round-trips per-view grouping preferences without losing sort", () => {
  const state = preferencesReducer(defaultPreferences, {
    type: "groupBy",
    viewId: "/tasks/today",
    value: "priority",
  });
  const sorted = preferencesReducer(state, { type: "sort", viewId: "/tasks/today", value: "name" });
  expect(parsePreferences(JSON.stringify(sorted))).toMatchObject({
    groupBy: { "/tasks/today": "priority" },
    sort: { "/tasks/today": "name" },
  });
  expect(
    parsePreferences(
      JSON.stringify({
        groupBy: {
          invalid: "section",
          ...Object.fromEntries(
            ["none", "due", "priority", "project", "label", "assignee"].map((value) => [
              value,
              value,
            ]),
          ),
        },
      }),
    ).groupBy,
  ).toEqual(
    Object.fromEntries(
      ["none", "due", "priority", "project", "label", "assignee"].map((value) => [value, value]),
    ),
  );
  expect(parsePreferences(null).groupBy).toEqual({});
  expect(parsePreferences('{"sort":{}}').groupBy).toEqual({});
  expect(parsePreferences('{"groupBy":[]}').groupBy).toEqual({});
});
