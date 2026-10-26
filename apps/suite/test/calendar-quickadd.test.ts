// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type EventQuickAddContext,
  EventQuickAddError,
  type EventQuickAddErrorCode,
  parseEventQuickAdd,
} from "../src/apps/calendar/lib/quickadd";

const context = { now: new Date("2026-10-23T11:00:00Z"), tz: "Europe/London" };

function failure(input: string, code: EventQuickAddErrorCode, ctx = context): EventQuickAddError {
  try {
    parseEventQuickAdd(input, ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(EventQuickAddError);
    const typed = error as EventQuickAddError;
    expect(typed.code).toBe(code);
    expect(typed.name).toBe("EventQuickAddError");
    expect(typed.message).toBe(`Calendar quick add: ${code}`);
    expect(typed.title).toBe(input.trim().replace(/\s+/g, " "));
    expect(typed.issues.length).toBeGreaterThan(0);
    for (const issue of typed.issues) {
      expect(issue.code).toBe(code);
      expect(input.slice(issue.start, issue.end)).toBe(issue.text);
    }
    expect(typed).not.toHaveProperty("start");
    return typed;
  }
  throw new Error("Expected quick-add rejection");
}

describe("calendar quick-add drafts", () => {
  it("parses the combined lunch example without inferring any fields", () => {
    expect(
      parseEventQuickAdd("Lunch with Sam tomorrow 1pm at Cafe Rio for 90 minutes", context),
    ).toEqual({
      title: "Lunch with Sam",
      start: "2026-10-24T12:00:00.000Z",
      end: "2026-10-24T13:30:00.000Z",
      durationMinutes: 90,
      allDay: false,
      timeZone: "Europe/London",
      location: "Cafe Rio",
    });
  });

  it("parses the weekday standup example", () => {
    expect(parseEventQuickAdd("Standup every weekday 9:30", context)).toEqual({
      title: "Standup",
      start: "2026-10-26T09:30:00.000Z",
      allDay: false,
      timeZone: "Europe/London",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    });
  });

  it.each([
    ["today 12am", "2026-10-22T23:00:00.000Z"],
    ["today 12pm", "2026-10-23T11:00:00.000Z"],
    ["today noon", "2026-10-23T11:00:00.000Z"],
    ["today midnight", "2026-10-22T23:00:00.000Z"],
    ["today 00:00", "2026-10-22T23:00:00.000Z"],
    ["today 23:59", "2026-10-23T22:59:00.000Z"],
    ["today at 09:30", "2026-10-23T08:30:00.000Z"],
    ["on tomorrow at 1:05PM", "2026-10-24T12:05:00.000Z"],
    ["on 2026-12-25 at noon", "2026-12-25T12:00:00.000Z"],
    ["2028-02-29 from 09:00", "2028-02-29T09:00:00.000Z"],
  ])("resolves clock and date %s", (phrase, start) => {
    expect(parseEventQuickAdd(`Meet Robin ${phrase}`, context)).toEqual({
      title: "Meet Robin",
      start,
      allDay: false,
      timeZone: "Europe/London",
    });
  });

  it.each([
    ["tomorrow from 1pm to 2:30pm", "2026-10-24T12:00:00.000Z", "2026-10-24T13:30:00.000Z", 90],
    ["tomorrow 10:00 until noon", "2026-10-24T09:00:00.000Z", "2026-10-24T11:00:00.000Z", 120],
    ["tomorrow 11pm for 2 hours", "2026-10-24T22:00:00.000Z", "2026-10-25T00:00:00.000Z", 120],
    ["tomorrow 1pm for 1.5 hours", "2026-10-24T12:00:00.000Z", "2026-10-24T13:30:00.000Z", 90],
    ["tomorrow 1pm for 1 minute", "2026-10-24T12:00:00.000Z", "2026-10-24T12:01:00.000Z", 1],
    ["tomorrow 1pm for 1 hour", "2026-10-24T12:00:00.000Z", "2026-10-24T13:00:00.000Z", 60],
  ] as const)("resolves end/duration %s", (phrase, start, end, durationMinutes) => {
    expect(parseEventQuickAdd(`Meet Sam ${phrase}`, context)).toMatchObject({
      title: "Meet Sam",
      start,
      end,
      durationMinutes,
      allDay: false,
    });
  });

  it.each([
    "tomorrow",
    "tomorrow all-day",
    "tomorrow all day",
    "all day on tomorrow",
  ])("represents %s as a date without guessing a length", (phrase) => {
    expect(parseEventQuickAdd(`Holiday ${phrase}`, context)).toEqual({
      title: "Holiday",
      start: "2026-10-24",
      allDay: true,
      timeZone: "Europe/London",
    });
  });

  it.each([
    ["1 day", "2026-10-25", 1440],
    ["2 days", "2026-10-26", 2880],
  ] as const)("uses exclusive all-day end for %s", (duration, end, durationMinutes) => {
    expect(parseEventQuickAdd(`Holiday tomorrow for ${duration}`, context)).toEqual({
      title: "Holiday",
      start: "2026-10-24",
      end,
      durationMinutes,
      allDay: true,
      timeZone: "Europe/London",
    });
  });

  it("accepts location before, between and after other clauses", () => {
    for (const phrase of [
      "at Cafe Rio tomorrow 1pm for 90 minutes",
      "tomorrow at Cafe Rio 1pm for 90 minutes",
      "tomorrow 1pm for 90 minutes at Cafe Rio",
    ]) {
      expect(parseEventQuickAdd(`Lunch ${phrase}`, context)).toMatchObject({
        title: "Lunch",
        location: "Cafe Rio",
        start: "2026-10-24T12:00:00.000Z",
        durationMinutes: 90,
      });
    }
  });

  it("protects quoted location words and literal title text", () => {
    expect(
      parseEventQuickAdd('Discuss "tomorrow" today at "Every Day Cafe"', context),
    ).toMatchObject({
      title: 'Discuss "tomorrow"',
      location: "Every Day Cafe",
      start: "2026-10-23",
    });
  });

  it("normalises whitespace and preserves Unicode and synthetic URL/email titles", () => {
    expect(
      parseEventQuickAdd("  🥗 Lunch\twith Sam\n tomorrow\t1pm at Café Rio  ", context),
    ).toMatchObject({
      title: "🥗 Lunch with Sam",
      location: "Café Rio",
    });
    expect(
      parseEventQuickAdd("Email sam@example.org https://example.org/2026 today", context).title,
    ).toBe("Email sam@example.org https://example.org/2026");
  });
});

describe("recurrence", () => {
  it.each([
    ["daily", "FREQ=DAILY", "2026-10-24T08:30:00.000Z"],
    ["every day", "FREQ=DAILY", "2026-10-24T08:30:00.000Z"],
    ["weekly", "FREQ=WEEKLY", "2026-10-30T09:30:00.000Z"],
    ["every week", "FREQ=WEEKLY", "2026-10-30T09:30:00.000Z"],
    ["every Sunday", "FREQ=WEEKLY;BYDAY=SU", "2026-10-25T09:30:00.000Z"],
    ["every Monday", "FREQ=WEEKLY;BYDAY=MO", "2026-10-26T09:30:00.000Z"],
    ["every Tuesday", "FREQ=WEEKLY;BYDAY=TU", "2026-10-27T09:30:00.000Z"],
    ["every Wednesday", "FREQ=WEEKLY;BYDAY=WE", "2026-10-28T09:30:00.000Z"],
    ["every Thursday", "FREQ=WEEKLY;BYDAY=TH", "2026-10-29T09:30:00.000Z"],
    ["every Friday", "FREQ=WEEKLY;BYDAY=FR", "2026-10-30T09:30:00.000Z"],
    ["every Saturday", "FREQ=WEEKLY;BYDAY=SA", "2026-10-24T08:30:00.000Z"],
  ])("chooses next occurrence for %s", (phrase, rrule, start) => {
    expect(parseEventQuickAdd(`Standup ${phrase} 9:30`, context)).toEqual({
      title: "Standup",
      start,
      allDay: false,
      timeZone: "Europe/London",
      rrule,
    });
  });

  it("includes now, uses precise milliseconds, and advances a passed weekday", () => {
    const input = "Standup every weekday 12:00";
    expect(parseEventQuickAdd(input, context).start).toBe("2026-10-23T11:00:00.000Z");
    expect(
      parseEventQuickAdd(input, { ...context, now: new Date("2026-10-23T11:00:00.001Z") }).start,
    ).toBe("2026-10-26T12:00:00.000Z");
  });

  it("selects weekdays from a weekend before considering the time", () => {
    expect(
      parseEventQuickAdd("Standup every weekday 09:30", {
        ...context,
        now: new Date("2026-10-24T20:00:00Z"),
      }).start,
    ).toBe("2026-10-26T09:30:00.000Z");
  });

  it("supports all-day recurrence and explicit matching dates", () => {
    expect(parseEventQuickAdd("Holiday every Monday", context)).toMatchObject({
      start: "2026-10-26",
      allDay: true,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    expect(parseEventQuickAdd("Holiday daily", context).start).toBe("2026-10-23");
    expect(parseEventQuickAdd("Standup every Friday today 1pm", context).start).toBe(
      "2026-10-23T12:00:00.000Z",
    );
    expect(
      parseEventQuickAdd("Standup every weekday 2026-10-26 9:30 for 30 minutes", context),
    ).toMatchObject({ end: "2026-10-26T10:00:00.000Z", durationMinutes: 30 });
  });
});

describe("supplied clock and zone", () => {
  it.each([
    ["Pacific/Kiritimati", "2026-10-24T01:00:00Z", "2026-10-24"],
    ["America/Los_Angeles", "2026-10-24T01:00:00Z", "2026-10-23"],
    ["UTC", "2026-12-31T23:30:00Z", "2026-12-31"],
  ])("derives local today in %s", (tz, now, start) => {
    expect(parseEventQuickAdd("Holiday today", { tz, now: new Date(now) }).start).toBe(start);
  });

  it.each([
    ["Asia/Kathmandu", "2026-10-23T00:00:00Z", "tomorrow 9:30", "2026-10-24T03:45:00.000Z"],
    ["Europe/London", "2026-03-28T12:00:00Z", "tomorrow 9:30", "2026-03-29T08:30:00.000Z"],
    ["America/New_York", "2026-10-31T12:00:00Z", "tomorrow 9:30", "2026-11-01T14:30:00.000Z"],
    ["UTC", "2026-12-31T23:30:00Z", "tomorrow 9:30", "2027-01-01T09:30:00.000Z"],
  ])("converts wall times in %s", (tz, now, phrase, start) => {
    expect(parseEventQuickAdd(`Meet Sam ${phrase}`, { tz, now: new Date(now) }).start).toBe(start);
  });

  it("uses elapsed durations and wall-clock ends across DST", () => {
    const ctx = { now: new Date("2026-03-28T12:00:00Z"), tz: "Europe/London" };
    const start = "2026-03-29T00:30:00.000Z";
    const end = "2026-03-29T02:30:00.000Z";
    for (const ending of ["for 2 hours", "to 03:30"]) {
      expect(parseEventQuickAdd(`Meet Sam tomorrow 00:30 ${ending}`, ctx)).toMatchObject({
        start,
        end,
        durationMinutes: 120,
      });
    }
    expect(parseEventQuickAdd("Holiday tomorrow for 2 days", ctx).end).toBe("2026-03-31");
  });

  it.each([
    ["Europe/London", "2026-03-28T12:00:00Z", "tomorrow 01:30", "nonexistent-time"],
    ["Europe/London", "2026-10-24T12:00:00Z", "tomorrow 01:30", "ambiguous-time"],
    ["America/New_York", "2026-03-07T12:00:00Z", "tomorrow 02:30", "nonexistent-time"],
    ["America/New_York", "2026-10-31T12:00:00Z", "tomorrow 01:30", "ambiguous-time"],
    ["Australia/Lord_Howe", "2026-10-03T12:00:00Z", "tomorrow 02:15", "nonexistent-time"],
    ["Australia/Lord_Howe", "2026-04-04T12:00:00Z", "tomorrow 01:45", "ambiguous-time"],
    ["Pacific/Apia", "2011-12-29T12:00:00Z", "2011-12-30 09:30", "nonexistent-time"],
    ["Europe/London", "2026-03-28T12:00:00Z", "tomorrow 00:30 to 01:30", "nonexistent-time"],
    ["Europe/London", "2026-10-24T12:00:00Z", "tomorrow 00:30 to 01:30", "ambiguous-time"],
    ["Europe/London", "2026-03-29T00:00:00Z", "daily 01:30", "nonexistent-time"],
  ] as const)("rejects %s / %s / %s", (tz, now, phrase, code) => {
    failure(`Meet Sam ${phrase}`, code, { tz, now: new Date(now) });
  });

  it("never reads a global clock or mutates its context", () => {
    const ctx = Object.freeze({ now: new Date("2026-10-23T11:00:00Z"), tz: "UTC" });
    const before = ctx.now.toISOString();
    const first = parseEventQuickAdd("Meet Sam tomorrow 13:00", ctx);
    parseEventQuickAdd("Other daily", context);
    expect(parseEventQuickAdd("Meet Sam tomorrow 13:00", ctx)).toEqual(first);
    expect(ctx.now.toISOString()).toBe(before);
  });
});

describe("fail-closed errors preserve all input", () => {
  it.each([
    ["", "invalid-input"],
    ["  \n ", "invalid-input"],
    ["x".repeat(4097), "invalid-input"],
    ["Meet Sam", "missing-date"],
    ["Meet Sam at Cafe Rio", "missing-date"],
    ["Meet Sam 1pm", "missing-date"],
    ["tomorrow 1pm", "missing-title"],
    ["Meet Sam tomorrow today", "conflicting-fields"],
    ["Meet Sam tomorrow 1pm 2pm", "conflicting-fields"],
    ["Meet Sam tomorrow all-day all day", "conflicting-fields"],
    ["Meet Sam tomorrow all-day 1pm", "conflicting-fields"],
    ["Meet Sam tomorrow all day 1pm", "conflicting-fields"],
    ["Meet Sam tomorrow until noon", "conflicting-fields"],
    ["Meet Sam tomorrow 1pm to 2pm for 60 minutes", "conflicting-fields"],
    ["Meet Sam tomorrow 1pm to 2pm until 3pm", "conflicting-fields"],
    ["Meet Sam tomorrow 1pm to 1pm", "conflicting-fields"],
    ["Meet Sam tomorrow 11pm to 1am", "conflicting-fields"],
    ["Meet Sam tomorrow at Cafe Rio at Cafe Luna", "conflicting-fields"],
    ["Meet Sam tomorrow for 1 day for 2 days", "conflicting-fields"],
    ["Meet Sam daily every weekday", "conflicting-fields"],
    ["Meet Sam every weekday tomorrow", "conflicting-fields"],
    ["Meet Sam every Monday today", "conflicting-fields"],
    ["Meet Sam tomorrow 0am", "invalid-time"],
    ["Meet Sam tomorrow 13pm", "invalid-time"],
    ["Meet Sam tomorrow 24:00", "invalid-time"],
    ["Meet Sam tomorrow 12:60", "invalid-time"],
    ["Meet Sam tomorrow at 9", "invalid-time"],
    ["Meet Sam tomorrow 9", "invalid-time"],
    ["Meet Sam tomorrow from nonsense", "invalid-time"],
    ["Meet Sam tomorrow 1pm to soon", "invalid-time"],
    ["Meet Sam 2026-02-30", "invalid-date"],
    ["Meet Sam 2027-02-29", "invalid-date"],
    ["Meet Sam 1999-12-31", "invalid-date"],
    ["Meet Sam 2100-01-01", "invalid-date"],
    ["Meet Sam tomorrow for 0 days", "invalid-duration"],
    ["Meet Sam tomorrow for -1 days", "invalid-duration"],
    ["Meet Sam tomorrow for one day", "invalid-duration"],
    ["Meet Sam tomorrow for 1", "invalid-duration"],
    ["Meet Sam tomorrow for 1 week", "invalid-duration"],
    ["Meet Sam tomorrow for 1.5 days", "invalid-duration"],
    ["Meet Sam tomorrow for 9007199254740992 minutes", "invalid-duration"],
    ["Meet Sam tomorrow 1pm for 0.5 minutes", "invalid-duration"],
    ["Meet Sam tomorrow for 90 minutes", "invalid-duration"],
    ["Meet Sam tomorrow 1pm for 1 day", "invalid-duration"],
    ["Meet Sam tomorrow for 9007199254740000 days", "invalid-duration"],
    ["Meet Sam tomorrow for 9007199254 days", "invalid-date"],
    ["Meet Sam 2099-12-31 for 1 day", "invalid-date"],
    ["Meet Sam 2099-12-31 23:00 for 2 hours", "invalid-date"],
    ["Meet Sam on Friday", "unsupported-phrase"],
    ["Meet Sam next Friday", "unsupported-phrase"],
    ["Meet Sam tomorrow at morning", "unsupported-phrase"],
    ["Meet Sam tomorrow at about 1pm", "unsupported-phrase"],
    ["Meet Sam tomorrow around 1pm", "unsupported-phrase"],
    ["Meet Sam tonight", "unsupported-phrase"],
    ["Meet Sam 03/04/2026", "unsupported-phrase"],
    ["Meet Sam tomorrow 1pm PST", "unsupported-phrase"],
    ["Meet Sam tomorrow 1pm +0200", "unsupported-phrase"],
    ["Meet Sam tomorrow 1pm then a surprise", "unsupported-phrase"],
    ["Meet Sam tomorrow or today", "unsupported-phrase"],
    ["Meet Sam not tomorrow", "unsupported-phrase"],
    ["Meet Sam tomorrow for 1 hour and 30 minutes", "unsupported-phrase"],
    ["Meet Sam every 2 weeks", "unsupported-phrase"],
    ["Meet Sam every month", "unsupported-phrase"],
    ["Meet Sam tomorrow all", "unsupported-phrase"],
    ["Meet Sam tomorrow all week", "unsupported-phrase"],
    ["Meet Sam at tomorrow 1pm", "unsupported-phrase"],
    ['Meet Sam tomorrow at ""', "unsupported-phrase"],
    ['Meet Sam tomorrow at "Cafe Rio', "unsupported-phrase"],
    ['Meet Sam tomorrow at Cafe "Rio"', "unsupported-phrase"],
    ...["on", "every", "for", "at", "from", "to", "until"].map(
      (word) => [`Meet Sam tomorrow ${word}`, "unsupported-phrase"] as const,
    ),
  ] as const)("rejects %s with %s", (input, code) => {
    failure(input, code);
  });

  it("reports exact Unicode source offsets for unresolved suffixes", () => {
    const input = "  🥗 Meet Sam\ttomorrow 1pm\nPST  ";
    const error = failure(input, "unsupported-phrase");
    expect(error.issues).toEqual([
      {
        code: "unsupported-phrase",
        start: input.indexOf("PST"),
        end: input.length,
        text: "PST  ",
      },
    ]);
    expect(error.title).toBe("🥗 Meet Sam tomorrow 1pm PST");
    expect(error.message).not.toContain("Sam");
  });

  it.each([
    { now: new Date(Number.NaN), tz: "UTC" },
    { now: context.now, tz: "Invalid/Zone" },
    { now: new Date("1999-12-31T23:59:59Z"), tz: "UTC" },
    { now: new Date("2100-01-01T00:00:00Z"), tz: "UTC" },
    { now: new Date("2000-01-01T00:00:00Z"), tz: "America/New_York" },
  ])("rejects an invalid clock or zone", (ctx) => {
    failure("Meet Sam tomorrow", "invalid-context", ctx);
  });

  it("validates runtime input and context types", () => {
    expect(() =>
      parseEventQuickAdd("Meet Sam tomorrow", undefined as unknown as EventQuickAddContext),
    ).toThrowError(EventQuickAddError);
    for (const input of [null, undefined, 12, {}, []]) {
      expect(() => parseEventQuickAdd(input as string, context)).toThrowError(EventQuickAddError);
    }
    for (const ctx of [
      null,
      {},
      { now: "2026-10-23", tz: "UTC" },
      { now: context.now },
      { now: context.now, tz: 12 },
    ]) {
      failure("Meet Sam tomorrow", "invalid-context", ctx as EventQuickAddContext);
    }
  });

  it("rejects dates or instants past the supported boundary", () => {
    const ctx = { now: new Date("2099-12-31T12:00:00Z"), tz: "UTC" };
    failure("Meet Sam tomorrow", "invalid-date", ctx);
    failure("Meet Sam every Saturday 09:30", "invalid-date", ctx);
    failure("Meet Sam daily 09:30", "invalid-date", ctx);
    failure("Meet Sam 2099-12-31 23:30", "invalid-date", { ...ctx, tz: "Pacific/Honolulu" });
  });
});
