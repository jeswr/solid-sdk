// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { expandRecurrence, type RecurrenceInput } from "../src/apps/calendar/lib/recurrence/index";

const ms = (value: string) => Date.parse(value);
const window = { start: ms("2026-01-01T00:00:00Z"), end: ms("2031-01-01T00:00:00Z") };
const base = { start: "2026-01-01T09:00:00", timeZone: "UTC", durationMs: 3_600_000 };
function starts(input: RecurrenceInput, range = window): string[] {
  return expandRecurrence(input, range).map(({ start }) =>
    new Date(start).toISOString().replace(".000Z", "Z"),
  );
}
function dates(input: RecurrenceInput): string[] {
  return starts(input).map((value) => value.slice(0, 10));
}

describe("RRULE calendar arithmetic", () => {
  it("includes DTSTART without a rule, uses overlap windows, and preserves elapsed duration", () => {
    const result = expandRecurrence(base, {
      start: ms("2026-01-01T09:30:00Z"),
      end: ms("2026-01-01T11:00:00Z"),
    });
    expect(result).toEqual([
      { start: ms("2026-01-01T09:00:00Z"), end: ms("2026-01-01T10:00:00Z") },
    ]);
    expect(
      starts(base, { start: ms("2026-01-01T10:00:00Z"), end: ms("2026-01-02T00:00:00Z") }),
    ).toEqual([]);
    expect(
      starts(base, { start: ms("2025-01-01T00:00:00Z"), end: ms("2026-01-01T09:00:00Z") }),
    ).toEqual([]);
  });

  it("expands daily INTERVAL, COUNT, and inclusive UTC UNTIL", () => {
    expect(dates({ ...base, rrule: "rrule:freq=daily;interval=2;count=3" })).toEqual([
      "2026-01-01",
      "2026-01-03",
      "2026-01-05",
    ]);
    expect(dates({ ...base, rrule: "FREQ=DAILY;UNTIL=20260103T090000Z" })).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(dates({ ...base, rrule: "FREQ=DAILY;UNTIL=20260103T085959Z" })).toEqual([
      "2026-01-01",
      "2026-01-02",
    ]);
    expect(
      starts(
        { ...base, rrule: "FREQ=DAILY;COUNT=2" },
        { start: ms("2026-01-03T00:00:00Z"), end: ms("2026-02-01T00:00:00Z") },
      ),
    ).toEqual([]);
    expect(
      starts(
        { ...base, rrule: "FREQ=DAILY" },
        { start: ms("2026-01-03T00:00:00Z"), end: ms("2026-01-05T09:00:00Z") },
      ),
    ).toEqual(["2026-01-03T09:00:00Z", "2026-01-04T09:00:00Z"]);
  });

  it("uses DTSTART weekday by default and respects weekly interval anchors", () => {
    expect(dates({ ...base, rrule: "FREQ=WEEKLY;INTERVAL=2;COUNT=3" })).toEqual([
      "2026-01-01",
      "2026-01-15",
      "2026-01-29",
    ]);
    const seed = { ...base, start: "2026-01-06T09:00:00" };
    expect(dates({ ...seed, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;COUNT=4" })).toEqual([
      "2026-01-06",
      "2026-01-11",
      "2026-01-20",
      "2026-01-25",
    ]);
    expect(dates({ ...seed, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SU;WKST=SU;COUNT=4" })).toEqual(
      ["2026-01-06", "2026-01-18", "2026-01-20", "2026-02-01"],
    );
    expect(dates({ ...base, rrule: "FREQ=WEEKLY;BYMONTH=1;COUNT=6" })).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
      "2026-01-22",
      "2026-01-29",
      "2027-01-07",
    ]);
  });

  it("skips invalid month dates without consuming COUNT and handles leap years", () => {
    expect(dates({ ...base, start: "2026-01-31T09:00:00", rrule: "FREQ=MONTHLY;COUNT=4" })).toEqual(
      ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"],
    );
    expect(
      dates({ ...base, start: "2026-01-31T09:00:00", rrule: "FREQ=MONTHLY;INTERVAL=2;COUNT=3" }),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(dates({ ...base, start: "2028-02-29T09:00:00", rrule: "FREQ=YEARLY;COUNT=3" })).toEqual([
      "2028-02-29",
    ]);
    expect(
      starts(
        { ...base, start: "2028-02-29T09:00:00", rrule: "FREQ=YEARLY;COUNT=3" },
        { start: window.start, end: ms("2037-01-01T00:00:00Z") },
      ).map((s) => s.slice(0, 10)),
    ).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
    expect(dates({ ...base, rrule: "FREQ=YEARLY;INTERVAL=2;COUNT=3" })).toEqual([
      "2026-01-01",
      "2028-01-01",
      "2030-01-01",
    ]);
  });

  it("expands positive/negative month days and intersects BY parts", () => {
    expect(
      dates({ ...base, start: "2026-01-31T09:00:00", rrule: "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3" }),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(dates({ ...base, rrule: "FREQ=MONTHLY;BYMONTHDAY=1,-2;COUNT=4" })).toEqual([
      "2026-01-01",
      "2026-01-30",
      "2026-02-01",
      "2026-02-27",
    ]);
    expect(
      dates({ ...base, rrule: "FREQ=DAILY;BYMONTH=1;BYMONTHDAY=1,8,15;BYDAY=TH;COUNT=3" }),
    ).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
    expect(dates({ ...base, rrule: "FREQ=YEARLY;BYMONTHDAY=1;COUNT=3" })).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(dates({ ...base, rrule: "FREQ=YEARLY;BYMONTH=1,3;COUNT=4" })).toEqual([
      "2026-01-01",
      "2026-03-01",
      "2027-01-01",
      "2027-03-01",
    ]);
  });

  it("expands weekday lists and monthly ordinal weekdays", () => {
    expect(dates({ ...base, rrule: "FREQ=MONTHLY;BYDAY=MO,TH;COUNT=4" })).toEqual([
      "2026-01-01",
      "2026-01-05",
      "2026-01-08",
      "2026-01-12",
    ]);
    expect(
      dates({ ...base, start: "2026-01-30T09:00:00", rrule: "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4" }),
    ).toEqual(["2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"]);
    expect(
      dates({
        ...base,
        start: "2026-01-05T09:00:00",
        rrule: "FREQ=MONTHLY;BYDAY=+1MO,2TU;COUNT=4",
      }),
    ).toEqual(["2026-01-05", "2026-01-13", "2026-02-02", "2026-02-10"]);
    expect(
      dates({
        ...base,
        start: "2026-01-30T09:00:00",
        rrule: "FREQ=MONTHLY;BYDAY=-1FR;BYMONTHDAY=30,31;COUNT=3",
      }),
    ).toEqual(["2026-01-30", "2026-07-31", "2026-10-30"]);
  });

  it("uses yearly ordinal scope unless BYMONTH supplies month scope", () => {
    expect(
      dates({ ...base, start: "2026-05-18T09:00:00", rrule: "FREQ=YEARLY;BYDAY=20MO;COUNT=3" }),
    ).toEqual(["2026-05-18", "2027-05-17", "2028-05-15"]);
    expect(
      dates({ ...base, start: "2026-12-25T09:00:00", rrule: "FREQ=YEARLY;BYDAY=-1FR;COUNT=3" }),
    ).toEqual(["2026-12-25", "2027-12-31", "2028-12-29"]);
    expect(
      dates({
        ...base,
        start: "2026-02-02T09:00:00",
        rrule: "FREQ=YEARLY;BYMONTH=2;BYDAY=1MO;COUNT=3",
      }),
    ).toEqual(["2026-02-02", "2027-02-01", "2028-02-07"]);
    expect(dates({ ...base, rrule: "FREQ=YEARLY;BYDAY=TH;COUNT=3" })).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
  });

  it("unions RDATE, deduplicates, sorts, and applies EXDATE after COUNT", () => {
    const input = Object.freeze({
      ...base,
      rrule: "FREQ=DAILY;COUNT=3",
      rdates: Object.freeze([
        "2026-01-05T09:00:00Z",
        "2025-12-31T09:00:00",
        "2026-01-02T09:00:00",
        "2026-01-05T09:00:00Z",
      ]),
      exdates: Object.freeze([
        "2026-01-01T09:00:00Z",
        "2026-01-02T09:00:00",
        "2026-01-05T09:00:00",
      ]),
    });
    expect(dates(input)).toEqual(["2026-01-03"]);
    expect(starts(input, { start: ms("2025-12-31T00:00:00Z"), end: window.end })).toEqual([
      "2025-12-31T09:00:00Z",
      "2026-01-03T09:00:00Z",
    ]);
    expect(
      dates({
        ...base,
        rrule: "FREQ=DAILY;UNTIL=20260101T090000Z",
        rdates: ["2026-02-01T09:00:00"],
      }),
    ).toEqual(["2026-01-01", "2026-02-01"]);
    expect(dates({ ...base, rdates: ["2026-01-02T09:00:00"], exdates: [base.start] })).toEqual([
      "2026-01-02",
    ]);
  });
});

describe("Intl IANA wall-clock expansion", () => {
  it("preserves weekly wall times across spring and autumn changes", () => {
    expect(
      starts({
        ...base,
        start: "2026-03-01T09:00:00",
        timeZone: "America/New_York",
        rrule: "FREQ=WEEKLY;COUNT=3",
      }),
    ).toEqual(["2026-03-01T14:00:00Z", "2026-03-08T13:00:00Z", "2026-03-15T13:00:00Z"]);
    expect(
      starts({
        ...base,
        start: "2026-10-18T09:00:00",
        timeZone: "Europe/London",
        rrule: "FREQ=WEEKLY;COUNT=3",
      }),
    ).toEqual(["2026-10-18T08:00:00Z", "2026-10-25T09:00:00Z", "2026-11-01T09:00:00Z"]);
    expect(
      starts({
        ...base,
        start: "2026-01-30T09:00:00",
        timeZone: "Europe/London",
        rrule: "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4",
      }),
    ).toEqual([
      "2026-01-30T09:00:00Z",
      "2026-02-27T09:00:00Z",
      "2026-03-27T09:00:00Z",
      "2026-04-24T08:00:00Z",
    ]);
  });

  it("skips generated gap times without consuming COUNT", () => {
    expect(
      starts({
        ...base,
        start: "2026-03-07T02:30:00",
        timeZone: "America/New_York",
        rrule: "FREQ=DAILY;COUNT=3",
      }),
    ).toEqual(["2026-03-07T07:30:00Z", "2026-03-09T06:30:00Z", "2026-03-10T06:30:00Z"]);
    expect(
      starts({
        ...base,
        start: "2026-10-03T02:15:00",
        timeZone: "Australia/Lord_Howe",
        rrule: "FREQ=DAILY;COUNT=3",
      }),
    ).toEqual(["2026-10-02T15:45:00Z", "2026-10-04T15:15:00Z", "2026-10-05T15:15:00Z"]);
    expect(
      starts(
        {
          ...base,
          start: "2011-12-29T09:00:00",
          timeZone: "Pacific/Apia",
          rrule: "FREQ=DAILY;COUNT=3",
        },
        { start: ms("2011-12-28T00:00:00Z"), end: ms("2012-01-05T00:00:00Z") },
      ),
    ).toEqual(["2011-12-29T19:00:00Z", "2011-12-30T19:00:00Z", "2011-12-31T19:00:00Z"]);
  });

  it("chooses first fold instant; explicit UTC RDATE can include the second", () => {
    expect(
      starts({
        ...base,
        start: "2026-10-31T01:30:00",
        timeZone: "America/New_York",
        rrule: "FREQ=DAILY;COUNT=3",
        rdates: ["2026-11-01T06:30:00Z"],
      }),
    ).toEqual([
      "2026-10-31T05:30:00Z",
      "2026-11-01T05:30:00Z",
      "2026-11-01T06:30:00Z",
      "2026-11-02T06:30:00Z",
    ]);
    expect(
      starts({
        ...base,
        start: "2026-04-05T01:45:00",
        timeZone: "Australia/Lord_Howe",
        rrule: "FREQ=DAILY;COUNT=2",
      }),
    ).toEqual(["2026-04-04T14:45:00Z", "2026-04-05T15:15:00Z"]);
  });

  it("matches EXDATE by instant and tests zoned UNTIL in UTC", () => {
    expect(
      starts({
        ...base,
        start: "2026-03-07T09:00:00",
        timeZone: "America/New_York",
        rrule: "FREQ=DAILY;UNTIL=20260309T130000Z",
        exdates: ["2026-03-08T09:00:00", "2026-03-07T14:00:00Z"],
      }),
    ).toEqual(["2026-03-09T13:00:00Z"]);
    expect(starts({ ...base, timeZone: "Asia/Kathmandu", rrule: "FREQ=DAILY;COUNT=1" })).toEqual([
      "2026-01-01T03:15:00Z",
    ]);
  });

  it("uses fixed elapsed duration when an event crosses a transition", () => {
    expect(
      expandRecurrence(
        {
          ...base,
          start: "2026-03-08T01:30:00",
          timeZone: "America/New_York",
          durationMs: 7_200_000,
        },
        window,
      ),
    ).toEqual([{ start: ms("2026-03-08T06:30:00Z"), end: ms("2026-03-08T08:30:00Z") }]);
  });
});
