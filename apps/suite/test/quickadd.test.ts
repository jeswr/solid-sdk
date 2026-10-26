// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  parseQuickAdd,
  type QuickAddContext,
  type RecurrenceRule,
} from "../src/apps/tasks/lib/quickadd";

const ctx: QuickAddContext = { now: new Date("2026-10-23T11:00:00Z"), tz: "Europe/London" };
const date = (value: string) => ({ kind: "date", date: value });
const timed = (value: string, timeZone = "Europe/London") => ({
  kind: "dateTime",
  dateTime: value,
  timeZone,
});

const dates = [
  ["today", "2026-10-23"],
  ["tomorrow", "2026-10-24"],
  ["yesterday", "2026-10-22"],
  ["next week", "2026-10-30"],
  ["in 2 days", "2026-10-25"],
  ["in 3 weeks", "2026-11-13"],
  ["in a month", "2026-11-23"],
  ["next month", "2026-11-23"],
  ["in 2 years", "2028-10-23"],
  ["Monday", "2026-10-26"],
  ["Tue", "2026-10-27"],
  ["Wednesday", "2026-10-28"],
  ["Thursday", "2026-10-29"],
  ["Saturday", "2026-10-24"],
  ["Sunday", "2026-10-25"],
  ["next Friday", "2026-10-30"],
  ["3 November", "2026-11-03"],
  ["November 3", "2026-11-03"],
  ["May 5", "2027-05-05"],
  ["March 2", "2027-03-02"],
  ["2027-01-02", "2027-01-02"],
  ["1 Jan 2027", "2027-01-01"],
  ["31/12/2026", "2026-12-31"],
  ["10/11/2026", "2026-11-10"],
  ["29 February 2028", "2028-02-29"],
] as const;

describe("English date phrases", () => {
  it.each(dates)("parses %s", (phrase, expected) => {
    const input = `File report ${phrase}`;
    const result = parseQuickAdd(input, ctx);
    expect(result.title).toBe("File report");
    expect(result.due).toEqual(date(expected));
    expect(result.spans).toEqual([{ kind: "due", start: 12, end: input.length, text: phrase }]);
  });
  it.each([
    ["tomorrow 5pm", "2026-10-24T16:00:00.000Z"],
    ["tomorrow at 17:30", "2026-10-24T16:30:00.000Z"],
    ["today at noon", "2026-10-23T11:00:00.000Z"],
    ["tomorrow at midnight", "2026-10-23T23:00:00.000Z"],
    ["5pm", "2026-10-23T16:00:00.000Z"],
    ["next month at 5pm", "2026-11-23T17:00:00.000Z"],
    ["9am", "2026-10-24T08:00:00.000Z"],
    ["Monday 8:15am", "2026-10-26T08:15:00.000Z"],
    ["tomorrow 5pm UTC", "2026-10-24T17:00:00.000Z"],
    ["2026-12-01T09:30:00+02:00", "2026-12-01T07:30:00.000Z"],
  ])("parses timed phrase %s", (phrase, expected) => {
    const result = parseQuickAdd(`Call Robin ${phrase}`, ctx);
    expect(result.due).toEqual(timed(expected));
    expect(result.title).toBe("Call Robin");
  });
  it.each([
    ["en-GB", "2026-11-10"],
    ["en-US", "2026-10-11"],
  ] as const)("uses %s numeric dates", (locale, expected) => {
    expect(parseQuickAdd("Review 10/11/2026", { ...ctx, locale }).due).toEqual(date(expected));
  });
  it("takes the first date and keeps later text", () => {
    expect(parseQuickAdd("Review tomorrow then Monday", ctx)).toMatchObject({
      title: "Review then Monday",
      due: date("2026-10-24"),
    });
  });
});

