// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../src/apps/tasks/lib/quickadd";

const now = new Date("2026-10-23T11:00:00Z");

describe("quick-add period weekday qualifiers", () => {
  it.each([
    ["Sunday", "2026-10-18"],
    ["Monday", "2026-10-19"],
    ["Tuesday", "2026-10-20"],
    ["Wednesday", "2026-10-21"],
    ["Thursday", "2026-10-22"],
    ["Friday", "2026-10-23"],
    ["Saturday", "2026-10-24"],
    ["Mon.", "2026-10-19"],
    ["on Thurs", "2026-10-22"],
  ])("keeps %s in the injected Sunday-based week", (weekday, date) => {
    for (const locale of ["en-GB", "en-US"] as const) {
      for (const clock of ["", " 9am"]) {
        const phrase = `this week ${weekday}${clock}`;
        const input = `Call ${phrase}`;
        expect(parseQuickAdd(input, { now, tz: "UTC", locale })).toEqual({
          title: "Call",
          due: clock
            ? { kind: "dateTime", dateTime: `${date}T09:00:00.000Z`, timeZone: "UTC" }
            : { kind: "date", date },
          priority: 4,
          labels: [],
          spans: [{ kind: "due", start: 5, end: input.length, text: phrase }],
        });
      }
    }
  });

  it.each([
    ["this week, at 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week, 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week , \tAT 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week, 9am on Saturday", "2026-10-24T09:00:00.000Z"],
    ["this week, Saturday at 9am", "2026-10-24T09:00:00.000Z"],
    ["this week. at 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week: at 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week - at 5pm", "2026-10-18T17:00:00.000Z"],
    ["this week∙ at 5pm", "2026-10-18T17:00:00.000Z"],
  ])("accepts supported connecting punctuation in %s", (phrase, dateTime) => {
    const input = `Call ${phrase}`;
    for (const locale of ["en-GB", "en-US"] as const) {
      for (const keepDateText of [false, true]) {
        expect(parseQuickAdd(input, { now, tz: "UTC", locale, keepDateText })).toEqual({
          title: keepDateText ? input.replace(/\s+/g, " ") : "Call",
          due: { kind: "dateTime", dateTime, timeZone: "UTC" },
          priority: 4,
          labels: [],
          spans: [{ kind: "due", start: 5, end: input.length, text: phrase }],
        });
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
      "America/New_York",
      "this week Saturday 9am UTC",
      "2026-11-07T09:00:00.000Z",
    ],
    ["2026-10-31T23:30:00Z", "UTC", "this week Saturday 9am +0200", "2026-11-07T07:00:00.000Z"],
    ["2027-01-01T00:30:00Z", "UTC", "this week Monday 9am", "2026-12-28T09:00:00.000Z"],
    [
      "2026-10-23T11:00:00Z",
      "Europe/London",
      "THIS WEEKS on SAT. at 9am",
      "2026-10-24T08:00:00.000Z",
    ],
    ["2026-10-23T11:00:00Z", "UTC", "this week 9am Monday", "2026-10-19T09:00:00.000Z"],
  ])("uses the injected calendar for %s / %s / %s", (instant, tz, phrase, dateTime) => {
    const input = `Call ${phrase}`;
    const result = parseQuickAdd(input, { now: new Date(instant), tz });
    expect(result.title).toBe("Call");
    expect(result.due).toEqual({ kind: "dateTime", dateTime, timeZone: tz });
    expect(result.spans).toEqual([{ kind: "due", start: 5, end: input.length, text: phrase }]);
  });

  it("preserves spans, recurrence, metadata and requested date text", () => {
    const input = "p1 Call daily this week Saturday 9am #Home @calls";
    for (const keepDateText of [false, true]) {
      const result = parseQuickAdd(input, { now, tz: "UTC", keepDateText });
      expect(result).toMatchObject({
        title: keepDateText ? "Call this week Saturday 9am" : "Call",
        due: { kind: "dateTime", dateTime: "2026-10-24T09:00:00.000Z", timeZone: "UTC" },
        recurrence: { freq: "DAILY", interval: 1 },
        priority: 1,
        project: "Home",
        labels: ["calls"],
      });
      expect(result.spans.map((span) => span.text)).toEqual([
        "p1",
        "daily",
        "this week Saturday 9am",
        "#Home",
        "@calls",
      ]);
      for (const span of result.spans) expect(input.slice(span.start, span.end)).toBe(span.text);
    }
  });

  it.each([
    "this week tomorrow 9am",
    "this week Monday Tuesday 9am",
    "this week next Monday 9am",
    "this week weekday 9am",
    "this week weekend 9am",
    "this week, tomorrow 9am",
    "this week, Monday Tuesday 9am",
    "this week, next Monday 9am",
    "this week, weekday 9am",
    "this week, weekend 9am",
  ])("rejects an unsupported merged qualifier in %s with a typed error", (phrase) => {
    expect(() => parseQuickAdd(`Call ${phrase}`, { now, tz: "UTC" })).toThrow(RangeError);
  });
});
