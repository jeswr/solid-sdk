// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { calendarDate, parseRecurrence } from "./recurrence.js";

describe("VOC-01 recurrence mapping", () => {
  it("maps weekday IRIs, signed month days, months and typed limits", () => {
    expect(
      parseRecurrence([
        "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=10;BYDAY=MO,WE;BYMONTHDAY=1,-1;BYMONTH=1,6",
        "EXDATE;VALUE=DATE:20260101,20260601",
        "RRULE:FREQ=YEARLY;UNTIL=20301231",
      ]),
    ).toEqual([
      {
        frequency: "MONTHLY",
        interval: 2,
        count: 10,
        byDay: ["MO", "WE"],
        byMonthDay: [1, -1],
        byMonth: [1, 6],
        exceptDate: ["2026-01-01", "2026-06-01"],
      },
      {
        frequency: "YEARLY",
        until: "2030-12-31",
        byDay: [],
        byMonthDay: [],
        byMonth: [],
        exceptDate: ["2026-01-01", "2026-06-01"],
      },
    ]);
  });

  it("preserves UTC and rule-local exception timestamps with their time zone", () => {
    const [rule] = parseRecurrence(
      [
        "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z",
        "EXDATE:20260611T080000Z",
        "EXDATE;TZID=Europe/London:20260612T090000",
      ],
      "Europe/London",
    );
    expect(rule.until).toBe("2026-12-31T23:59:59Z");
    expect(rule.exceptDate).toEqual(["2026-06-11T08:00:00Z", "2026-06-12T09:00:00"]);
    expect(parseRecurrence([])).toEqual([]);
  });

  it.each([
    "RRULE:FREQ=MONTHLY;BYDAY=2MO",
    "RDATE:20260611",
    "EXRULE:FREQ=DAILY",
    "RRULE:FREQ=WEEKLY;WKST=SU",
    "RRULE:COUNT=2",
    "RRULE:FREQ=INVALID",
    "RRULE:FREQ=DAILY;COUNT=0",
    "RRULE:FREQ=DAILY;INTERVAL=-1",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=32",
    "RRULE:FREQ=YEARLY;BYMONTH=13",
    "RRULE:FREQ=DAILY;COUNT=2;UNTIL=20261231",
    "RRULE:FREQ=DAILY;COUNT=2;COUNT=3",
    "RRULE:FREQ=DAILY;INTERVAL=1.5",
    "RRULE:FREQ=DAILY;COUNT=9007199254740992",
    "RRULE:FREQ=DAILY;UNTIL=20260230",
    "RRULE:FREQ=DAILY;UNTIL=bad",
    "RRULE:FREQ=DAILY;UNTIL=20260611T990000Z",
    "RRULE:FREQ=DAILY=EXTRA",
    "RRULE:FREQ=DAILY;=1",
    "RRULE",
    "RRULE:",
    "EXDATE:20260101",
    "EXDATEBAD:20260611",
    "EXDATE;TZID=America/New_York:20260611T090000",
    "EXDATE;VALUE=INVALID:20260611",
  ])("rejects unsupported or malformed recurrence: %s", (line) => {
    expect(() => parseRecurrence([line])).toThrow(/recurrence/);
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-06-11T99:00:00Z",
    "invalid",
  ])("rejects invalid dates: %s", (value) => {
    expect(() => calendarDate(value)).toThrow(/recurrence/);
  });
});
