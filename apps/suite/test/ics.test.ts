// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type CalendarEvent,
  escapeText,
  exportICal,
  foldLine,
  importICal,
  type Reminder,
  unescapeText,
} from "../src/apps/calendar/lib/ics";
import { baseEvent, roundTrips, source } from "./fixtures/ics/round-trips";

const start = "DTSTART:20261025T090000Z";
function exported(changes: Partial<CalendarEvent>): string {
  return exportICal({ events: [{ ...baseEvent, ...changes }] });
}
function parsed(lines: string[]) {
  return importICal(source(lines));
}

describe("synthetic RFC 5545 fixtures", () => {
  it.each(roundTrips)("$name", ({ text, expected }) => {
    expect(importICal(text)).toEqual({ events: [expected] });
    const result = exportICal({ events: [expected] });
    expect(importICal(result)).toEqual({ events: [expected] });
    expect(exportICal(importICal(result))).toBe(result);
  });
  it("has twenty independently authored wire fixtures", () => expect(roundTrips).toHaveLength(20));
  it("serializes several events and an empty calendar", () => {
    expect(importICal(exportICal({ events: roundTrips.map((f) => f.expected) })).events).toEqual(
      roundTrips.map((f) => f.expected),
    );
    expect(importICal(exportICal({ events: [] }))).toEqual({ events: [] });
  });
});

