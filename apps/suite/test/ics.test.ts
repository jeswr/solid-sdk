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
  it("accepts quoted parameter lists on ignored event properties", () => {
    expect(
      parsed([
        start,
        'ATTENDEE;MEMBER="mailto:a@example.org","mailto:b@example.org":mailto:c@example.org',
      ]).events,
    ).toEqual([baseEvent]);
  });
  it("preserves parameter value boundaries in opaque timezone components", () => {
    const timezone = [
      "BEGIN:VTIMEZONE",
      "TZID:Custom/Example",
      'X-INFO;X-LIST="a,b;c:d",plain,"last":Fictional',
      "END:VTIMEZONE",
    ].join("\r\n");
    const calendar = importICal(exportICal({ events: [], timezones: [timezone] }));
    expect(calendar.timezones?.[0]).toContain('X-LIST="a,b;c:d","plain","last"');
    expect(importICal(exportICal(calendar))).toEqual(calendar);
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
    "DTSTART;X=,a:20261025T090000Z",
    "DTSTART;X=a,:20261025T090000Z",
    "DTSTART;X=a,,b:20261025T090000Z",
    'DTSTART;X="a","b"junk:20261025T090000Z',
    "DTSTART;VALUE=DATE-TIME,DATE:20261025T090000Z",
    "DTSTART;TZID=Europe/London,Europe/Paris:20261025T090000",
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
    ["03:15:00", "02:30:00"],
    ["02:30:00", "03:15:00"],
    ["03:15:00", "03:15:00"],
  ])("defers same-TZID ordering across a DST gap %s to %s", (startTime, endTime) => {
    const event = {
      ...baseEvent,
      start: `2026-03-08T${startTime}`,
      end: `2026-03-08T${endTime}`,
      tzid: "America/New_York",
      endTzid: "America/New_York",
    };
    const calendar = parsed([
      `DTSTART;TZID=America/New_York:20260308T${startTime.replaceAll(":", "")}`,
      `DTEND;TZID=America/New_York:20260308T${endTime.replaceAll(":", "")}`,
    ]);
    expect(calendar.events).toEqual([event]);
    expect(importICal(exported(event))).toEqual(calendar);
  });
  it.each([
    [";VALUE=DATE", "20261025", "20261024"],
    ["", "20261025T090000", "20261025T080000"],
    ["", "20261025T090000Z", "20261025T080000Z"],
  ])("still validates unzoned ordering %s %s", (parameters, startValue, earlier) => {
    for (const endValue of [startValue, earlier])
      expect(() =>
        parsed([`DTSTART${parameters}:${startValue}`, `DTEND${parameters}:${endValue}`]),
      ).toThrow("DTEND must be later");
  });
  it.each([
    { start: "2000-02-29" },
    { start: "0000-02-29" },
    { start: "2026-12-31T23:59:60Z" },
    { start: "2026-10-25T09:00:00", tzid: "Custom, East" },
    { end: "2026-10-25T09:00:00", endTzid: "Europe/Paris" },
    { start: "2026-10-25T09:00:00", end: "2026-10-25T10:00:00" },
    { start: "2026-10-25T09:00:00", tzid: "Europe/London", end: "2026-10-25T08:00:00Z" },
  ])("preserves explicit clocks %#", (changes) =>
    expect(importICal(exported(changes)).events[0]).toEqual({ ...baseEvent, ...changes }));
  it.each([
    ["DTSTART:20261025T090000", "DTEND:20261025T100000Z"],
    ["DTSTART:20261025T090000", "DTEND;TZID=Europe/Paris:20261025T100000"],
    ["DTSTART:20261025T090000Z", "DTEND:20261025T100000"],
    ["DTSTART;TZID=Europe/Paris:20261025T090000", "DTEND:20261025T100000"],
  ])("rejects mixed floating forms %s %s", (start, end) =>
    expect(() => parsed([start, end])).toThrow("floating form"));
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
    { start: "2026-10-25T09:00:00", end: "2026-10-25T10:00:00Z" },
    { start: "2026-10-25T09:00:00", end: "2026-10-25T10:00:00", endTzid: "Europe/Paris" },
    { end: "2026-10-25T10:00:00" },
    { start: "2026-10-25T09:00:00", tzid: "Europe/Paris", end: "2026-10-25T10:00:00" },
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
    "01MO",
    "+01TU",
    "-01WE",
    "09TH",
    "-09FR",
    "+53SA",
  ])("preserves valid BYDAY ordinal %s", (day) => {
    const calendar = parsed([start, `RRULE:FREQ=MONTHLY;BYDAY=${day}`]);
    expect(calendar.events[0]?.recurrence?.byDay).toEqual([day]);
    const wire = exported({ recurrence: { frequency: "MONTHLY", byDay: [day] } });
    expect(wire).toContain(`BYDAY=${day}`);
    expect(importICal(wire)).toEqual(calendar);
  });
  it.each([
    "0MO",
    "00MO",
    "+00MO",
    "-00MO",
    "001MO",
    "54MO",
    "-54MO",
    "+MO",
    "01XX",
  ])("rejects invalid BYDAY ordinal %s", (day) => {
    expect(() => parsed([start, `RRULE:FREQ=MONTHLY;BYDAY=${day}`])).toThrow("invalid BYDAY");
    expect(() => exported({ recurrence: { frequency: "MONTHLY", byDay: [day] } })).toThrow(
      "invalid BYDAY",
    );
  });
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
    "FREQ=DAILY;BYDAY=01MO",
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
    "PT1H0M3S",
    "-PT1H0M3S",
    "+PT1H0M3S",
    "PT1M",
    "PT1M2S",
    "PT1S",
    "P1D",
    "P1DT1H",
    "P1DT1M",
    "P1DT1S",
    "P1DT1H2M",
    "P1DT1H0M3S",
    "-P1DT1H0M3S",
    "+P1DT1H0M3S",
    "+P2W",
  ])("accepts RFC duration %s", (triggerOffset) => {
    const reminder: Reminder = { action: "AUDIO", triggerOffset };
    expect(importICal(exported({ reminders: [reminder] })).events[0]?.reminders).toEqual([
      reminder,
    ]);
  });
  it.each([
    "PT1H3S",
    "-PT1H3S",
    "+PT1H3S",
    "P1DT1H3S",
    "-P1DT1H3S",
    "+P1DT1H3S",
  ])("rejects trigger duration without intervening minutes %s", (triggerOffset) => {
    expect(() =>
      parsed([start, "BEGIN:VALARM", "ACTION:AUDIO", `TRIGGER:${triggerOffset}`, "END:VALARM"]),
    ).toThrow("Invalid iCalendar: invalid duration");
    expect(() => exported({ reminders: [{ action: "AUDIO", triggerOffset }] })).toThrow(
      "Invalid iCalendar: invalid duration",
    );
  });
  it.each([
    "PT1H3S",
    "+PT1H3S",
    "P1DT1H3S",
    "+P1DT1H3S",
  ])("rejects repeat duration without intervening minutes %s", (duration) => {
    expect(() =>
      parsed([
        start,
        "BEGIN:VALARM",
        "ACTION:AUDIO",
        "TRIGGER:PT0S",
        "REPEAT:1",
        `DURATION:${duration}`,
        "END:VALARM",
      ]),
    ).toThrow("Invalid iCalendar: invalid duration");
    expect(() =>
      exported({ reminders: [{ action: "AUDIO", triggerOffset: "PT0S", repeat: 1, duration }] }),
    ).toThrow("Invalid iCalendar: invalid duration");
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
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:-1", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:9007199254740992", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:+9007199254740992", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:+", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:++2", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:+1.5", "DURATION:PT1M"],
    ["ACTION:AUDIO", "TRIGGER:-PT1H", "REPEAT:0"],
    ["ACTION:AUDIO", "TRIGGER;RELATED=START,END:-PT1H"],
    [
      "ACTION:AUDIO",
      "TRIGGER:PT1H",
      "ATTACH:https://example.org/a",
      "ATTACH:https://example.org/b",
    ],
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
  it.each([
    "0",
    "+0",
    "+2",
    "+02",
    "2147483646",
    "2147483647",
    "+2147483647",
  ])("round-trips REPEAT:%s with a duration", (repeat) => {
    const reminder: Reminder = {
      action: "AUDIO",
      triggerOffset: "-PT1H",
      repeat: Number(repeat),
      duration: "PT1M",
    };
    const calendar = parsed([
      start,
      "BEGIN:VALARM",
      "ACTION:AUDIO",
      "TRIGGER:-PT1H",
      `REPEAT:${repeat}`,
      "DURATION:PT1M",
      "END:VALARM",
    ]);
    expect(calendar.events[0]?.reminders).toEqual([reminder]);
    expect(importICal(exported({ reminders: [reminder] }))).toEqual(calendar);
  });
  it.each([
    "2147483648",
    "+2147483648",
    "9007199254740991",
    "+9007199254740991",
  ])("rejects REPEAT outside the RFC integer range %s", (repeat) => {
    expect(() =>
      parsed([
        start,
        "BEGIN:VALARM",
        "ACTION:AUDIO",
        "TRIGGER:PT0S",
        `REPEAT:${repeat}`,
        "DURATION:PT1M",
        "END:VALARM",
      ]),
    ).toThrow("Invalid iCalendar: expected nonnegative alarm repeat integer");
    expect(() =>
      exported({
        reminders: [
          { action: "AUDIO", triggerOffset: "PT0S", repeat: Number(repeat), duration: "PT1M" },
        ],
      }),
    ).toThrow("Invalid iCalendar: expected nonnegative alarm repeat integer");
  });
  it.each([0, 1, 2])("round-trips EMAIL with %i attachments", (count) => {
    const attachments = ["https://example.org/a", "https://example.org/b"].slice(0, count);
    const calendar = parsed([
      start,
      "BEGIN:VALARM",
      "ACTION:EMAIL",
      "TRIGGER:-PT1H",
      "DESCRIPTION:Hello",
      "SUMMARY:Hello",
      "ATTENDEE:mailto:a@example.org",
      ...attachments.map((uri) => `ATTACH;VALUE=URI:${uri}`),
      "END:VALARM",
    ]);
    expect(calendar.events[0]?.reminders?.[0]).toEqual({
      action: "EMAIL",
      triggerOffset: "-PT1H",
      description: "Hello",
      summary: "Hello",
      attendees: ["mailto:a@example.org"],
      ...(count ? { attachments } : {}),
    });
    expect(importICal(exportICal(calendar))).toEqual(calendar);
  });
  it("keeps the legacy singular EMAIL attachment export", () => {
    const reminder: Reminder = {
      action: "EMAIL",
      triggerOffset: "PT0S",
      description: "Hello",
      summary: "Hello",
      attendees: ["mailto:a@example.org"],
      attachment: "https://example.org/a",
    };
    expect(
      importICal(exported({ reminders: [reminder] })).events[0]?.reminders?.[0]?.attachments,
    ).toEqual([reminder.attachment]);
  });
  it.each([
    "ATTACH;VALUE=BINARY:AAAA",
    "ATTACH:bad",
  ])("validates every EMAIL attachment %s", (invalid) => {
    expect(() =>
      parsed([
        start,
        "BEGIN:VALARM",
        "ACTION:EMAIL",
        "TRIGGER:-PT1H",
        "DESCRIPTION:Hello",
        "SUMMARY:Hello",
        "ATTENDEE:mailto:a@example.org",
        "ATTACH:https://example.org/a",
        invalid,
        "END:VALARM",
      ]),
    ).toThrow();
  });
  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid model repeat %s", (repeat) => {
    expect(() =>
      exported({
        reminders: [{ action: "AUDIO", triggerOffset: "PT0S", repeat, duration: "PT1M" }],
      }),
    ).toThrow("nonnegative");
  });
  it("rejects the EMAIL attachment collection on AUDIO", () => {
    expect(() =>
      exported({
        reminders: [
          {
            action: "AUDIO",
            triggerOffset: "PT0S",
            attachments: ["https://example.org/a", "https://example.org/b"],
          },
        ],
      }),
    ).toThrow("EMAIL");
  });
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
