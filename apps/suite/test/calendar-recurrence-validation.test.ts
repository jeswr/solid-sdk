// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  expandRecurrence,
  MAX_OCCURRENCES,
  MAX_SCAN_DAYS,
  RecurrenceError,
  type RecurrenceErrorCode,
  type RecurrenceInput,
} from "../src/apps/calendar/lib/recurrence/index";

const window = {
  start: Date.parse("2026-01-01T00:00:00Z"),
  end: Date.parse("2027-01-01T00:00:00Z"),
};
const base = { start: "2026-01-01T09:00:00", timeZone: "UTC", durationMs: 3_600_000 };
function rejects(input: unknown, code: RecurrenceErrorCode, range: unknown = window): void {
  let thrown: unknown;
  try {
    expandRecurrence(input as RecurrenceInput, range as typeof window);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RecurrenceError);
  expect(thrown).toMatchObject({
    name: "RecurrenceError",
    code,
    message: `Calendar recurrence: ${code}`,
  });
}

describe("recurrence rejects unsupported or malformed inputs", () => {
  it.each([
    "BYSETPOS=-1",
    "BYWEEKNO=1",
    "BYYEARDAY=1",
    "BYHOUR=9",
    "BYMINUTE=0",
    "BYSECOND=0",
    "RSCALE=GREGORIAN",
    "X-SECRET=value",
    "EXDATE=20260101",
    "FREQ=HOURLY",
  ])("rejects unsupported part %s", (part) => {
    rejects(
      { ...base, rrule: part.startsWith("FREQ=") ? part : `FREQ=DAILY;${part}` },
      "unsupported-rule",
    );
  });

  it.each([
    "",
    "FREQ",
    "FREQ=",
    "FREQ=DAILY=ignored",
    "FREQ=DAILY;",
    "COUNT=2",
    "FREQ=DAILY;FREQ=WEEKLY",
    "FREQ=DAILY;COUNT=2;UNTIL=20260102T090000Z",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;INTERVAL=-1",
    "FREQ=DAILY;INTERVAL=1.5",
    "FREQ=DAILY;INTERVAL=2147483648",
    "FREQ=DAILY;COUNT=0",
    "FREQ=DAILY;COUNT=9999999999999999999999",
    "FREQ=DAILY;COUNT=2x",
    "FREQ=DAILY;WKST=1MO",
    "FREQ=DAILY;WKST=XX",
    "FREQ=DAILY;UNTIL=20260102",
    "FREQ=DAILY;UNTIL=20260102T090000",
    "FREQ=DAILY;BYDAY=XX",
    "FREQ=DAILY;BYDAY=TH,",
    "FREQ=MONTHLY;BYDAY=0TH",
    "FREQ=YEARLY;BYDAY=-54TH",
    "FREQ=DAILY;BYDAY=1TH",
    "FREQ=WEEKLY;BYDAY=-1TH",
    "FREQ=WEEKLY;BYMONTHDAY=1",
    "FREQ=MONTHLY;BYMONTHDAY=0",
    "FREQ=MONTHLY;BYMONTHDAY=-32",
    "FREQ=MONTHLY;BYMONTHDAY=1.5",
    "FREQ=MONTHLY;BYMONTHDAY=1,",
    "FREQ=YEARLY;BYMONTH=13",
    "FREQ=YEARLY;BYMONTH=-1",
    "FREQ=YEARLY;BYMONTH=0",
    "FREQ=DAILY;BYDAY=TH;byday=MO",
    `FREQ=DAILY;${"X".repeat(4096)}`,
  ])("rejects malformed rule %s", (rrule) => rejects({ ...base, rrule }, "invalid-rule"));

  it.each([
    "2026-02-30T09:00:00",
    "2026-01-01",
    "20260101T090000",
    "2026-01-01T09:00:00Z",
    "2026-01-01T09:00:00+01:00",
    "2026-01-01T09:00:00.001",
    "2026-01-01T24:00:00",
    "2026-01-01T23:59:60",
    "0000-01-01T09:00:00",
    "10000-01-01T09:00:00",
    "secret",
  ])("rejects invalid or unsupported DTSTART %s", (start) =>
    rejects({ ...base, start }, "invalid-date"));

  it.each([
    null,
    undefined,
    [],
    1,
    "event",
    { ...base, extra: true },
    { ...base, durationMs: 0 },
    { ...base, durationMs: -1 },
    { ...base, durationMs: 0.5 },
    { ...base, durationMs: Infinity },
    { ...base, maxOccurrences: 0 },
    { ...base, maxOccurrences: null },
    { ...base, maxOccurrences: 1.5 },
    { ...base, maxOccurrences: MAX_OCCURRENCES + 1 },
    { ...base, exdates: "2026-01-01T09:00:00" },
    { ...base, rdates: null },
  ])("rejects bad input %#", (input) => rejects(input, "invalid-input"));

  it.each([
    null,
    [],
    { ...window, extra: true },
    { start: window.end, end: window.start },
    { start: window.start, end: window.start },
  ])("rejects bad window %#", (range) => rejects(base, "invalid-input", range));

  it.each([
    NaN,
    Infinity,
    0.5,
    Number.MAX_SAFE_INTEGER,
    -62_135_596_800_001,
  ])("rejects invalid instant %s", (start) => rejects(base, "invalid-date", { ...window, start }));

  it.each(["", "Not/A_Zone", "+01:00", undefined, null, 3])("rejects invalid zone %#", (timeZone) =>
    rejects({ ...base, timeZone }, "invalid-zone"));

  it("rejects inconsistent starts, invalid dates, absent fields, and explicit nonexistent wall times", () => {
    rejects({ ...base, rrule: "FREQ=WEEKLY;BYDAY=MO" }, "start-mismatch");
    rejects({ ...base, rrule: "FREQ=DAILY;UNTIL=20251231T235959Z" }, "start-mismatch");
    rejects({ ...base, rrule: "FREQ=DAILY;UNTIL=20260230T090000Z" }, "invalid-date");
    rejects(base, "invalid-date", {});
    rejects({ ...base, rrule: null }, "invalid-rule");
    rejects({ timeZone: "UTC", durationMs: 1 }, "invalid-date");
    rejects({ ...base, exdates: [null] }, "invalid-date");
    rejects({ ...base, exdates: new Array(1) }, "invalid-date");
    rejects(
      { ...base, start: "2026-03-08T02:30:00", timeZone: "America/New_York" },
      "nonexistent-time",
    );
    rejects(
      { ...base, timeZone: "America/New_York", rdates: ["2026-03-08T02:30:00"] },
      "nonexistent-time",
    );
    rejects(
      { ...base, timeZone: "America/New_York", exdates: ["2026-03-08T02:30:00"] },
      "nonexistent-time",
    );
    rejects({ ...base, rdates: ["2026-01-02T00:00:00/2026-01-02T01:00:00"] }, "invalid-date");
    rejects({ ...base, start: "9999-12-31T23:59:59" }, "invalid-date");
    rejects({ ...base, rdates: ["9999-12-31T23:59:59Z"] }, "invalid-date");
  });
});