describe("content lines", () => {
  it("escapes text once, normalizes newlines, and keeps literal escape sequences", () => {
    expect(escapeText("a\r\nb\rc\nd,;\\n")).toBe("a\\nb\\nc\\nd\\,\\;\\\\n");
    expect(unescapeText("a\\Nb\\n\\;\\,\\\\\\q")).toBe("a\nb\n;,\\\\q");
    const name = "\\n; ,\nEND:VEVENT\nBEGIN:VEVENT";
    expect(importICal(exported({ name })).events[0]?.name).toBe(name);
  });
  it("folds UTF-8 at 75 bytes and preserves whitespace and complete code points", () => {
    for (const value of [
      "x".repeat(75),
      "x".repeat(76),
      "🌍é漢字".repeat(100),
      " a ".repeat(100),
    ]) {
      const line = foldLine(`DESCRIPTION:${value}`);
      expect(line.split("\r\n").every((part) => Buffer.byteLength(part) <= 75)).toBe(true);
      expect(importICal(exported({ description: value })).events[0]?.description).toBe(value);
      expect(line.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${value}`);
    }
    expect(foldLine("")).toBe("");
    expect(() => foldLine("A\nB")).toThrow("raw newline");
  });
  it("accepts BOM, LF, case-insensitive names, and optional summary", () => {
    const text = source([start])
      .replace("SUMMARY:Morgan's gathering\r\n", "")
      .replaceAll("\r\n", "\n")
      .replace("BEGIN:VCALENDAR", "begin:vcalendar");
    expect(importICal(`\uFEFF${text}`).events[0]?.name).toBe("");
  });
  it("isolates alarms and ignores unrelated components and properties", () => {
    const text = source([
      start,
      "X-EXAMPLE:keep out",
      "BEGIN:X-CHILD",
      "SUMMARY:Wrong",
      "DTSTART:garbage",
      "END:X-CHILD",
    ]).replace("END:VCALENDAR", "BEGIN:VTODO\r\nSUMMARY:Ignore\r\nEND:VTODO\r\nEND:VCALENDAR");
    expect(importICal(text).events).toEqual([baseEvent]);
  });
  it("retains opaque timezone definitions with nested observances and parameters", () => {
    const timezone = [
      "BEGIN:VTIMEZONE",
      "TZID:Custom/Example",
      'X-INFO;LANGUAGE="en":Fictional',
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");
    const calendar = { events: [baseEvent], timezones: [timezone] };
    expect(importICal(exportICal(calendar))).toEqual(calendar);
    expect(() => exportICal({ events: [], timezones: ["BEGIN:VEVENT\nEND:VEVENT"] })).toThrow(
      "VTIMEZONE",
    );
  });
  it.each([
    "",
    "BEGIN:VCALENDAR",
    "END:VCALENDAR",
    "BEGIN:VCALENDAR\nEND:VEVENT",
    "BEGIN:VCALENDAR\nEND:VCALENDAR\nBEGIN:VCALENDAR\nEND:VCALENDAR",
    "VERSION:2.0\nBEGIN:VCALENDAR\nEND:VCALENDAR",
    "BEGIN:VEVENT\nEND:VEVENT",
    "BEGIN:VCALENDAR\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nVERSION:1.0\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:x\nBAD\nEND:VCALENDAR",
    'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID;x="unterminated:value\nEND:VCALENDAR',
    "BEGIN:VCALENDAR\nVERSION:2.0\n:bad\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nVERSION:2.0\nBAD NAME:x\nEND:VCALENDAR",
  ])("rejects malformed structure %#", (text) =>
    expect(() => importICal(text)).toThrow("Invalid iCalendar"));
  it.each([
    "DTSTART;BAD:20261025T090000Z",
    "DTSTART;X=:20261025T090000Z",
    "DTSTART;X=1;X=2:20261025T090000Z",
    "DTSTART;X*=1:20261025T090000Z",
  ])("rejects malformed parameters %s", (line) => expect(() => parsed([line])).toThrow());
  it.each([
    'DTSTART;X="valid"junk:20261025T090000Z',
    'DTSTART;X=bad"quotes":20261025T090000Z',
    "DTSTART;;X=valid:20261025T090000Z",
    "DTSTART;:20261025T090000Z",
  ])("rejects ambiguous parameter syntax %s", (line) => expect(() => parsed([line])).toThrow());
  it.each(["UID", "DTSTAMP", "DTSTART"])("rejects missing %s", (name) =>
    expect(() =>
      importICal(source([start]).replace(new RegExp(`${name}:[^\\r]+\\r\\n`), "")),
    ).toThrow());
  it.each([
    "UID:other@example.org",
    start,
    "SUMMARY:duplicate",
    "RRULE:FREQ=DAILY\r\nRRULE:FREQ=WEEKLY",
  ])("rejects duplicate singleton %s", (line) => expect(() => parsed([start, line])).toThrow());
});

describe("date values", () => {
  it.each([
    { start: "2000-02-29" },
    { start: "0000-02-29" },
    { start: "2026-12-31T23:59:60Z" },
    { start: "2026-10-25T09:00:00", tzid: "Custom, East" },
    { end: "2026-10-25T09:00:00", endTzid: "Europe/Paris" },
    { start: "2026-10-25T09:00:00", end: "2026-10-25T08:00:00Z" },
  ])("preserves explicit clocks %#", (changes) =>
    expect(importICal(exported(changes)).events[0]).toEqual({ ...baseEvent, ...changes }));
  it.each([
    "DTSTART;VALUE=DATE:19000229",
    "DTSTART;VALUE=DATE:20260229",
    "DTSTART;VALUE=DATE:20260431",
    "DTSTART;VALUE=DATE:20260001",
    "DTSTART;VALUE=DATE:20261301",
    "DTSTART;VALUE=DATE:20260100",
    "DTSTART:20261025T240000Z",
    "DTSTART:20261025T096000Z",
    "DTSTART:20261025T090061Z",
    "DTSTART:20261025",
    "DTSTART;VALUE=DATE:20261025T090000Z",
    "DTSTART;VALUE=PERIOD:20261025T090000Z",
    "DTSTART;TZID=Europe/London:20261025T090000Z",
    "DTSTART;VALUE=DATE;TZID=Europe/London:20261025",
    'DTSTART;TZID="":20261025T090000',
    "DTSTAMP:20260101T000000",
    "EXDATE;VALUE=DATE:20261025",
    "RDATE;VALUE=PERIOD:20261025T090000Z/PT1H",
    "DTEND;VALUE=DATE:20261026",
    "DTEND:20261025T090000Z",
    "DTEND:20261025T080000Z",
    "DURATION:PT1H",
    "RECURRENCE-ID:20261025T090000Z",
  ])("rejects invalid or unsupported date %s", (line) =>
    expect(() => parsed([...(line.startsWith("DTSTART") ? [] : [start]), line])).toThrow());
  it.each([
    { start: "bad" },
    { start: "2026-10-25T09:00:00+01:00" },
    { tzid: "Europe/London" },
    { tzid: "bad\nTZID" },
    { start: "2026-10-25T09:00:00", tzid: 'bad"zone' },
    { dtstamp: "2026-10-25" },
    { uid: "" },
    { endTzid: "Europe/London" },
    { recurrence: { frequency: "DAILY" }, exceptDate: [] },
  ])("rejects invalid model dates %#", (changes) => expect(() => exported(changes)).toThrow());
});

describe("recurrence rules", () => {
  it.each([
    "FREQ=YEARLY;BYWEEKNO=-1,1;BYDAY=MO;BYSETPOS=-1;WKST=MO",
    "FREQ=YEARLY;BYYEARDAY=1,-366",
    "FREQ=MONTHLY;BYDAY=1MO",
    "FREQ=YEARLY;BYDAY=53MO",
    "FREQ=SECONDLY;BYSECOND=0,60;BYMINUTE=0,59;BYHOUR=0,23",
    "FREQ=MINUTELY;INTERVAL=1;COUNT=2",
    "FREQ=HOURLY;BYSETPOS=1;BYMINUTE=30",
    "freq=daily;until=20261031T090000Z",
  ])("round-trips selectors %s", (rule) => {
    const calendar = parsed([start, `RRULE:${rule}`]);
    expect(importICal(exportICal(calendar))).toEqual(calendar);
  });
  it.each([
    "BYSECOND=1",
    "BYMINUTE=1",
    "BYHOUR=1",
  ])("rejects clock selectors for DATE %s", (selector) => {
    expect(() => parsed(["DTSTART;VALUE=DATE:20261025", `RRULE:FREQ=DAILY;${selector}`])).toThrow(
      "clock selectors",
    );
  });
  it("keeps floating UNTIL and requires UTC UNTIL for TZID DTSTART", () => {
    expect(
      parsed(["DTSTART:20261025T090000", "RRULE:FREQ=DAILY;UNTIL=20261101T090000"]).events[0]
        ?.recurrence?.until,
    ).toBe("2026-11-01T09:00:00");
    expect(
      parsed([
        "DTSTART;TZID=Europe/London:20261025T090000",
        "RRULE:FREQ=DAILY;UNTIL=20261101T090000Z",
      ]).events[0]?.tzid,
    ).toBe("Europe/London");
  });
  it.each([
    "FREQ=DAILY;UNTIL=20261101",
    "FREQ=DAILY;UNTIL=20261101T090000",
    "FREQ=BAD",
    "COUNT=2",
    "FREQ=DAILY;COUNT=2;UNTIL=20261101T090000Z",
    "FREQ=DAILY;COUNT=0",
    "FREQ=DAILY;INTERVAL=-1",
    "FREQ=DAILY;COUNT=1.5",
    "FREQ=DAILY;COUNT=9007199254740992",
    "FREQ=DAILY;FREQ=WEEKLY",
    "FREQ=DAILY;COUNT=",
    "FREQ=DAILY;X=Y",
    "FREQ=DAILY;COUNT=2=3",
    "FREQ=DAILY;BYSECOND=1.5",
    "FREQ=DAILY;BYSECOND=61",
    "FREQ=DAILY;BYMINUTE=60",
    "FREQ=DAILY;BYHOUR=24",
    "FREQ=MONTHLY;BYMONTHDAY=0",
    "FREQ=YEARLY;BYYEARDAY=-367",
    "FREQ=YEARLY;BYWEEKNO=54",
    "FREQ=YEARLY;BYMONTH=0",
    "FREQ=YEARLY;BYMONTH=13",
    "FREQ=MONTHLY;BYSETPOS=0",
    "FREQ=DAILY;BYDAY=54MO",
    "FREQ=DAILY;BYDAY=1MO",
    "FREQ=WEEKLY;BYMONTHDAY=1",
    "FREQ=MONTHLY;BYWEEKNO=1",
    "FREQ=DAILY;BYYEARDAY=1",
    "FREQ=YEARLY;BYWEEKNO=1;BYDAY=1MO",
    "FREQ=DAILY;BYSETPOS=1",
    "FREQ=WEEKLY;WKST=1MO",
  ])("rejects invalid rule %s", (rule) => expect(() => parsed([start, `RRULE:${rule}`])).toThrow());
  it.each([
    { byDay: [] },
    { byMonth: [] },
    { interval: 1.2 },
  ])("rejects invalid object selector %#", (changes) =>
    expect(() => exported({ recurrence: { frequency: "DAILY", ...changes } })).toThrow());
});

describe("alarms", () => {
  it.each([
    "PT1H",
    "PT1H2M",
    "PT1H2M3S",
    "PT1M",
    "PT1M2S",
    "PT1S",
    "P1D",
    "P1DT1H",
    "P1DT1M",
    "P1DT1S",
    "+P2W",
  ])("accepts RFC duration %s", (triggerOffset) => {
    const reminder: Reminder = { action: "AUDIO", triggerOffset };
    expect(importICal(exported({ reminders: [reminder] })).events[0]?.reminders).toEqual([
      reminder,
    ]);
  });
  it.each([
    ["ACTION:PROCEDURE", "TRIGGER:-PT1H"],
    ["TRIGGER:-PT1H"],
    ["ACTION:AUDIO"],
    ["ACTION:AUDIO", "TRIGGER;VALUE=DATE:20261025"],
    ["ACTION:AUDIO", "TRIGGER;VALUE=DATE-TIME:20261025T090000"],
    ["ACTION:AUDIO", "TRIGGER;VALUE=DATE-TIME;RELATED=START:20261025T090000Z"],
    ["ACTION:AUDIO", "TRIGGER;RELATED=BAD:-PT1H"],
    ["ACTION:AUDIO", "TRIGGER;RELATED=END:-PT1H"],
    ["ACTION:DISPLAY", "TRIGGER:-PT1H"],
    ["ACTION:EMAIL", "TRIGGER:-PT1H", "DESCRIPTION:Hello"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:2"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:1.5", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:0", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:2", "DURATION:-PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:2", "DURATION:PT0S"],
    ["ACTION:AUDIO", "TRIGGER:P"],
    ["ACTION:AUDIO", "TRIGGER:PT"],
    ["ACTION:AUDIO", "TRIGGER:P1M"],
    ["ACTION:AUDIO", "TRIGGER:PT1.5H"],
    ["ACTION:AUDIO", "TRIGGER:P1WT1H"],
    ["ACTION:AUDIO", "TRIGGER:PT1H", "ATTACH;VALUE=BINARY:AAAA"],
    ["ACTION:AUDIO", "TRIGGER:PT1H", "ATTACH:bad"],
    [
      "ACTION:EMAIL",
      "TRIGGER:PT1H",
      "DESCRIPTION:Hello",
      "SUMMARY:Hello",
      "ATTENDEE:mailto:bad name@example.org",
    ],
  ])("rejects invalid alarm %#", (...lines) =>
    expect(() => parsed([start, "BEGIN:VALARM", ...lines, "END:VALARM"])).toThrow());
  it("rejects missing/double triggers and preserves text payloads", () => {
    for (const alarm of [
      { action: "AUDIO" },
      { action: "AUDIO", triggerTime: baseEvent.dtstamp, triggerOffset: "PT0S" },
    ])
      expect(() => exported({ reminders: [alarm as Reminder] })).toThrow();
    const reminder: Reminder = {
      action: "DISPLAY",
      triggerOffset: "PT0S",
      description: "Reminder, please;\nthanks\\n",
      summary: "Morgan's note",
    };
    expect(importICal(exported({ reminders: [reminder] })).events[0]?.reminders).toEqual([
      reminder,
    ]);
  });
});