const rules: [string, RecurrenceRule, string][] = [
  ["daily", { freq: "DAILY", interval: 1 }, "2026-10-23"],
  ["every day", { freq: "DAILY", interval: 1 }, "2026-10-23"],
  [
    "every weekday",
    {
      freq: "WEEKLY",
      interval: 1,
      byDay: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    "2026-10-23",
  ],
  ["weekly", { freq: "WEEKLY", interval: 1 }, "2026-10-23"],
  ["every week", { freq: "WEEKLY", interval: 1 }, "2026-10-23"],
  ["monthly", { freq: "MONTHLY", interval: 1 }, "2026-10-23"],
  ["every month", { freq: "MONTHLY", interval: 1 }, "2026-10-23"],
  ["yearly", { freq: "YEARLY", interval: 1 }, "2026-10-23"],
  ["every year", { freq: "YEARLY", interval: 1 }, "2026-10-23"],
  ["every 2 days", { freq: "DAILY", interval: 2 }, "2026-10-23"],
  ["every 3 weeks", { freq: "WEEKLY", interval: 3 }, "2026-10-23"],
  ["every 4 months", { freq: "MONTHLY", interval: 4 }, "2026-10-23"],
  ["every 5 years", { freq: "YEARLY", interval: 5 }, "2026-10-23"],
  ["every 1 day", { freq: "DAILY", interval: 1 }, "2026-10-23"],
  ["EVERY   MONDAY", { freq: "WEEKLY", interval: 1, byDay: ["Monday"] }, "2026-10-26"],
  ["every mon", { freq: "WEEKLY", interval: 1, byDay: ["Monday"] }, "2026-10-26"],
  ["every tuesday", { freq: "WEEKLY", interval: 1, byDay: ["Tuesday"] }, "2026-10-27"],
  ["every tue", { freq: "WEEKLY", interval: 1, byDay: ["Tuesday"] }, "2026-10-27"],
  ["every wednesday", { freq: "WEEKLY", interval: 1, byDay: ["Wednesday"] }, "2026-10-28"],
  ["every wed", { freq: "WEEKLY", interval: 1, byDay: ["Wednesday"] }, "2026-10-28"],
  ["every thursday", { freq: "WEEKLY", interval: 1, byDay: ["Thursday"] }, "2026-10-29"],
  ["every thu", { freq: "WEEKLY", interval: 1, byDay: ["Thursday"] }, "2026-10-29"],
  ["every friday", { freq: "WEEKLY", interval: 1, byDay: ["Friday"] }, "2026-10-23"],
  ["every fri", { freq: "WEEKLY", interval: 1, byDay: ["Friday"] }, "2026-10-23"],
  ["every saturday", { freq: "WEEKLY", interval: 1, byDay: ["Saturday"] }, "2026-10-24"],
  ["every sat", { freq: "WEEKLY", interval: 1, byDay: ["Saturday"] }, "2026-10-24"],
  ["every sunday", { freq: "WEEKLY", interval: 1, byDay: ["Sunday"] }, "2026-10-25"],
  ["every sun", { freq: "WEEKLY", interval: 1, byDay: ["Sunday"] }, "2026-10-25"],
  ...[1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((day): [string, RecurrenceRule, string] => {
    const ordinal = (
      {
        1: "1st",
        2: "2nd",
        3: "3rd",
        4: "4th",
        11: "11th",
        12: "12th",
        13: "13th",
        21: "21st",
        22: "22nd",
        23: "23rd",
        31: "31st",
      } as Record<number, string>
    )[day];
    return [
      `every ${ordinal}`,
      { freq: "MONTHLY", interval: 1, byMonthDay: [day] },
      `2026-${day < 23 ? "11" : "10"}-${String(day).padStart(2, "0")}`,
    ];
  }),
];

describe("recurrence before dates", () => {
  it.each(rules)("parses %s", (phrase, recurrence, due) => {
    const result = parseQuickAdd(`Water plants ${phrase}`, ctx);
    expect(result).toMatchObject({ title: "Water plants", recurrence, due: date(due) });
    expect(result.spans).toEqual([
      { kind: "recurrence", start: 13, end: 13 + phrase.length, text: phrase },
    ]);
  });
  it("uses an explicit date with recurrence", () => {
    expect(parseQuickAdd("Water plants tomorrow every Monday", ctx)).toMatchObject({
      title: "Water plants",
      recurrence: { freq: "WEEKLY", interval: 1, byDay: ["Monday"] },
      due: date("2026-10-24"),
    });
  });
  it("combines a lone time with the next matching weekday", () => {
    expect(parseQuickAdd("Water plants 5pm every Monday", ctx).due).toEqual(
      timed("2026-10-26T17:00:00.000Z"),
    );
  });
  it.each([
    ["in 2 years", date("2028-10-23")],
    ["next year at 5pm", timed("2027-10-23T16:00:00.000Z")],
    ["in a month", date("2026-11-23")],
    ["next month at 5pm", timed("2026-11-23T17:00:00.000Z")],
  ])("preserves calendar-relative deadline %s with recurrence", (phrase, due) => {
    const input = `Review daily ${phrase}`;
    expect(parseQuickAdd(input, ctx)).toMatchObject({
      title: "Review",
      recurrence: { freq: "DAILY", interval: 1 },
      due,
      spans: [
        { kind: "recurrence", start: 7, end: 12, text: "daily" },
        { kind: "due", start: 13, end: input.length, text: phrase },
      ],
    });
  });
  it("skips weekends", () => {
    expect(
      parseQuickAdd("Water plants every weekday", { ...ctx, now: new Date("2026-10-24T12:00:00Z") })
        .due,
    ).toEqual(date("2026-10-26"));
  });
  it("skips months without the requested day", () => {
    expect(
      parseQuickAdd("Water plants every 31st", { ...ctx, now: new Date("2026-04-30T12:00:00Z") })
        .due,
    ).toEqual(date("2026-05-31"));
  });
  it("keeps conflicting recurrence text without interpreting it as a date", () => {
    expect(parseQuickAdd("Walk daily every Monday", ctx)).toMatchObject({
      title: "Walk every Monday",
      recurrence: { freq: "DAILY", interval: 1 },
      due: date("2026-10-23"),
    });
  });
});

describe("ambiguity and literal text", () => {
  it.each([
    "",
    "   ",
    "Plan a trip",
    "We may go",
    "may",
    "May",
    "march on",
    "March on with plans",
    "Check January",
    "June is a name",
    "Learn C#",
    "Review #",
    "Email @",
    "Plan p0",
    "Plan p5",
    "Plan p10",
    "Plan ap1",
    "Plan p1x",
    "Email robin@example.org",
    "Visit https://example.org/may",
    "Visit https://example.org/2026-11-03",
    "Visit https://example.org/#Home",
    "Keep !9am",
    "Keep !noon",
    "Keep !midnight",
    "Keep !now",
    "Keep !in 30 minutes",
    "Keep !in half an hour",
    "Keep !in 1 hour and 30 minutes",
    "Keep !next hour",
    "Keep !tomorrow at 5pm",
    "Keep !next month at 5pm",
    "Keep !at noon",
    "Keep !nonsense",
    "Keep !",
    "Keep !9:30am",
    "Keep ! 1h before",
    "Keep !1h before",
    "Call !14:00",
    "Call ! 00:15",
    "Call !23:59:30",
    "Call !1 hour before",
    "Call !30 minutes before",
    "Call !2 days before",
    "Call !one hour before",
    "Call !two hours before",
    "Call !a day before",
    "Call !an hour before",
    "Call !14:00 !two hours before",
    "Walk everyday",
    "Walk monthlyish",
    "Walk every 0 days",
    "Walk every 9007199254740992 weeks",
    "Walk every 32nd",
    "Walk every 0th",
    "Walk every 11st",
    "Walk every 3rd Friday",
    "Review 30 February 2027",
    "Review from Monday to Friday",
  ])("preserves %j", (input) => {
    expect(parseQuickAdd(input, ctx)).toEqual({
      title: input.trim().replace(/\s+/g, " "),
      priority: 4,
      labels: [],
      spans: [],
    });
  });
  it("collapses whitespace without changing original offsets", () => {
    const input = "  🪴 Water\tplants\n tomorrow  @garden ";
    const result = parseQuickAdd(input, ctx);
    expect(result.title).toBe("🪴 Water plants");
    for (const span of result.spans) expect(input.slice(span.start, span.end)).toBe(span.text);
    expect(result.spans.map((span) => span.start)).toEqual([19, 29]);
  });
});

describe("metadata and spans", () => {
  it("keeps highlight spans disjoint when metadata separates date and time", () => {
    const input = "Pay tomorrow p1 5pm #Home";
    const result = parseQuickAdd(input, ctx);
    expect(result.due).toEqual(date("2026-10-24"));
    expect(result.title).toBe("Pay 5pm");
    for (let i = 1; i < result.spans.length; i++) {
      expect(result.spans[i]?.start).toBeGreaterThanOrEqual(result.spans[i - 1]?.end ?? 0);
    }
  });

  it.each([1, 2, 3, 4] as const)("reads priority p%d", (priority) => {
    expect(parseQuickAdd(`Pay rent P${priority}`, ctx)).toMatchObject({
      title: "Pay rent",
      priority,
    });
  });
  it("parses the brief's combined example", () => {
    const input = "Pay rent tomorrow 5pm p1 #Home @bills every month";
    expect(parseQuickAdd(input, ctx)).toEqual({
      title: "Pay rent",
      due: timed("2026-10-24T16:00:00.000Z"),
      recurrence: { freq: "MONTHLY", interval: 1 },
      priority: 1,
      project: "Home",
      labels: ["bills"],
      spans: [
        { kind: "due", start: 9, end: 21, text: "tomorrow 5pm" },
        { kind: "priority", start: 22, end: 24, text: "p1" },
        { kind: "project", start: 25, end: 30, text: "#Home" },
        { kind: "label", start: 31, end: 37, text: "@bills" },
        { kind: "recurrence", start: 38, end: 49, text: "every month" },
      ],
    });
  });
  it("returns unresolved names including Unicode", () => {
    expect(parseQuickAdd("#Unknown Pay @bills @café_work @house-plants", ctx)).toMatchObject({
      title: "Pay",
      project: "Unknown",
      labels: ["bills", "café_work", "house-plants"],
    });
  });
  it("does not parse dates within names or duplicate singleton tokens", () => {
    expect(parseQuickAdd("Pay #Home #tomorrow p2 p1 @Monday", ctx)).toMatchObject({
      title: "Pay #tomorrow p1",
      project: "Home",
      priority: 2,
      labels: ["Monday"],
    });
    expect(parseQuickAdd("Pay #Home #tomorrow p2 p1 @Monday", ctx).due).toBeUndefined();
  });
  it("deduplicates labels but highlights every occurrence", () => {
    const result = parseQuickAdd("Pay @bills @BILLS", ctx);
    expect(result.labels).toEqual(["bills"]);
    expect(result.spans).toHaveLength(2);
    expect(result.title).toBe("Pay");
  });
  it("can return an empty title", () => {
    expect(parseQuickAdd("tomorrow p1 #Home @bills daily", ctx).title).toBe("");
  });
  it("retains a due phrase on request with metadata on both sides", () => {
    const result = parseQuickAdd("p1 Pay tomorrow #Home", { ...ctx, keepDateText: true });
    expect(result.title).toBe("Pay tomorrow");
    expect(result.due).toEqual(date("2026-10-24"));
    expect(result.spans.map((span) => span.kind)).toEqual(["priority", "due", "project"]);
  });
  it("retains punctuation around tokens", () => {
    expect(parseQuickAdd("Pay p1, @bills.", ctx)).toMatchObject({
      title: "Pay , .",
      priority: 1,
      labels: ["bills"],
    });
  });
});

describe("time zones, DST and determinism", () => {
  it.each([
    ["in 2 hours", "2026-03-08T04:30:00.000Z"],
    ["in2hours", "2026-03-08T04:30:00.000Z"],
    ["in 1 hour and 2 hours", "2026-03-08T04:30:00.000Z"],
    ["now", "2026-03-08T02:30:00.000Z"],
    ["in 30 minutes", "2026-03-08T03:00:00.000Z"],
    ["in 45 seconds", "2026-03-08T02:30:45.000Z"],
    ["in half an hour", "2026-03-08T03:00:00.000Z"],
    ["in a couple of hours", "2026-03-08T04:30:00.000Z"],
    ["in a few minutes", "2026-03-08T02:33:00.000Z"],
    ["in several seconds", "2026-03-08T02:30:07.000Z"],
    ["in 1.5 seconds", "2026-03-08T02:30:01.500Z"],
    ["next hour", "2026-03-08T03:30:00.000Z"],
    ["last hour", "2026-03-08T01:30:00.000Z"],
    ["two hours ago", "2026-03-08T00:30:00.000Z"],
    ["in 1 year 1 hour", "2027-03-08T03:30:00.000Z"],
    ["in 1 quarter 1 hour", "2026-06-08T03:30:00.000Z"],
    ["in 1 month 1 hour", "2026-04-08T03:30:00.000Z"],
    ["in 1 week 1 hour", "2026-03-15T03:30:00.000Z"],
    ["in 1 day 1 hour", "2026-03-09T03:30:00.000Z"],
    ["in half a year 1 hour", "2026-09-08T03:30:00.000Z"],
    ["in half a quarter 1 hour", "2026-04-22T03:30:00.000Z"],
    ["in half a week 1 hour", "2026-03-12T03:30:00.000Z"],
    ["in half a day 1 hour", "2026-03-08T15:30:00.000Z"],
  ])("resolves %s at a host DST gap using the injected instant", (phrase, expected) => {
    const result = parseQuickAdd(`Call ${phrase}`, {
      now: new Date("2026-03-08T02:30:00Z"),
      tz: "UTC",
    });
    expect(result.due).toEqual(timed(expected, "UTC"));
    expect(result.title).toBe("Call");
    expect(result.spans).toEqual([{ kind: "due", start: 5, end: 5 + phrase.length, text: phrase }]);
  });
  it.each([
    ["2026-03-08T01:30:00Z", "2026-03-08T03:30:00.000Z"],
    ["2026-11-01T00:30:00Z", "2026-11-01T02:30:00.000Z"],
  ])("crosses host DST changes from %s by elapsed hours", (now, expected) => {
    expect(parseQuickAdd("Call in 2 hours", { now: new Date(now), tz: "UTC" }).due).toEqual(
      timed(expected, "UTC"),
    );
  });
  it.each([
    ["Europe/London", "2026-10-23T11:00:00Z", "in 2 hours", "2026-10-23T13:00:00.000Z"],
    ["America/New_York", "2026-10-23T11:00:00Z", "in 30 minutes", "2026-10-23T11:30:00.000Z"],
    ["Asia/Kolkata", "2026-10-23T11:00:00Z", "in two hours", "2026-10-23T13:00:00.000Z"],
    ["Pacific/Kiritimati", "2026-10-23T11:00:00Z", "in 45 seconds", "2026-10-23T11:00:45.000Z"],
    ["Europe/London", "2026-03-29T00:30:00Z", "in 2 hours", "2026-03-29T02:30:00.000Z"],
    ["Europe/London", "2026-10-25T00:30:00Z", "in 2 hours", "2026-10-25T02:30:00.000Z"],
    ["Europe/London", "2026-10-23T11:00:00Z", "now", "2026-10-23T11:00:00.000Z"],
  ])("resolves elapsed time in %s / %s / %s", (tz, now, phrase, expected) => {
    const result = parseQuickAdd(`Call ${phrase}`, { tz, now: new Date(now) });
    expect(result.due).toEqual(timed(expected, tz));
    expect(result.title).toBe("Call");
    expect(result.spans).toEqual([{ kind: "due", start: 5, end: 5 + phrase.length, text: phrase }]);
  });
  it.each([
    ["Europe/London", "2026-10-23T11:30:00Z", "12pm UTC", "2026-10-23T12:00:00.000Z"],
    ["Europe/London", "2026-10-23T11:30:00Z", "11am UTC", "2026-10-24T11:00:00.000Z"],
    ["Europe/London", "2026-10-23T11:30:00Z", "12pm +0000", "2026-10-23T12:00:00.000Z"],
    ["Europe/London", "2026-10-23T11:30:00Z", "2pm +0200", "2026-10-23T12:00:00.000Z"],
    ["America/New_York", "2026-10-23T11:30:00Z", "9am UTC", "2026-10-24T09:00:00.000Z"],
    ["Pacific/Kiritimati", "2026-10-23T11:30:00Z", "12pm UTC", "2026-10-23T12:00:00.000Z"],
    ["America/Los_Angeles", "2026-10-23T01:00:00Z", "2am UTC", "2026-10-23T02:00:00.000Z"],
    ["Europe/London", "2026-10-23T23:30:00Z", "2am +0200", "2026-10-24T00:00:00.000Z"],
  ])("infers upcoming explicit-zone times in %s / %s / %s", (tz, now, phrase, expected) => {
    const input = `Call ${phrase} then tomorrow`;
    const result = parseQuickAdd(input, { tz, now: new Date(now) });
    expect(result.due).toEqual(timed(expected, tz));
    expect(result.title).toBe("Call then tomorrow");
    expect(result.spans).toEqual([{ kind: "due", start: 5, end: 5 + phrase.length, text: phrase }]);
  });
  it.each([
    ["!14:00", "2026-10-24T16:00:00.000Z"],
    ["!in 30 minutes", "2026-10-24T16:00:00.000Z"],
    ["!in two hours", "2026-10-24T16:00:00.000Z"],
    ["!in 1 hour and 30 minutes", "2026-10-24T16:00:00.000Z"],
    ["!in half an hour", "2026-10-24T16:00:00.000Z"],
    ["!noon", "2026-10-24T16:00:00.000Z"],
    ["!midnight", "2026-10-24T16:00:00.000Z"],
    ["!now", "2026-10-24T16:00:00.000Z"],
    ["!at noon", "2026-10-24T16:00:00.000Z"],
    ["!next month at 9am", "2026-10-24T16:00:00.000Z"],
    ["!Monday at 9am", "2026-10-24T16:00:00.000Z"],
    ["!two hours before", "2026-10-24T16:00:00.000Z"],
    ["!30 minutes before", "2026-10-24T16:00:00.000Z"],
  ])("keeps reminder %s beside a deadline", (reminder, expected) => {
    for (const input of [`Call ${reminder} tomorrow 5pm p1`, `Call tomorrow 5pm ${reminder} p1`]) {
      const result = parseQuickAdd(input, ctx);
      expect(result.due).toEqual(timed(expected));
      expect(result.title).toBe(`Call ${reminder}`);
      expect(result.priority).toBe(1);
      for (const span of result.spans) expect(input.slice(span.start, span.end)).toBe(span.text);
      expect(result.spans.map((span) => span.text)).toEqual(["tomorrow 5pm", "p1"]);
    }
  });
  it.each([
    ["Europe/London", "2026-03-28T12:00:00Z", "tomorrow 9am", "2026-03-29T08:00:00.000Z"],
    ["Europe/London", "2026-10-24T12:00:00Z", "tomorrow 9am", "2026-10-25T09:00:00.000Z"],
    ["Europe/London", "2026-10-24T12:00:00Z", "tomorrow 1:30am", "2026-10-25T00:30:00.000Z"],
    ["America/New_York", "2026-03-07T12:00:00Z", "tomorrow 9am", "2026-03-08T13:00:00.000Z"],
    ["America/New_York", "2026-10-31T12:00:00Z", "tomorrow 1:30am", "2026-11-01T05:30:00.000Z"],
    ["Asia/Kolkata", "2026-10-23T12:00:00Z", "tomorrow 9am", "2026-10-24T03:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-04-04T00:00:00Z", "tomorrow 1:45am", "2026-04-04T14:45:00.000Z"],
    ["UTC", "2026-12-31T23:30:00Z", "tomorrow 9am", "2027-01-01T09:00:00.000Z"],
    ["Europe/London", "2026-10-23T11:00:00Z", "in 2 days at 5pm", "2026-10-25T17:00:00.000Z"],
    ["Europe/London", "2026-03-27T12:00:00Z", "in 2 days at 5pm", "2026-03-29T16:00:00.000Z"],
  ])("converts %s / %s / %s", (tz, now, phrase, expected) => {
    expect(parseQuickAdd(`Call Robin ${phrase}`, { tz, now: new Date(now) }).due).toEqual(
      timed(expected, tz),
    );
  });
  it.each([
    ["Europe/London", "2026-03-28T12:00:00Z", "tomorrow 1:30am"],
    ["America/New_York", "2026-03-07T12:00:00Z", "tomorrow 2:30am"],
    ["Australia/Lord_Howe", "2026-10-03T00:00:00Z", "tomorrow 2:15am"],
  ])("preserves nonexistent wall times in %s", (tz, now, phrase) => {
    expect(parseQuickAdd(`Call Robin ${phrase}`, { tz, now: new Date(now) })).toEqual({
      title: `Call Robin ${phrase}`,
      priority: 4,
      labels: [],
      spans: [],
    });
  });
  it.each([
    ["Pacific/Kiritimati", "2026-10-24"],
    ["America/Los_Angeles", "2026-10-23"],
  ])("derives today in %s", (tz, expected) => {
    expect(parseQuickAdd("Pay today", { tz, now: new Date("2026-10-24T01:00:00Z") }).due).toEqual(
      date(expected),
    );
  });
  it("derives recurrence from local today", () => {
    expect(
      parseQuickAdd("Pay every Sunday", {
        tz: "Pacific/Kiritimati",
        now: new Date("2026-10-24T23:00:00Z"),
      }).due,
    ).toEqual(date("2026-10-25"));
  });
  it("rejects invalid injected clocks/zones", () => {
    expect(() => parseQuickAdd("Pay", { ...ctx, now: new Date(Number.NaN) })).toThrow(RangeError);
    expect(() => parseQuickAdd("Pay", { ...ctx, tz: "Invalid/Zone" })).toThrow(RangeError);
  });
  it("does not mutate context or retain state between calls", () => {
    const before = ctx.now.toISOString();
    const input = "Pay tomorrow @bills #Home every 2 days";
    const first = parseQuickAdd(input, ctx);
    parseQuickAdd("Other every Monday", { now: new Date("2030-01-01T00:00:00Z"), tz: "UTC" });
    expect(parseQuickAdd(input, ctx)).toEqual(first);
    expect(ctx.now.toISOString()).toBe(before);
  });
});

describe("calendar, offset and reminder regressions", () => {
  it.each([
    ["this week Saturday 9am", timed("2026-10-24T09:00:00.000Z", "UTC")],
    ["this week Saturday", date("2026-10-24")],
    ["this week Sunday", date("2026-10-18")],
    ["this week Monday 9am", timed("2026-10-19T09:00:00.000Z", "UTC")],
    ["this week Tue", date("2026-10-20")],
    ["this week Wednesday", date("2026-10-21")],
    ["this week on Thurs. 9am", timed("2026-10-22T09:00:00.000Z", "UTC")],
    ["THIS WEEK FRIDAY 9AM", timed("2026-10-23T09:00:00.000Z", "UTC")],
    ["this weeks Sat. at 9am", timed("2026-10-24T09:00:00.000Z", "UTC")],
    ["this week, Saturday 9am", timed("2026-10-24T09:00:00.000Z", "UTC")],
    ["this week Saturday at noon", timed("2026-10-24T12:00:00.000Z", "UTC")],
  ] as const)("keeps the weekday qualifier in %s", (phrase, due) => {
    for (const locale of ["en-GB", "en-US"] as const) {
      for (const recurrence of ["", "daily "]) {
        const input = `Call ${recurrence}${phrase}`;
        const context = { ...ctx, tz: "UTC", locale };
        const result = parseQuickAdd(input, context);
        expect(result.due).toEqual(due);
        expect(result.title).toBe("Call");
        expect(result.spans.at(-1)).toEqual({
          kind: "due",
          start: 5 + recurrence.length,
          end: input.length,
          text: phrase,
        });
        expect(parseQuickAdd(input, { ...context, keepDateText: true }).title).toBe(
          `Call ${phrase}`,
        );
      }
    }
  });

  it.each([
    ["2026-11-01T00:30:00Z", "UTC", "this week Saturday 9am", "2026-11-07T09:00:00.000Z"],
    [
      "2026-11-01T00:30:00Z",
      "America/New_York",
      "this week Saturday 9am",
      "2026-10-31T13:00:00.000Z",
    ],
    [
      "2026-11-01T00:30:00Z",
      "Pacific/Kiritimati",
      "this week Saturday 9am",
      "2026-11-06T19:00:00.000Z",
    ],
    ["2027-01-01T00:30:00Z", "UTC", "this week Monday 9am", "2026-12-28T09:00:00.000Z"],
    ["2026-10-25T00:30:00Z", "Europe/London", "this week Saturday 9am", "2026-10-31T09:00:00.000Z"],
    [
      "2026-11-01T00:30:00Z",
      "America/New_York",
      "this week Saturday 9am UTC",
      "2026-11-07T09:00:00.000Z",
    ],
    ["2026-11-01T00:30:00Z", "UTC", "this week Saturday 9am -0400", "2026-10-31T13:00:00.000Z"],
  ])("resolves qualified weeks in %s / %s / %s", (now, tz, phrase, expected) => {
    const input = `Call ${phrase} then tomorrow`;
    const result = parseQuickAdd(input, { now: new Date(now), tz });
    expect(result.due).toEqual(timed(expected, tz));
    expect(result.title).toBe("Call then tomorrow");
    expect(result.spans).toEqual([{ kind: "due", start: 5, end: 5 + phrase.length, text: phrase }]);
  });

  it.each([
    "this week next Saturday 9am",
    "this week last Saturday",
    "this week past Saturday",
    "this week weekend 9am",
    "this week weekday",
    "this week Saturday 3 November",
    "this week Saturday Tuesday",
    "this week Saturday afternoon",
    "this week (Saturday) 9am",
  ])("rejects unsupported week qualifier %s with a typed error", (phrase) => {
    expect(() => parseQuickAdd(`Call ${phrase}`, ctx)).toThrow(RangeError);
    expect(() => parseQuickAdd(`Call ${phrase}`, ctx)).toThrow(
      "Unsupported quick-add week qualifier",
    );
  });

  it.each([
    ["2026-11-01T00:30:00Z", "UTC", "this month", date("2026-11-01")],
    ["2026-11-01T00:30:00Z", "UTC", "this week", date("2026-11-01")],
    ["2027-01-01T00:30:00Z", "UTC", "this year", date("2027-01-01")],
    ["2026-11-01T00:30:00Z", "America/New_York", "this month", date("2026-10-01")],
    ["2026-11-01T00:30:00Z", "Asia/Kolkata", "this month", date("2026-11-01")],
    ["2026-11-01T00:30:00Z", "UTC", "this month at 5pm", timed("2026-11-01T17:00:00.000Z", "UTC")],
    ["2026-11-01T00:30:00Z", "UTC", "this week at 5pm", timed("2026-11-01T17:00:00.000Z", "UTC")],
    ["2027-01-01T00:30:00Z", "UTC", "this year at 5pm", timed("2027-01-01T17:00:00.000Z", "UTC")],
    [
      "2026-11-01T00:30:00Z",
      "America/New_York",
      "this month 5pm UTC",
      timed("2026-11-01T17:00:00.000Z", "America/New_York"),
    ],
  ] as const)("resolves %s / %s / %s independently of host TZ", (now, tz, phrase, due) => {
    for (const recurrence of ["", "daily "]) {
      const input = `Review ${recurrence}${phrase}`;
      const result = parseQuickAdd(input, { now: new Date(now), tz });
      expect(result.due).toEqual(due);
      expect(result.title).toBe("Review");
      expect(result.spans.at(-1)).toEqual({
        kind: "due",
        start: 7 + recurrence.length,
        end: input.length,
        text: phrase,
      });
    }
  });

  it.each([
    "2 hours before 5pm",
    "2 hours after 5pm",
    "2 hours before Monday",
    "2 hours before every Monday",
    "2 days after 3 November",
    "2 hours before tomorrow 5pm",
    "2 hours before an unresolved event",
    "2 hours before",
    "2 days since Monday",
    "2 hours from Monday",
    "5pm +2 hours",
    "5pm -2 hours",
    "tomorrow then 2 hours before an unresolved event",
  ])("preserves unsupported anchored offset %s without a partial deadline", (phrase) => {
    for (const recurrence of ["", "daily "]) {
      const input = `Call ${recurrence}${phrase} p1 @calls`;
      const result = parseQuickAdd(input, { ...ctx, tz: "UTC" });
      expect(result.due).toBeUndefined();
      expect(result.title).toBe(`Call ${recurrence}${phrase}`);
      expect(result.recurrence).toBeUndefined();
      expect(result.priority).toBe(1);
      expect(result.labels).toEqual(["calls"]);
      expect(result.spans.some((span) => span.kind === "due")).toBe(false);
    }
  });

  it.each([
    ["in 1h30m", "2026-10-23T12:30:00.000Z"],
    ["-2 hours", "2026-10-23T09:00:00.000Z"],
    ["+2 hours", "2026-10-23T13:00:00.000Z"],
    ["2 hours from now", "2026-10-23T13:00:00.000Z"],
    ["in 1h30m45s", "2026-10-23T12:30:45.000Z"],
    ["in 1d2h30m", "2026-10-24T13:30:00.000Z"],
    ["1h30m ago", "2026-10-23T09:30:00.000Z"],
    ["in 1h30m2h", "2026-10-23T13:30:00.000Z"],
  ])("keeps every compact duration unit in %s", (phrase, expected) => {
    const input = `Call ${phrase}`;
    expect(parseQuickAdd(input, { ...ctx, tz: "UTC" })).toEqual({
      title: "Call",
      due: timed(expected, "UTC"),
      priority: 4,
      labels: [],
      spans: [{ kind: "due", start: 5, end: input.length, text: phrase }],
    });
  });

  it.each([
    "!9am on Monday",
    "!14:00 on 3 November",
    "!noon on 2026-11-03",
    "!in 1h30m",
  ])("preserves connected reminder %s without inventing a deadline", (reminder) => {
    expect(parseQuickAdd(`Call ${reminder}`, ctx)).toEqual({
      title: `Call ${reminder}`,
      priority: 4,
      labels: [],
      spans: [],
    });
    for (const input of [`Call ${reminder} tomorrow 5pm p1`, `Call tomorrow 5pm ${reminder} p1`]) {
      const result = parseQuickAdd(input, ctx);
      expect(result.title).toBe(`Call ${reminder}`);
      expect(result.due).toEqual(timed("2026-10-24T16:00:00.000Z"));
      expect(result.spans.map((span) => span.text)).toEqual(["tomorrow 5pm", "p1"]);
      for (const span of result.spans) expect(input.slice(span.start, span.end)).toBe(span.text);
    }
  });
  it("keeps unresolved connected reminder qualifiers literal", () => {
    const input = "Call !9am on an unresolved event tomorrow";
    expect(parseQuickAdd(input, ctx)).toEqual({ title: input, priority: 4, labels: [], spans: [] });
  });
});
