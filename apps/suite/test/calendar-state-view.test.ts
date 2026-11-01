// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { tokens } from "@jeswr/suite-ui/tokens";
import { describe, expect, it } from "vitest";
import type { CalendarEvent, RecurrenceRule } from "../src/apps/calendar/lib/model";
import {
  addDays,
  addMonths,
  agendaGroups,
  calendarColour,
  calendarHref,
  dateKey,
  defaultWeekStart,
  eventDateRange,
  eventTime,
  isView,
  localDate,
  type Occurrence,
  occursOn,
  PALETTE,
  parseDate,
  preferencesKey,
  projectTimed,
  rangeKey,
  rangeTitle,
  readPreferences,
  reconcileOccurrence,
  recurrenceSummary,
  reminderSummary,
  stepDate,
  visibleRange,
} from "../src/apps/calendar/state/view";

/** Hex colour fixture built at runtime so the suite token gate only flags real styles. */
const hex = (digits: string) => `#${digits}`;

const today = new Date(2026, 10, 1, 12);
function occurrence(data: CalendarEvent): Occurrence {
  return {
    id: "event",
    url: "https://pod.example/event",
    etag: '"1"',
    data,
    calendar: {
      url: "calendar",
      title: "Work",
      colour: PALETTE[0] as string,
      container: "events/",
      etag: null,
    },
  };
}
describe("Calendar view and preference pure logic", () => {
  it("accepts only literal hex or palette colours, falling back for request-capable CSS", () => {
    for (const colour of [hex("abc"), hex("abcd"), hex("12ABef"), hex("12345678"), ...PALETTE])
      expect(calendarColour("work", colour)).toBe(colour);
    for (const colour of [
      undefined,
      "",
      "url(https://attacker.example/pixel)",
      "image-set(url(https://attacker.example/pixel) 1x)",
      "var(--untrusted)",
      hex("12345"),
      `${hex("123456")}; background: url(https://attacker.example/pixel)`,
      "red",
    ])
      expect(calendarColour("work", colour)).toBe(calendarColour("work"));
  });
  it("validates URL dates without accepting JS date overflow", () => {
    expect(dateKey(today)).toBe("2026-11-01");
    expect(dateKey("2026-11-02")).toBe("2026-11-02");
    expect(parseDate("2026-02-28", today)).toBe("2026-02-28");
    expect(parseDate("1999-11-01", today)).toBe("1999-11-01");
    for (const invalid of [null, undefined, "", "oops", "2026-02-30", "0000-11-01", "2099-99-99"])
      expect(parseDate(invalid, today)).toBe("2026-11-01");
    expect(parseDate(undefined)).toBe(dateKey(new Date()));
    expect(isView("week")).toBe(true);
    expect(isView("settings")).toBe(false);
    expect(calendarHref("week", "2026-11-01")).toBe("/calendar/week?d=2026-11-01");
  });
  it("uses civil arithmetic across month lengths, leap years and DST", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-29", -1)).toBe("2026-03-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(stepDate("month", "2026-11-01", -1)).toBe("2026-10-01");
    expect(stepDate("week", "2026-11-01", 1)).toBe("2026-11-08");
    expect(stepDate("day", "2026-11-01", 1)).toBe("2026-11-02");
    expect(stepDate("agenda", "2026-11-01", 1)).toBe("2026-12-01");
  });
  it("computes all visible ranges with configurable week start", () => {
    expect(visibleRange("month", "2026-11-01", 1)).toEqual({
      from: "2026-10-26",
      to: "2026-12-07",
    });
    expect(visibleRange("week", "2026-11-01", 1)).toEqual({ from: "2026-10-26", to: "2026-11-02" });
    expect(visibleRange("week", "2026-11-01", 0)).toEqual({ from: "2026-11-01", to: "2026-11-08" });
    expect(visibleRange("day", "2026-11-01", 1)).toEqual({ from: "2026-11-01", to: "2026-11-02" });
    expect(visibleRange("agenda", "2026-11-01", 1)).toEqual({
      from: "2026-11-01",
      to: "2026-12-01",
    });
    expect(visibleRange("agenda", "2026-11-01", 1, 60).to).toBe("2026-12-31");
    expect(rangeTitle("month", "2026-11-01", 1)).toBe("November 2026");
    expect(rangeTitle("day", "2026-11-01", 1)).toBe("Sunday 1 November 2026");
    expect(rangeTitle("week", "2026-11-01", 1)).toContain("Oct");
    expect(rangeTitle("agenda", "2026-11-01", 1)).toContain("Nov");
  });
  it("uses stable, account-scoped, order-independent cache and preference keys", () => {
    const ids = ["b", "a"];
    expect(rangeKey("alice", ids, "from", "to")).toBe(rangeKey("alice", ["a", "b"], "from", "to"));
    expect(ids).toEqual(["b", "a"]);
    expect(rangeKey("alice", ids, "from", "to")).not.toBe(rangeKey("bob", ids, "from", "to"));
    expect(preferencesKey("alice")).toBe("suite:calendar:alice");
    expect(PALETTE).toHaveLength(8);
    expect(new Set(PALETTE).size).toBe(8);
    expect(calendarColour("a")).toBe(calendarColour("a"));
    expect(PALETTE).toContain(calendarColour("a"));
  });
  it("reads both Locale week APIs and rejects corrupt stored preferences", () => {
    expect(defaultWeekStart()).toBe(1);
    expect(defaultWeekStart({})).toBe(1);
    expect(defaultWeekStart({ weekInfo: { firstDay: 7 } })).toBe(0);
    expect(defaultWeekStart({ getWeekInfo: () => ({ firstDay: 1 }) })).toBe(1);
    const defaults = { hidden: [], view: "week", weekStart: 1 };
    for (const raw of [null, "", "{", "null", '"string"', "42", "{}"])
      expect(readPreferences(raw, 1)).toEqual(defaults);
    expect(readPreferences('{"hidden":["work",2],"view":"day","weekStart":0}', 1)).toEqual({
      hidden: ["work"],
      view: "day",
      weekStart: 0,
    });
    for (const weekStart of [-1, 7, 2.5, "1"])
      expect(readPreferences(JSON.stringify({ weekStart }), 1)).toEqual(defaults);
  });
  it("tests half-open day overlap for civil and timed events including implicit ends", () => {
    expect(occursOn({ name: "trip", start: "2026-11-01", end: "2026-11-04" }, "2026-11-03")).toBe(
      true,
    );
    expect(occursOn({ name: "trip", start: "2026-11-01", end: "2026-11-04" }, "2026-11-04")).toBe(
      false,
    );
    expect(occursOn({ name: "one day", start: "2026-11-01" }, "2026-11-01")).toBe(true);
    expect(occursOn({ name: "instant", start: today }, "2026-11-01")).toBe(true);
    expect(occursOn({ name: "DST all day", start: "2026-03-29" }, "2026-03-30")).toBe(false);
    expect(
      occursOn(
        { name: "future", start: new Date(2026, 10, 2, 1), end: new Date(2026, 10, 2, 2) },
        "2026-11-01",
      ),
    ).toBe(false);
  });
  it("formats all-day, multi-day, instant and timed ranges without UTC date shifts", () => {
    expect(eventTime({ name: "all day", start: "2026-11-01" })).toBe("All day");
    expect(eventTime({ name: "meeting", start: today })).toBe("12:00");
    expect(eventTime({ name: "meeting", start: today, end: new Date(2026, 10, 1, 13) })).toBe(
      "12:00–13:00",
    );
    expect(eventDateRange({ name: "one day", start: "2026-11-01" })).toContain("1 November 2026");
    expect(eventDateRange({ name: "trip", start: "2026-11-01", end: "2026-11-04" })).toContain(
      "3 November 2026",
    );
    expect(eventDateRange({ name: "meeting", start: today })).toContain("12:00");
    expect(
      eventDateRange({ name: "meeting", start: today, end: new Date(2026, 10, 1, 13) }),
    ).toContain("13:00");
  });
  it("explains recurrence in words", () => {
    expect(recurrenceSummary({ frequency: "WEEKLY", byDay: ["MO", "WE", "FR"] })).toBe(
      "Weekly on Mon, Wed, Fri",
    );
    expect(recurrenceSummary({ frequency: "WEEKLY", interval: 2, count: 3 })).toBe(
      "Every 2 weeks · 3 occurrences",
    );
    expect(
      recurrenceSummary({ frequency: "DAILY", interval: 1, until: "2026-12-01", byDay: [] }),
    ).toBe("Daily · until 2026-12-01");
    for (const frequency of ["DAILY", "MONTHLY", "YEARLY"] as RecurrenceRule["frequency"][]) {
      expect(recurrenceSummary({ frequency })).toMatch(/Daily|Monthly|Yearly/);
      expect(recurrenceSummary({ frequency, interval: 2 })).toMatch(/Every 2 (days|months|years)/);
    }
    expect(recurrenceSummary({ frequency: "WEEKLY", byDay: ["TU", "TH", "SA", "SU"] })).toBe(
      "Weekly on Tue, Thu, Sat, Sun",
    );
  });
  it("splits overnight timed events and clips them to visible local days", () => {
    const events = [
      occurrence({
        name: "overnight",
        start: new Date(2026, 10, 1, 23),
        end: new Date(2026, 10, 2, 1),
      }),
      occurrence({ name: "all day", start: "2026-11-01" }),
      occurrence({ name: "instant", start: new Date(2026, 10, 2, 9) }),
      occurrence({
        name: "zero",
        start: new Date(2026, 10, 1, 10),
        end: new Date(2026, 10, 1, 10),
      }),
    ];
    const projected = projectTimed(events, "2026-11-01", 2);
    expect(
      projected.map(({ day, startMinute, endMinute }) => ({ day, startMinute, endMinute })),
    ).toEqual([
      { day: 0, startMinute: 1380, endMinute: 1440 },
      { day: 0, startMinute: 600, endMinute: 601 },
      { day: 1, startMinute: 0, endMinute: 60 },
      { day: 1, startMinute: 540, endMinute: 570 },
    ]);
    expect(projectTimed([], "2026-11-01", 1)).toEqual([]);
    expect(+localDate("2026-11-01")).toBe(+new Date(2026, 10, 1));
  });
});

