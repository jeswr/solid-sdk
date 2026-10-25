// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CalendarEvent,
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
  it("handles timezone-qualified and floating dates explicitly", () => {
    const source =
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:London\nUID:london@example.test\nDTSTART;TZID="Europe/London":20260701T090000\nDTEND;TZID=Europe/London:20260701T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR';
    const imported = importICal(source);
    expect(imported.events[0]?.start).toEqual(new Date("2026-07-01T08:00Z"));
    expect(imported.timeZones).toEqual(["Europe/London"]);
    expect(importICal(exportICal({ events: imported.events, timeZone: "Europe/London" }))).toEqual(
      imported,
    );
    expect(parseICalDate("20260701T090000", "Europe/London")).toEqual(
      new Date("2026-07-01T08:00Z"),
    );
    expect(
      importICal(source.replace(/;TZID="?Europe\/London"?/g, ""), "Europe/London").events[0]?.start,
    ).toEqual(new Date("2026-07-01T08:00Z"));
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
    expect(exportICal({ events: [e] })).toContain("UID:event-");
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
          { name: "D", start: "2026-03-01", end: "2026-03-02", recurrence: { frequency: "DAILY" } },
        ],
        timeZone: "Europe/London",
      }),
    ).toContain("DTSTART;VALUE=DATE:20260301");
  });
});
