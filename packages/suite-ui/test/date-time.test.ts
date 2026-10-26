// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { formatDateTime, isDate, parseDateTime } from "../src/date-time/date-value.js";
import { fromRRule, type RecurrenceRule, toRRule } from "../src/date-time/recurrence.js";

process.env.TZ = "UTC";
const reference = new Date("2026-10-26T10:00:00Z");
const phrases = [
  ["today", "2026-10-26"],
  ["tomorrow", "2026-10-27"],
  ["tomorrow 5pm", "2026-10-27T17:00:00.000Z"],
  ["next mon", "2026-11-02"],
  ["Friday", "2026-10-30"],
  ["next Friday at noon", "2026-11-06T12:00:00.000Z"],
  ["in 3 days", "2026-10-29"],
  ["in 2 weeks", "2026-11-09"],
  ["next month", "2026-11-26"],
  ["next year", "2027-10-26"],
  ["yesterday", "2026-10-25"],
  ["last Monday", "2026-10-19"],
  ["tonight at 8pm", "2026-10-26T20:00:00.000Z"],
  ["Oct 30 2026", "2026-10-30"],
  ["30 October 2026", "2026-10-30"],
  ["10/11/2026", "2026-11-10", "2026-10-11"],
  ["11/10/2026", "2026-10-11", "2026-11-10"],
  ["2026-12-25", "2026-12-25"],
  ["December 25 at 9am", "2026-12-25T09:00:00.000Z"],
  ["in 2 hours", "2026-10-26T12:00:00.000Z"],
];
for (const locale of ["en-GB", "en-US"])
  describe(`20 phrases in ${locale}`, () => {
    it.each(phrases)("interprets %s", (text, gb, us) => {
      const expected = locale === "en-US" ? (us ?? gb) : gb;
      expect(parseDateTime(text as string, locale, reference)).toEqual({
        status: "valid",
        value: expected?.includes("T")
          ? { kind: "dateTime", dateTime: expected }
          : { kind: "date", date: expected },
      });
    });
  });
it.each([
  "nonsense",
  "tomorrow and rubbish",
  "rubbish tomorrow",
  "Monday to Friday",
  "2026-02-30",
  "99/99/2026",
  "a".repeat(257),
])("rejects ambiguous or invalid field %s", (input) => {
  expect(parseDateTime(input, "en-GB", reference).status).toBe("invalid");
});
it("handles empty, bad reference, formatting and leap dates", () => {
  expect(parseDateTime("  ", "en-US", reference)).toEqual({ status: "empty" });
  expect(parseDateTime("tomorrow", "en-US", new Date(NaN)).status).toBe("invalid");
  expect(isDate("2028-02-29")).toBe(true);
  expect(isDate("2026-02-29")).toBe(false);
  expect(formatDateTime({ kind: "date", date: "2026-10-27" }, "en-GB")).toBe(
    "Tuesday, 27 October 2026",
  );
});
const rules: RecurrenceRule[] = [
  { freq: "DAILY", interval: 1 },
  { freq: "DAILY", interval: 3, count: 10 },
  { freq: "WEEKLY", interval: 2, byDay: ["Monday", "Wednesday"], until: "2027-01-01" },
  { freq: "WEEKLY", interval: 1, byDay: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
  { freq: "MONTHLY", interval: 1, byMonthDay: [15] },
  { freq: "MONTHLY", interval: 2, byMonthDay: [-1], count: 2 },
  { freq: "MONTHLY", interval: 1, byDay: ["Tuesday"], bySetPos: 2 },
  { freq: "MONTHLY", interval: 1, byDay: ["Friday"], bySetPos: -1, until: "2028-01-01T00:00:00Z" },
  { freq: "YEARLY", interval: 1, byMonth: [2], byMonthDay: [29] },
  { freq: "YEARLY", interval: 2, until: "2027-06-01T17:30:00Z" },
];
it.each(rules)("round-trips $freq $interval $bySetPos", (rule) => {
  expect(fromRRule(toRRule(rule))).toEqual(rule);
  expect(toRRule(fromRRule(toRRule(rule)))).toBe(toRRule(rule));
});
it("emits RFC ordinal BYDAY and compact UNTIL", () => {
  expect(toRRule(rules[7] as RecurrenceRule)).toBe(
    "RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR;UNTIL=20280101T000000Z",
  );
  expect(fromRRule("FREQ=DAILY")).toEqual({ freq: "DAILY", interval: 1 });
});
it.each([
  "FREQ=HOURLY",
  "FREQ=DAILY;COUNT=1;UNTIL=20270101",
  "FREQ=DAILY;INTERVAL=0",
  "FREQ=WEEKLY;BYDAY=XX",
  "FREQ=MONTHLY;BYDAY=0MO",
  "FREQ=MONTHLY;BYDAY=2MO,2TU",
  "FREQ=DAILY;FREQ=WEEKLY",
  "FREQ=DAILY;BYSECOND=3",
  "FREQ=YEARLY;BYMONTH=13",
  "FREQ=MONTHLY;BYMONTHDAY=0",
  "FREQ=DAILY;UNTIL=20260230",
  "FREQ=DAILY;COUNT=NaN",
  "FREQ=DAILY;COUNT=1.5",
  "FREQ=DAILY;COUNT=9007199254740992",
  "FREQ=DAILY;",
  "FREQ=DAILY;UNTIL=20260230T000000Z",
  "FREQ=MONTHLY;BYDAY=MO",
  "FREQ=MONTHLY;BYDAY=2MO;BYMONTHDAY=3",
  "FREQ=WEEKLY;BYDAY=MO,MO",
])("rejects unsupported RRULE %s", (rule) => expect(() => fromRRule(rule)).toThrow(RangeError));
