// AUTHORED-BY Codex GPT-6.1-Sol
import type { CalendarEvent } from "../../../src/apps/calendar/lib/ics";

export const baseEvent: CalendarEvent = {
  uid: "gathering@example.org",
  dtstamp: "2026-01-01T00:00:00Z",
  name: "Morgan's gathering",
  start: "2026-10-25T09:00:00Z",
};
export function source(lines: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Example.org//Synthetic//EN",
    "BEGIN:VEVENT",
    "UID:gathering@example.org",
    "DTSTAMP:20260101T000000Z",
    "SUMMARY:Morgan's gathering",
    ...lines,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
const utcStart = "DTSTART:20261025T090000Z";
const zoneStart = "DTSTART;TZID=Europe/London:20261025T090000";
export const roundTrips: { name: string; text: string; expected: CalendarEvent }[] = [
  { name: "UTC without end", text: source([utcStart]), expected: baseEvent },
  {
    name: "UTC with end",
    text: source([utcStart, "DTEND:20261025T100000Z"]),
    expected: { ...baseEvent, end: "2026-10-25T10:00:00Z" },
  },
  {
    name: "all-day",
    text: source(["DTSTART;VALUE=DATE:20261025", "DTEND;VALUE=DATE:20261026"]),
    expected: { ...baseEvent, start: "2026-10-25", end: "2026-10-26" },
  },
  {
    name: "multi-day",
    text: source(["DTSTART;VALUE=DATE:20261025", "DTEND;VALUE=DATE:20261030"]),
    expected: { ...baseEvent, start: "2026-10-25", end: "2026-10-30" },
  },
  {
    name: "floating",
    text: source(["DTSTART:20261025T090000", "DTEND:20261025T110000"]),
    expected: { ...baseEvent, start: "2026-10-25T09:00:00", end: "2026-10-25T11:00:00" },
  },
  {
    name: "London at DST boundary",
    text: source([zoneStart, "DTEND;TZID=Europe/London:20261025T110000"]),
    expected: {
      ...baseEvent,
      start: "2026-10-25T09:00:00",
      tzid: "Europe/London",
      end: "2026-10-25T11:00:00",
      endTzid: "Europe/London",
    },
  },
  {
    name: "New York",
    text: source(["DTSTART;TZID=America/New_York:20261101T013000"]),
    expected: { ...baseEvent, start: "2026-11-01T01:30:00", tzid: "America/New_York" },
  },
  {
    name: "quoted custom TZID",
    text: source(['DTSTART;TZID="/example.org/Custom:Zone;East":20261025T090000']),
    expected: { ...baseEvent, start: "2026-10-25T09:00:00", tzid: "/example.org/Custom:Zone;East" },
  },
  {
    name: "weekly with exceptions",
    text: source([
      zoneStart,
      "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8;BYDAY=MO,WE;WKST=SU",
      "EXDATE;TZID=Europe/London:20261102T090000,20261104T090000",
      "RDATE;TZID=Europe/London:20261103T090000",
    ]),
    expected: {
      ...baseEvent,
      start: "2026-10-25T09:00:00",
      tzid: "Europe/London",
      recurrence: {
        frequency: "WEEKLY",
        interval: 2,
        count: 8,
        byDay: ["MO", "WE"],
        weekStart: "SU",
        exceptDate: [
          { value: "2026-11-02T09:00:00", tzid: "Europe/London" },
          { value: "2026-11-04T09:00:00", tzid: "Europe/London" },
        ],
      },
      rdate: [{ value: "2026-11-03T09:00:00", tzid: "Europe/London" }],
    },
  },
  {
    name: "all-day daily until",
    text: source([
      "DTSTART;VALUE=DATE:20261025",
      "RRULE:FREQ=DAILY;UNTIL=20261031",
      "EXDATE;VALUE=DATE:20261027",
      "RDATE;VALUE=DATE:20261102,20261103",
    ]),
    expected: {
      ...baseEvent,
      start: "2026-10-25",
      recurrence: {
        frequency: "DAILY",
        until: "2026-10-31",
        exceptDate: [{ value: "2026-10-27" }],
      },
      rdate: [{ value: "2026-11-02" }, { value: "2026-11-03" }],
    },
  },
  {
    name: "last Friday monthly",
    text: source([utcStart, "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=12"]),
    expected: { ...baseEvent, recurrence: { frequency: "MONTHLY", byDay: ["-1FR"], count: 12 } },
  },
  {
    name: "yearly selectors",
    text: source([
      utcStart,
      "RRULE:FREQ=YEARLY;BYMONTH=1,6;BYMONTHDAY=1,-1;UNTIL=20300101T000000Z",
    ]),
    expected: {
      ...baseEvent,
      recurrence: {
        frequency: "YEARLY",
        byMonth: [1, 6],
        byMonthDay: [1, -1],
        until: "2030-01-01T00:00:00Z",
      },
    },
  },
  {
    name: "timed additions without rule",
    text: source([
      utcStart,
      "EXDATE:20261026T090000Z",
      "RDATE:20261027T090000Z",
      "RDATE:20261028T090000Z",
    ]),
    expected: {
      ...baseEvent,
      exceptDate: [{ value: "2026-10-26T09:00:00Z" }],
      rdate: [{ value: "2026-10-27T09:00:00Z" }, { value: "2026-10-28T09:00:00Z" }],
    },
  },
  {
    name: "display reminder",
    text: source([
      utcStart,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT15M",
      "DESCRIPTION:Call Riley",
      "END:VALARM",
    ]),
    expected: {
      ...baseEvent,
      reminders: [{ action: "DISPLAY", triggerOffset: "-PT15M", description: "Call Riley" }],
    },
  },
  {
    name: "repeating end audio reminder",
    text: source([
      utcStart,
      "DTEND:20261025T100000Z",
      "BEGIN:VALARM",
      "ACTION:AUDIO",
      "TRIGGER;RELATED=END:PT0S",
      "ATTACH:https://example.org/chime.ogg",
      "REPEAT:2",
      "DURATION:PT5M",
      "END:VALARM",
    ]),
    expected: {
      ...baseEvent,
      end: "2026-10-25T10:00:00Z",
      reminders: [
        {
          action: "AUDIO",
          triggerOffset: "PT0S",
          related: "END",
          attachment: "https://example.org/chime.ogg",
          repeat: 2,
          duration: "PT5M",
        },
      ],
    },
  },
  {
    name: "absolute trigger",
    text: source([
      utcStart,
      "BEGIN:VALARM",
      "ACTION:AUDIO",
      "TRIGGER;VALUE=DATE-TIME:20261025T080000Z",
      "END:VALARM",
    ]),
    expected: {
      ...baseEvent,
      reminders: [{ action: "AUDIO", triggerTime: "2026-10-25T08:00:00Z" }],
    },
  },
  {
    name: "email reminder",
    text: source([
      utcStart,
      "BEGIN:VALARM",
      "ACTION:EMAIL",
      "TRIGGER;RELATED=START:-P1D",
      "DESCRIPTION:Bring notebooks",
      "SUMMARY:Gathering reminder",
      "ATTENDEE:mailto:morgan@example.org",
      "ATTENDEE:mailto:riley@example.org",
      "END:VALARM",
    ]),
    expected: {
      ...baseEvent,
      reminders: [
        {
          action: "EMAIL",
          triggerOffset: "-P1D",
          related: "START",
          description: "Bring notebooks",
          summary: "Gathering reminder",
          attendees: ["mailto:morgan@example.org", "mailto:riley@example.org"],
        },
      ],
    },
  },
  {
    name: "escaped text",
    text: source([
      utcStart,
      "LOCATION:Studio\\, east\\; floor 2",
      "DESCRIPTION:Notes\\nBring C:\\\\maps\\; lunch\\, too",
    ]),
    expected: {
      ...baseEvent,
      location: "Studio, east; floor 2",
      description: "Notes\nBring C:\\maps; lunch, too",
    },
  },
  {
    name: "folded Unicode and tab continuation",
    text: source([utcStart, "DESCRIPTION:Café 🌍", "\twith Riley", " more notes"]),
    expected: { ...baseEvent, description: "Café 🌍with Rileymore notes" },
  },
  {
    name: "leap-day and multiple alarms",
    text: source([
      "DTSTART;VALUE=DATE:20280229",
      "BEGIN:VALARM",
      "ACTION:AUDIO",
      "TRIGGER:-P1W",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-P1DT2H3M4S",
      "DESCRIPTION:Prepare",
      "END:VALARM",
    ]),
    expected: {
      ...baseEvent,
      start: "2028-02-29",
      reminders: [
        { action: "AUDIO", triggerOffset: "-P1W" },
        { action: "DISPLAY", triggerOffset: "-P1DT2H3M4S", description: "Prepare" },
      ],
    },
  },
];
