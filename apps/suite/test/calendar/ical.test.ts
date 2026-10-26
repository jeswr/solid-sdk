// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CalendarEvent,
  computeFireTimes,
  expandEvent,
  exportICal,
  foldContentLine,
  formatICalDate,
  importICal,
  parseICalDate,
  ruleToICal,
} from "../../src/apps/calendar/lib/model";

const fixtures = new URL("./fixtures/", import.meta.url);
const ics = (lines: string) =>
  `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Test\nDTSTART:20260301T090000Z\n${lines}\nEND:VEVENT\nEND:VCALENDAR`;

describe("ICS fixture round-trips", () => {
  const files = readdirSync(fixtures).filter((f) => f.endsWith(".ics"));
  it("includes exactly twenty independent source fixtures", () => expect(files).toHaveLength(20));
  it.each(files)("preserves modeled semantics of %s", (file) => {
    const source = readFileSync(new URL(file, fixtures), "utf8");
    const imported = importICal(source);
    expect(imported.warnings).toEqual([]);
    expect(imported.skipped).toBe(0);
    expect(imported.events).toHaveLength(1);
    const exported = exportICal({ events: imported.events, now: new Date("2026-01-01Z") });
    const roundtrip = importICal(exported);
    expect(roundtrip).toEqual(imported);
    for (const line of exported.split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
describe("ICS compatibility and validation", () => {
  it("requires persistent identities for otherwise indistinguishable events", () => {
    const base: CalendarEvent = {
      name: "Meeting",
      start: new Date("2026-03-01T09:00Z"),
      end: new Date("2026-03-01T10:00Z"),
    };
    const events: CalendarEvent[] = [
      base,
      { ...base, location: "Room 2" },
      { ...base, description: "Another meeting" },
      { ...base, recurrence: { frequency: "WEEKLY" } },
    ];
    for (const event of events)
      expect(() => exportICal({ events: [event] })).toThrow("persistent UID or source URL");
    expect(() => exportICal({ events: [{ ...base, uid: " " }] })).toThrow("persistent UID");
    const items = events.map((data, i) => ({ data, url: `https://pod.example/events/${i}.ttl` }));
    const imported = importICal(exportICal({ events: items }));
    expect(imported.warnings).toEqual([]);
    expect(imported.events.map((event) => event.uid)).toEqual(items.map((item) => item.url));
    expect(importICal(exportICal({ events: imported.events }))).toEqual(imported);
    const edited = { ...base, uid: "persistent@example.test", name: "Renamed", location: "New" };
    expect(
      importICal(exportICal({ events: [{ data: edited, url: items[0]?.url }] })).events[0]?.uid,
    ).toBe(edited.uid);
    expect(events.every((event) => event.uid === undefined)).toBe(true);
  });
  it.each([
    "",
    "RRULE:FREQ=DAILY;COUNT=3\n",
  ])("skips cancelled events and series with an explicit warning (%s)", (recurrence) => {
    const source =
      ics(`${recurrence}STATUS:CANCELLED`).replace("END:VCALENDAR", "") +
      ics("STATUS:CONFIRMED").replace("BEGIN:VCALENDAR\n", "");
    const imported = importICal(source);
    expect(imported.skipped).toBe(1);
    expect(imported.warnings).toEqual(["Cancelled ICS event skipped"]);
    expect(imported.events).toHaveLength(1);
    expect(imported.timeZones).toEqual([undefined]);
    expect(imported.events[0]?.recurrence).toBeUndefined();
  });
  it.each([
    "",
    ";TZID=Europe/London",
  ])("uses the DTSTART timezone for a floating UNTIL (%s)", (params) => {
    const source = ics("RRULE:FREQ=DAILY;UNTIL=20260703T083000").replace(
      "DTSTART:20260301T090000Z",
      `DTSTART${params}:20260701T090000`,
    );
    const imported = importICal(source, "Europe/London");
    expect(imported.warnings).toEqual([]);
    const event = imported.events[0] as CalendarEvent;
    expect(event.recurrence?.until).toEqual(new Date("2026-07-03T07:30Z"));
    expect(
      expandEvent(event, new Date("2026-07-01Z"), new Date("2026-07-05Z"), "Europe/London").map(
        (event) => event.start,
      ),
    ).toEqual([new Date("2026-07-01T08:00Z"), new Date("2026-07-02T08:00Z")]);
    const utcCutoff = importICal(
      source.replace("UNTIL=20260703T083000", "UNTIL=20260703T083000Z"),
      "Europe/London",
    );
    expect(utcCutoff.events[0]?.recurrence?.until).toEqual(new Date("2026-07-03T08:30Z"));
  });
  it("parses ambiguous local ICS dates as the first occurrence", () => {
    expect(parseICalDate("20261025T013000", "Europe/London")).toEqual(
      new Date("2026-10-25T00:30Z"),
    );
    const imported = importICal(
      ics("RRULE:FREQ=DAILY;COUNT=2").replace(
        "DTSTART:20260301T090000Z",
        "DTSTART;TZID=Europe/London:20261025T013000",
      ),
    );
    expect(imported.events[0]?.start).toEqual(new Date("2026-10-25T00:30Z"));
  });
  it.each([false, true])("rejects the whole overridden series, override first: %s", (first) => {
    const master =
      "BEGIN:VEVENT\nUID:series\nSUMMARY:Master\nDTSTART:20260301T090000Z\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT";
    const override =
      "BEGIN:VEVENT\nUID:series\nSUMMARY:Moved\nRECURRENCE-ID:20260302T090000Z\nDTSTART:20260302T110000Z\nEND:VEVENT";
    const unrelated =
      "BEGIN:VEVENT\nUID:other\nSUMMARY:Other\nDTSTART;TZID=Europe/London:20260701T090000\nEND:VEVENT";
    const components = first ? [override, unrelated, master] : [master, unrelated, override];
    const imported = importICal(`BEGIN:VCALENDAR\n${components.join("\n")}\nEND:VCALENDAR`);
    expect(imported.events.map((event) => event.uid)).toEqual(["other"]);
    expect(imported.timeZones).toEqual(["Europe/London"]);
    expect(imported.skipped).toBe(2);
    expect(imported.warnings).toEqual([
      "Unsupported ICS recurrence override; skipped entire series",
      "Unsupported ICS recurrence override; skipped entire series",
    ]);
  });
  it("skips a standalone override without affecting UID-less events", () => {
    const imported = importICal(
      ics("RECURRENCE-ID:20260302T090000Z").replace("END:VCALENDAR", "") +
        ics("").replace("BEGIN:VCALENDAR\n", ""),
    );
    expect(imported.events).toHaveLength(1);
    expect(imported.skipped).toBe(1);
    expect(imported.warnings).toEqual(["Unsupported ICS event property"]);
  });
  it.each(["UTC"])("rejects mixed DTSTART/UNTIL date kinds in %s", (timeZone) => {
    for (const [start, until] of [
      [new Date("2026-03-01T09:00Z"), "2026-03-03"],
      ["2026-03-01", new Date("2026-03-03T09:00Z")],
    ] as const) {
      expect(() =>
        exportICal({
          events: [
            { uid: "Mixed", name: "Mixed", start, recurrence: { frequency: "DAILY", until } },
          ],
          timeZone,
        }),
      ).toThrow("ICS DTSTART and UNTIL must use the same date kind");
    }
  });
  it.each(["UTC"])("round-trips matching DTSTART/UNTIL kinds in %s", (timeZone) => {
    for (const [start, until] of [
      [new Date("2026-07-01T08:00Z"), new Date("2026-07-03T07:30Z")],
      ["2026-07-01", "2026-07-03"],
    ] as const) {
      const event: CalendarEvent = {
        uid: "Matching",
        name: "Matching",
        start,
        recurrence: { frequency: "DAILY", until },
      };
      const exported = exportICal({ events: [event], timeZone });
      expect(exported).toContain(
        typeof start === "string" ? "UNTIL=20260703" : "UNTIL=20260703T073000Z",
      );
      const imported = importICal(exported);
      expect(imported.warnings).toEqual([]);
      expect(imported.events[0]?.start).toEqual(start);
      expect(imported.events[0]?.recurrence?.until).toEqual(until);
    }
  });
  it("handles timezone-qualified and floating dates explicitly", () => {
    const source =
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:London\nUID:london@example.test\nDTSTART;TZID="Europe/London":20260701T090000\nDTEND;TZID=Europe/London:20260701T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR';
    const imported = importICal(source);
    expect(imported.events[0]?.start).toEqual(new Date("2026-07-01T08:00Z"));
    expect(imported.timeZones).toEqual(["Europe/London"]);
    expect(() => exportICal({ events: imported.events, timeZone: "Europe/London" })).toThrow(
      "VTIMEZONE",
    );
    expect(parseICalDate("20260701T090000", "Europe/London")).toEqual(
      new Date("2026-07-01T08:00Z"),
    );
    expect(
      importICal(source.replace(/;TZID="?Europe\/London"?/g, ""), "Europe/London").events[0]?.start,
    ).toEqual(new Date("2026-07-01T08:00Z"));
  });
  it.each([
    undefined,
    { frequency: "DAILY", count: 2 } as const,
  ])("rejects named-zone export without losing a later overlap start (%j)", (recurrence) => {
    const event: CalendarEvent = {
      uid: "Repeated hour",
      name: "Repeated hour",
      start: new Date("2026-10-25T01:30Z"),
      end: new Date("2026-10-25T02:30Z"),
      recurrence,
    };
    expect(() => exportICal({ events: [event], timeZone: "Europe/London" })).toThrow("VTIMEZONE");
    const exported = exportICal({ events: [event], timeZone: "UTC" });
    expect(exported).toContain("DTSTART:20261025T013000Z");
    expect(exported).not.toContain("TZID");
    expect(importICal(exported).events[0]).toMatchObject({
      start: event.start,
      end: event.end,
      recurrence,
    });
  });
  it("rejects mismatched exception kinds rather than weakening civil exclusions", () => {
    for (const [start, exceptDate] of [
      [new Date("2026-03-01T09:00Z"), "2026-03-02"],
      ["2026-03-01", new Date("2026-03-02T09:00Z")],
    ] as const) {
      expect(() =>
        exportICal({
          events: [
            {
              uid: "Mixed exception",
              name: "Mixed exception",
              start,
              recurrence: { frequency: "DAILY", exceptDate: [exceptDate] },
            },
          ],
        }),
      ).toThrow("ICS DTSTART and EXDATE must use the same date kind");
    }
    const event: CalendarEvent = {
      uid: "Timed exception",
      name: "Timed exception",
      start: new Date("2026-03-01T09:00Z"),
      recurrence: { frequency: "DAILY", count: 3, exceptDate: [new Date("2026-03-02T09:00Z")] },
    };
    const roundtrip = importICal(exportICal({ events: [event] })).events[0] as CalendarEvent;
    expect(
      expandEvent(roundtrip, new Date("2026-03-01Z"), new Date("2026-03-05Z")).map((e) => e.start),
    ).toEqual([event.start, new Date("2026-03-03T09:00Z")]);
  });
  it.each([
    "-P1D",
    "-P1W",
    "P1DT1H",
    "P0D",
  ])("reports unsupported nominal alarm %s across DST", (offset) => {
    const source = ics(`BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:${offset}\nEND:VALARM`).replace(
      "DTSTART:20260301T090000Z",
      "DTSTART;TZID=America/New_York:20260308T090000",
    );
    const imported = importICal(source);
    expect(imported.events).toEqual([]);
    expect(imported.skipped).toBe(1);
    expect(imported.warnings).toEqual(["Unsupported nominal day/week ICS alarm duration"]);
  });
  it.each([
    "-P1D",
    "-P1W",
    "P1DT1H1M1S",
    "P0D",
    "-PT24H",
  ])("exports fixed offset %s in exact time units", (triggerOffset) => {
    const event: CalendarEvent = {
      uid: "Fixed alarm",
      name: "Fixed alarm",
      start: new Date("2026-03-08T13:00Z"),
      reminders: [{ triggerOffset }],
    };
    const exported = exportICal({ events: [event] });
    expect(exported).toMatch(/TRIGGER:-?PT[0-9HMS]+\r\n/);
    const imported = importICal(exported);
    expect(imported.warnings).toEqual([]);
    expect(computeFireTimes(imported.events[0] as CalendarEvent)).toEqual(computeFireTimes(event));
  });
  it("exports stable source-based UIDs, escapes TEXT, and folds by UTF-8 octets", () => {
    const e: CalendarEvent = {
      name: "é中文𐐀".repeat(25),
      start: "2026-03-01",
      description: "one\r\ntwo\rthree;comma,backslash\\",
      location: "",
    };
    const one = exportICal({ events: [{ data: e, url: "https://pod.example/e1" }] });
    const two = exportICal({ events: [{ data: e, url: "https://pod.example/e2" }] });
    expect(importICal(one).events[0]?.uid).not.toBe(importICal(two).events[0]?.uid);
    expect(importICal(one).events[0]?.name).toBe(e.name);
    expect(importICal(one).events[0]?.description).toBe("one\ntwo\nthree;comma,backslash\\");
    expect(() => exportICal({ events: [e] })).toThrow("persistent UID or source URL");
    expect(exportICal({ events: [] })).toContain("END:VCALENDAR");
    expect(foldContentLine("short")).toBe("short");
    const unicode = foldContentLine(e.name);
    for (const line of unicode.split("\r\n"))
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(formatICalDate(new Date("2026-01-01Z"))).toBe("20260101T000000Z");
    expect(parseICalDate("20260101")).toBe("2026-01-01");
  });
  it.each([
    "garbage",
    "20260230",
    "20260101T246000Z",
    "20260101T126199Z",
  ])("rejects invalid ICS date %s", (value) => expect(() => parseICalDate(value)).toThrow());
  it.each([
    "RRULE:FREQ=HOURLY",
    "RRULE:FREQ=WEEKLY;BYDAY=1MO",
    "RRULE:FREQ=DAILY;COUNT=2;UNTIL=20260401",
    "RRULE:FREQ=DAILY;BYSETPOS=1",
    "RDATE:20260302T090000Z",
    "EXDATE:20260302T090000Z",
    "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER;RELATED=END:-PT1H\nEND:VALARM",
    "BEGIN:VALARM\nACTION:EMAIL\nTRIGGER:-PT1H\nEND:VALARM",
    "BEGIN:VALARM\nACTION:DISPLAY\nEND:VALARM",
    "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER;VALUE=DATE-TIME:20260301\nEND:VALARM",
    "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT1H\nREPEAT:2\nEND:VALARM",
  ])("reports unsupported or invalid component: %s", (fields) => {
    const parsed = importICal(ics(fields));
    expect(parsed.skipped).toBe(1);
    expect(parsed.events).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
  });
  it("isolates nested components, tolerates unknown properties, and reports broken components", () => {
    expect(
      importICal(
        `\uFEFF${ics("X-UNKNOWN:value\nnot a property\nBEGIN:X-CHILD\nSUMMARY:Wrong\nEND:X-CHILD")}`,
      ).events[0]?.name,
    ).toBe("Test");
    expect(importICal("BEGIN:VCALENDAR\nEND:WRONG").warnings).toEqual(["Mismatched ICS component"]);
    expect(
      importICal("BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nEND:VTIMEZONE\nEND:VCALENDAR").warnings,
    ).toHaveLength(1);
    expect(importICal("BEGIN:VCALENDAR").warnings).toEqual(["Unclosed ICS component"]);
    expect(
      importICal("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Missing date\nEND:VEVENT\nEND:VCALENDAR")
        .skipped,
    ).toBe(1);
    expect(importICal(ics("")).events[0]?.reminders).toEqual([]);
    expect(importICal(ics("").replace("DTSTART:", "DTSTART;VALUE=DATE:")).skipped).toBe(1);
    expect(importICal(ics("").replace("SUMMARY:Test\n", "")).skipped).toBe(1);
  });
  it("serializes every shared rule field and all-day exceptions", () => {
    expect(
      ruleToICal({
        frequency: "MONTHLY",
        interval: 2,
        count: 4,
        byDay: ["MO"],
        byMonthDay: [1, -1],
        byMonth: [3, 4],
      }),
    ).toBe("FREQ=MONTHLY;INTERVAL=2;COUNT=4;BYDAY=MO;BYMONTHDAY=1,-1;BYMONTH=3,4");
    expect(
      exportICal({
        events: [
          {
            uid: "D",
            name: "D",
            start: "2026-03-01",
            end: "2026-03-02",
            recurrence: { frequency: "DAILY" },
          },
        ],
        timeZone: "Europe/London",
      }),
    ).toContain("DTSTART;VALUE=DATE:20260301");
  });
});
