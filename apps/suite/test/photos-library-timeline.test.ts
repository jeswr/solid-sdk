// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { groupTimeline, type TimelineUnit } from "../src/apps/photos/lib/library";

const instant = (value: string) => new Date(value);
const dateOf = (photo: { date: Date | number }) => photo.date;

describe("photo timeline", () => {
  const photos = Object.freeze([
    Object.freeze({ id: "https://example.org/photos/older", date: instant("2023-12-31T23:00Z") }),
    Object.freeze({ id: "https://example.org/photos/tie-a", date: instant("2024-02-29T12:00Z") }),
    Object.freeze({
      id: "https://example.org/photos/newer",
      date: Date.parse("2025-01-01T01:00Z"),
    }),
    Object.freeze({ id: "https://example.org/photos/tie-b", date: instant("2024-02-29T12:00Z") }),
    Object.freeze({ id: "https://example.org/photos/morning", date: instant("2024-02-29T08:00Z") }),
  ]);

  it.each([
    ["day", ["2025-01-01", "2024-02-29", "2023-12-31"]],
    ["month", ["2025-01", "2024-02", "2023-12"]],
    ["year", ["2025", "2024", "2023"]],
  ] as const)("groups by %s, newest first in UTC", (unit, keys) => {
    const groups = groupTimeline(photos, dateOf, { unit });
    expect(groups.map((group) => group.key)).toEqual(keys);
    expect(groups.map((group) => group.items)).toEqual([
      [photos[2]],
      [photos[1], photos[3], photos[4]],
      [photos[0]],
    ]);
  });

  it("sorts ascending, keeps stable ties and returns fresh arrays without changing Dates", () => {
    const times = photos.map(dateOf).map(Number);
    const groups = groupTimeline(photos, dateOf, { unit: "day", order: "ascending" });
    expect(groups.map((group) => group.items)).toEqual([
      [photos[0]],
      [photos[4], photos[1], photos[3]],
      [photos[2]],
    ]);
    groups[0]?.items.pop();
    expect(photos.map(dateOf).map(Number)).toEqual(times);
    expect(groupTimeline(photos, dateOf, { unit: "day" })[2]?.items).toEqual([photos[0]]);
  });

  it.each([
    "day",
    "month",
    "year",
  ] as TimelineUnit[])("handles the previous local year for %s", (unit) => {
    const groups = groupTimeline([instant("2025-01-01T00:30Z")], (date) => date, {
      unit,
      timeZone: "America/Los_Angeles",
    });
    expect(groups[0]?.key).toBe({ day: "2024-12-31", month: "2024-12", year: "2024" }[unit]);
  });

  it("handles positive offsets, non-hour offsets and a leap-day boundary", () => {
    const dates = [instant("2024-02-29T18:14:59Z"), instant("2024-02-29T18:15:00Z")];
    expect(
      groupTimeline(dates, (date) => date, { unit: "day", timeZone: "Asia/Kathmandu" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["2024-03-01", "2024-02-29"]);
    expect(
      groupTimeline([instant("2024-12-31T12:00Z")], (date) => date, {
        unit: "day",
        timeZone: "Pacific/Kiritimati",
      })[0]?.key,
    ).toBe("2025-01-01");
  });

  it.each([
    ["2024-03-10", ["2024-03-10T06:59Z", "2024-03-10T07:01Z"]],
    ["2024-11-03", ["2024-11-03T05:30Z", "2024-11-03T06:30Z"]],
  ])("groups across skipped/repeated DST hours on %s", (key, strings) => {
    const dates = strings.map(instant);
    expect(
      groupTimeline(dates, (date) => date, { unit: "day", timeZone: "America/New_York" }),
    ).toEqual([{ key, items: [...dates].reverse() }]);
  });

  it("keeps distinct calendar days across a 23-hour DST day", () => {
    const dates = ["2024-03-10T04:59Z", "2024-03-10T05:00Z", "2024-03-11T04:00Z"].map(instant);
    expect(
      groupTimeline(dates, (date) => date, { unit: "day", timeZone: "America/New_York" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["2024-03-11", "2024-03-10", "2024-03-09"]);
  });

  it("keeps same-month dates together, different months separate and years zero padded", () => {
    const dates = ["0001-01-01T00:00Z", "0001-01-31T12:00Z", "0001-02-01T00:00Z"].map(instant);
    expect(groupTimeline(dates, (date) => date, { unit: "month" })).toEqual([
      { key: "0001-02", items: [dates[2]] },
      { key: "0001-01", items: [dates[1], dates[0]] },
    ]);
  });

  it("handles empty inputs", () => {
    expect(groupTimeline([], dateOf, { unit: "day" })).toEqual([]);
  });

  it.each([
    new Date(Number.NaN),
    Number.NaN,
    Infinity,
    -Infinity,
    8.64e15 + 1,
  ])("rejects invalid instants (%s)", (date) =>
    expect(() => groupTimeline([{ date }], dateOf, { unit: "day" })).toThrow(RangeError));

  it.each(["0000-01-01T00:00Z", "+010000-01-01T00:00Z"])("rejects year %s", (date) => {
    expect(() => groupTimeline([instant(date)], (date) => date, { unit: "day" })).toThrow(
      RangeError,
    );
  });

  it("validates time zones even with no photos", () => {
    expect(() => groupTimeline([], dateOf, { unit: "day", timeZone: "Invalid/Zone" })).toThrow(
      RangeError,
    );
  });
});
