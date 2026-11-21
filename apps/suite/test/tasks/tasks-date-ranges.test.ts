// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  filterDateRange,
  parseDateRange,
  presetRange,
  rangeDays,
  validRange,
} from "../../src/apps/tasks/lib/views/date-ranges";
import { view } from "./tasks-views-fixtures";

const now = new Date("2026-10-24T12:00:00+01:00");
const fallback = { from: "2026-10-24", to: "2026-10-30" };

describe("inclusive calendar ranges", () => {
  it("derives every preset with calendar arithmetic and the preferred first weekday", () => {
    expect(presetRange("next7", now, "monday")).toEqual(fallback);
    expect(presetRange("next30", now, "monday")).toEqual({ from: "2026-10-24", to: "2026-11-22" });
    expect(presetRange("last7", now, "monday")).toEqual({ from: "2026-10-18", to: "2026-10-24" });
    expect(presetRange("last30", now, "monday")).toEqual({ from: "2026-09-25", to: "2026-10-24" });
    expect(presetRange("week", now, "monday")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(presetRange("week", now, "sunday")).toEqual({ from: "2026-10-18", to: "2026-10-24" });
  });
  it.each([
    "",
    "from=2026-10-24",
    "to=2026-10-30",
    "from=2026-02-30&to=2026-03-01",
    "from=garbage&to=2026-11-01",
    "from=2026-11-02&to=2026-11-01",
    "from=2026-10-24&from=2026-10-25&to=2026-10-30",
    "from=2026-10-24&to=2026-10-30&to=2026-10-31",
    "from=&to=",
  ])("falls back for invalid or ambiguous URL %s", (query) => {
    expect(parseDateRange(new URLSearchParams(query), fallback)).toBe(fallback);
  });
  it("accepts single-day, leap-day and cross-year ranges and ignores unrelated query parameters", () => {
    const query = new URLSearchParams("from=2028-02-29&to=2028-02-29&task=abc");
    expect(parseDateRange(query, fallback)).toEqual({ from: "2028-02-29", to: "2028-02-29" });
    expect(validRange({ from: "2026-12-31", to: "2027-01-02" })).toBe(true);
    expect(validRange({ from: "2026-01-01", to: "bad" })).toBe(false);
    expect(validRange({ from: "9999-12-31", to: "9999-12-31" }, 366)).toBe(true);
    expect(validRange({ from: "2026-01-02", to: "2026-01-01" }, 366)).toBe(false);
    expect(rangeDays({ from: "2026-12-31", to: "2027-01-02" })).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
  it.each([
    ["2028-01-01", "2028-12-31", "2029-01-01"],
    ["2026-03-28", "2027-03-28", "2027-03-29"],
    ["2026-10-24", "2027-10-24", "2027-10-25"],
    ["0001-01-01", "0002-01-01", "9999-12-31"],
  ])("caps bounded ranges at 366 inclusive calendar days from %s", (from, to, tooFar) => {
    const accepted = { from, to };
    const rejected = { from, to: tooFar };
    expect(validRange(accepted, 366)).toBe(true);
    expect(rangeDays(accepted)).toHaveLength(366);
    expect(validRange(rejected, 366)).toBe(false);
    expect(validRange(rejected)).toBe(true);
    expect(parseDateRange(new URLSearchParams(accepted), fallback, 366)).toEqual(accepted);
    expect(parseDateRange(new URLSearchParams(rejected), fallback, 366)).toBe(fallback);
  });
  it.each([
    [
      "2026-03-29",
      "2026-03-30",
      "2026-03-28T23:59:59Z",
      "2026-03-29T00:00:00Z",
      "2026-03-30T22:59:59Z",
      "2026-03-30T23:00:00Z",
    ],
    [
      "2026-10-25",
      "2026-10-26",
      "2026-10-24T22:59:59Z",
      "2026-10-24T23:00:00Z",
      "2026-10-26T23:59:59Z",
      "2026-10-27T00:00:00Z",
    ],
  ])("filters due and completion instants across DST from %s to %s", (from, to, before, first, last, after) => {
    const range = { from, to };
    const open = [
      view("before", { due: new Date(before) }),
      view("first", { due: new Date(first) }),
      view("last", { due: new Date(last) }),
      view("after", { due: new Date(after) }),
      view("all-day", { allDay: from, due: new Date(before) }),
      view("undated"),
      view("closed", { state: "closed", due: new Date(first) }),
    ];
    expect(filterDateRange(open, range, "upcoming").map((task) => task.title)).toEqual([
      "first",
      "last",
      "all-day",
    ]);
    const closed = open.map((task) => ({
      ...task,
      state: "closed" as const,
      completedAt: task.due,
    }));
    closed.push(view("open", { completedAt: new Date(first) }) as (typeof closed)[number]);
    expect(filterDateRange(closed, range, "completed").map((task) => task.title)).toEqual([
      "first",
      "last",
      "closed",
    ]);
    expect(rangeDays(range)).toEqual([from, to]);
  });
});