describe("bounded, fail-closed expansion", () => {
  it("allows exactly the cap, counts distinct visible starts, and never truncates", () => {
    expect(
      expandRecurrence({ ...base, rrule: "FREQ=DAILY;COUNT=2", maxOccurrences: 2 }, window),
    ).toHaveLength(2);
    rejects({ ...base, rrule: "FREQ=DAILY;COUNT=3", maxOccurrences: 2 }, "limit-exceeded");
    rejects({ ...base, maxOccurrences: 1, rdates: ["2026-01-02T09:00:00Z"] }, "limit-exceeded");
    expect(
      expandRecurrence({ ...base, maxOccurrences: 1, rdates: [base.start, base.start] }, window),
    ).toHaveLength(1);
    expect(
      expandRecurrence(
        { ...base, maxOccurrences: 1, rrule: "FREQ=DAILY;COUNT=2", exdates: [base.start] },
        window,
      ),
    ).toHaveLength(1);
    const longWindow = { start: window.start, end: Date.parse("2054-01-01T00:00:00Z") };
    rejects({ ...base, rrule: "FREQ=DAILY" }, "limit-exceeded", longWindow);
  });

  it("limits explicit date input lengths and scans of sparse rules", () => {
    rejects({ ...base, exdates: Array(MAX_OCCURRENCES + 1).fill(base.start) }, "limit-exceeded");
    rejects({ ...base, rdates: Array(MAX_OCCURRENCES + 1).fill(base.start) }, "limit-exceeded");
    const first = {
      ...base,
      start: "0001-01-01T09:00:00",
      rrule: "FREQ=YEARLY;INTERVAL=2147483647",
    };
    rejects(first, "limit-exceeded");
    // The exact scan boundary is inclusive of DTSTART and independent of output count.
    const seed = Date.parse("0001-01-01T00:00:00Z");
    expect(
      expandRecurrence(first, { start: seed, end: seed + (MAX_SCAN_DAYS - 3) * 86_400_000 }),
    ).toHaveLength(1);
  });

  it("handles first and last supported years and an entirely future seed", () => {
    const first = Date.parse("0001-01-01T00:00:00Z");
    expect(
      expandRecurrence(
        { ...base, start: "0001-01-01T09:00:00", rrule: "FREQ=DAILY;COUNT=1" },
        { start: first, end: first + 86_400_000 },
      ),
    ).toEqual([{ start: first + 32_400_000, end: first + 36_000_000 }]);
    const last = Date.parse("9999-12-31T00:00:00Z");
    expect(
      expandRecurrence(
        { ...base, start: "9999-12-31T09:00:00", rrule: "FREQ=DAILY" },
        { start: last, end: last + 86_400_000 - 1 },
      ),
    ).toHaveLength(1);
    expect(
      expandRecurrence({ ...base, start: "2028-01-01T09:00:00", rrule: "FREQ=DAILY" }, window),
    ).toEqual([]);
  });
});