it("groups only visible agenda days and repeats multi-day events on each day", () => {
  const trip = occurrence({ name: "trip", start: "2026-10-31", end: "2026-11-03" });
  expect(agendaGroups([trip], "2026-11-01", "2026-11-04")).toEqual([
    { day: "2026-11-01", events: [trip] },
    { day: "2026-11-02", events: [trip] },
  ]);
  expect(agendaGroups([], "2026-11-01", "2026-11-01")).toEqual([]);
});

it("formats absolute and signed reminder offsets, including multi-unit and zero triggers", () => {
  expect(reminderSummary({ triggerOffset: "-PT15M" })).toBe("15 minutes before");
  expect(reminderSummary({ triggerOffset: "PT1H1M1S" })).toBe("1 hour 1 minute 1 second after");
  expect(reminderSummary({ triggerOffset: "-P1DT2H2M2S" })).toBe(
    "1 day 2 hours 2 minutes 2 seconds before",
  );
  expect(reminderSummary({ triggerOffset: "P1W" })).toBe("7 days after");
  expect(reminderSummary({ triggerOffset: "PT0S" })).toBe("At event start");
  expect(reminderSummary({ triggerTime: new Date(2026, 10, 1, 9) })).toContain("09:00");
});

it("checks palette and chip text contrast using the suite's own WCAG colour evaluator", async () => {
  const { contrast }: { contrast: (foreground: string, background: string) => number } =
    await import(new URL("../../../scripts/contrast.mjs", import.meta.url).href);
  const white = tokens.find((token) => token.name === "--glyph")?.light as string;
  for (const colour of PALETTE) expect(contrast(white, colour)).toBeGreaterThanOrEqual(4.5);
  for (const theme of ["light", "dark"] as const) {
    const foreground = tokens.find((token) => token.name === "--foreground")?.[theme] as string;
    const background = tokens.find((token) => token.name === "--surface-2")?.[theme] as string;
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
});

it("reconciles renamed/deleted occurrences only inside the refreshed range", () => {
  const original = occurrence({ name: "Before", start: "2026-11-01" });
  const renamed = { ...original, data: { ...original.data, name: "After" } };
  const unrelated = { ...original, id: "other" };
  expect(reconcileOccurrence(undefined, [], "2026-11-01", "2026-11-02")).toBeUndefined();
  expect(reconcileOccurrence(original, [unrelated, renamed], "2026-11-01", "2026-11-02")).toBe(
    renamed,
  );
  expect(reconcileOccurrence(original, [], "2026-11-01", "2026-11-02")).toBeUndefined();
  expect(reconcileOccurrence(original, [], "2026-10-01", "2026-11-01")).toBe(original);
  expect(reconcileOccurrence(original, [], "2026-11-02", "2026-11-03")).toBe(original);
  expect(
    reconcileOccurrence(original, [], "2026-11-01", "2026-11-02", [original.calendar.url]),
  ).toBe(original);
  const trip = occurrence({ name: "Trip", start: "2026-10-31", end: "2026-11-03" });
  expect(reconcileOccurrence(trip, [], "2026-11-01", "2026-11-02")).toBeUndefined();
});
