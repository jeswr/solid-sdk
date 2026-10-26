// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  CalendarTimeError,
  instantToWallClock,
  type OverlapChoice,
  secondaryZoneDisplay,
  wallClockToInstant,
} from "../src/apps/calendar/lib/tz";

const epoch = (value: string) => Date.parse(value);

function error(code: string) {
  return expect.objectContaining({ name: "CalendarTimeError", code });
}

describe("calendar IANA conversion", () => {
  it.each([
    ["UTC", "2024-02-29T00:00:00", "2024-02-29T00:00:00Z", 0],
    ["America/New_York", "2024-01-15T09:30:45", "2024-01-15T14:30:45Z", -300],
    ["America/New_York", "2024-07-15T09:30:45", "2024-07-15T13:30:45Z", -240],
    ["Asia/Kathmandu", "2024-05-10T10:00:00", "2024-05-10T04:15:00Z", 345],
    ["Pacific/Kiritimati", "2024-05-11T00:00:00", "2024-05-10T10:00:00Z", 840],
    ["Pacific/Pago_Pago", "2024-05-09T23:00:00", "2024-05-10T10:00:00Z", -660],
    ["UTC", "2000-01-01T00:00:00", "2000-01-01T00:00:00Z", 0],
    ["UTC", "2099-12-31T23:59:59", "2099-12-31T23:59:59Z", 0],
  ])("round-trips %s %s", (zone, wall, utc, offsetMinutes) => {
    expect(wallClockToInstant(wall, zone)).toBe(epoch(utc));
    expect(instantToWallClock(epoch(utc), zone)).toEqual({ wallTime: wall, offsetMinutes });
  });

  it.each([
    ["America/New_York", "2024-03-10T02:30:00"],
    ["Europe/London", "2024-03-31T01:00:00"],
    ["Australia/Lord_Howe", "2024-10-06T02:15:00"],
    ["Pacific/Apia", "2011-12-30T12:00:00"],
  ])("rejects gaps in %s", (zone, wall) => {
    for (const choice of [undefined, "earlier", "later"] as const) {
      expect(() => wallClockToInstant(wall, zone, choice)).toThrow(error("nonexistent-time"));
    }
  });

  it.each([
    ["America/New_York", "2024-11-03T01:30:00", "2024-11-03T05:30:00Z", "2024-11-03T06:30:00Z"],
    ["Europe/London", "2024-10-27T01:30:00", "2024-10-27T00:30:00Z", "2024-10-27T01:30:00Z"],
    ["Australia/Lord_Howe", "2024-04-07T01:45:00", "2024-04-06T14:45:00Z", "2024-04-06T15:15:00Z"],
  ])("requires an explicit overlap choice in %s", (zone, wall, earlier, later) => {
    expect(() => wallClockToInstant(wall, zone)).toThrow(error("ambiguous-time"));
    expect(wallClockToInstant(wall, zone, "earlier")).toBe(epoch(earlier));
    expect(wallClockToInstant(wall, zone, "later")).toBe(epoch(later));
  });

  it("accepts either overlap option for an unambiguous time", () => {
    expect(wallClockToInstant("2024-01-01T00:00:00", "UTC", "earlier")).toBe(epoch("2024-01-01Z"));
    expect(wallClockToInstant("2024-01-01T00:00:00", "UTC", "later")).toBe(epoch("2024-01-01Z"));
  });

  it.each([
    "2024-02-30T12:00:00",
    "2023-02-29T12:00:00",
    "2024-13-01T00:00:00",
    "2024-01-01T24:00:00",
    "2024-01-01T00:60:00",
    "2024-01-01T00:00:60",
    "2024-01-01",
    "2024-01-01T00:00:00Z",
    "2024-01-01T00:00:00.001",
    "1999-12-31T23:59:59",
    "2100-01-01T00:00:00",
    null,
  ])("rejects unsupported wall input %s", (wall) => {
    expect(() => wallClockToInstant(wall as string, "UTC")).toThrow(error("invalid-wall-time"));
  });

  it.each([
    NaN,
    Infinity,
    0,
    1.5,
    epoch("2024-01-01Z") + 1,
    epoch("2100-01-01Z"),
    null,
  ])("rejects unsupported instant %s", (value) => {
    expect(() => instantToWallClock(value as number, "UTC")).toThrow(error("invalid-instant"));
  });

  it.each(["", "Not/A_Zone", "+01:00", "-0500", undefined])("rejects zone %s", (zone) => {
    expect(() => instantToWallClock(epoch("2024-01-01Z"), zone as string)).toThrow(
      error("invalid-zone"),
    );
    expect(() => wallClockToInstant("2024-01-01T00:00:00", zone as string)).toThrow(
      error("invalid-zone"),
    );
  });

  it("rejects unknown disambiguation and boundary conversions", () => {
    expect(() =>
      wallClockToInstant("2024-01-01T00:00:00", "UTC", "compatible" as OverlapChoice),
    ).toThrow(error("invalid-option"));
    expect(() => wallClockToInstant("2000-01-01T00:00:00", "Asia/Tokyo")).toThrow(
      error("invalid-instant"),
    );
    expect(() => instantToWallClock(epoch("2000-01-01Z"), "America/New_York")).toThrow(
      error("invalid-wall-time"),
    );
  });

  it("exposes a typed error without including caller data", () => {
    const failure = new CalendarTimeError("invalid-zone");
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("Calendar time: invalid-zone");
  });
});

describe("secondary-zone display", () => {
  it("returns signed offset differences and local calendar dates", () => {
    expect(
      secondaryZoneDisplay(epoch("2024-05-10T22:30:00Z"), "America/New_York", "Asia/Kathmandu"),
    ).toEqual({
      primary: { wallTime: "2024-05-10T18:30:00", offsetMinutes: -240 },
      wallTime: "2024-05-11T04:15:00",
      offsetMinutes: 345,
      differenceMinutes: 585,
      dayOffset: 1,
    });
    expect(
      secondaryZoneDisplay(
        epoch("2024-05-10T10:00:00Z"),
        "Pacific/Kiritimati",
        "Pacific/Pago_Pago",
      ),
    ).toMatchObject({ differenceMinutes: -1500, dayOffset: -2 });
  });

  it("recalculates offsets at each instant across distinct DST calendars", () => {
    expect(
      secondaryZoneDisplay(epoch("2024-03-01Z"), "America/New_York", "Europe/London")
        .differenceMinutes,
    ).toBe(300);
    expect(
      secondaryZoneDisplay(epoch("2024-03-20Z"), "America/New_York", "Europe/London")
        .differenceMinutes,
    ).toBe(240);
    expect(
      secondaryZoneDisplay(epoch("2024-04-01Z"), "America/New_York", "Europe/London")
        .differenceMinutes,
    ).toBe(300);
    expect(secondaryZoneDisplay(epoch("2024-04-01Z"), "UTC", "UTC")).toMatchObject({
      differenceMinutes: 0,
      dayOffset: 0,
    });
  });
});
