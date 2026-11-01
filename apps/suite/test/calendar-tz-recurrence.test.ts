// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planSeriesEdit,
  type SeriesEditScope,
  type SeriesTiming,
} from "../src/apps/calendar/lib/tz";
import * as conversion from "../src/apps/calendar/lib/tz/conversion";

const epoch = (value: string) => Date.parse(value);
const first = epoch("2024-03-03T14:00:00Z");
const second = epoch("2024-03-10T13:00:00Z");
const third = epoch("2024-03-17T13:00:00Z");
const fourth = epoch("2024-03-24T13:00:00Z");
const series: SeriesTiming = Object.freeze({
  id: "https://example.org/calendar/weekly",
  start: first,
  durationMs: 3_600_000,
  zone: "America/New_York",
  overlap: "earlier",
  rrule: "FREQ=WEEKLY;COUNT=4",
  exdates: Object.freeze([]),
});
const following: SeriesTiming = {
  ...series,
  id: "https://example.org/calendar/new",
  start: second,
  rrule: "FREQ=WEEKLY;COUNT=3",
};
const single: SeriesTiming = { ...following, rrule: null, start: second + 3_600_000 };
const failure = (code: string) => expect.objectContaining({ name: "CalendarTimeError", code });

function edit(changes: Partial<SeriesTiming>, selected = second) {
  return planSeriesEdit({ ...series, ...changes }, "this-event", selected, single);
}

describe("recurrence edit plans", () => {
  it("detaches only the original occurrence and preserves existing exceptions", () => {
    const input = { ...series, exdates: Object.freeze([third]) };
    expect(planSeriesEdit(input, "this-event", second, single)).toEqual({
      original: { ...input, exdates: [second, third] },
      create: single,
    });
    expect(input.exdates).toEqual([third]);
  });

  it("truncates inclusively before the split, removes COUNT, and partitions old EXDATEs", () => {
    const input = { ...series, exdates: [first, fourth] };
    const plan = planSeriesEdit(input, "this-and-following", third, { ...following, start: third });
    expect(plan).toEqual({
      original: {
        ...input,
        rrule: "FREQ=WEEKLY;INTERVAL=1;UNTIL=20240317T125959Z",
        exdates: [first],
      },
      create: { ...following, start: third },
    });
    // Existing original occurrences remain members of the resulting truncated rule.
    expect(
      planSeriesEdit(plan.original as SeriesTiming, "this-event", second, single).create,
    ).toEqual(single);
    expect(() =>
      planSeriesEdit(plan.original as SeriesTiming, "this-event", third, single),
    ).toThrow(failure("invalid-occurrence"));
  });

  it("splits an UNTIL-bounded interval rule without retaining the old bound", () => {
    const input = { ...series, rrule: "UNTIL=20241231T235959Z;INTERVAL=2;FREQ=WEEKLY" };
    expect(planSeriesEdit(input, "this-and-following", third, following).original?.rrule).toBe(
      "FREQ=WEEKLY;INTERVAL=2;UNTIL=20240317T125959Z",
    );
  });

  it("replaces the original when splitting at DTSTART", () => {
    expect(planSeriesEdit(series, "this-and-following", first, following)).toEqual({
      original: null,
      create: following,
    });
  });

  it("edits all events using the explicit complete replacement", () => {
    const replacement = { ...series, start: second, rrule: "FREQ=DAILY", exdates: [third] };
    const plan = planSeriesEdit(series, "all-events", second, replacement);
    expect(plan).toEqual({ original: replacement, create: null });
    expect(plan.original).not.toBe(replacement);
    expect(plan.original?.exdates).not.toBe(replacement.exdates);
    expect(
      planSeriesEdit(series, "all-events", first, { ...series, rrule: null }).original?.rrule,
    ).toBeNull();
  });

  it("keeps wall time through DST for DAILY and WEEKLY rules", () => {
    expect(edit({ rrule: "FREQ=DAILY;INTERVAL=7;COUNT=2" }).create).toEqual(single);
    expect(() => edit({ rrule: "FREQ=DAILY;COUNT=7" })).toThrow(failure("invalid-occurrence"));
    expect(edit({ rrule: "FREQ=WEEKLY;UNTIL=20240310T130000Z" }).create).toEqual(single);
    expect(() => edit({ rrule: "FREQ=WEEKLY;UNTIL=20240310T125959Z" })).toThrow(
      failure("invalid-occurrence"),
    );
  });

  it("selects the explicit overlap occurrence and rejects the other instant", () => {
    const autumn = { ...series, start: epoch("2024-10-27T05:30:00Z"), overlap: "later" as const };
    const later = epoch("2024-11-03T06:30:00Z");
    expect(planSeriesEdit(autumn, "this-event", later, single).original?.exdates).toEqual([later]);
    expect(() => planSeriesEdit(autumn, "this-event", later - 3_600_000, single)).toThrow(
      failure("invalid-occurrence"),
    );
    expect(() => edit({ start: later, overlap: "earlier" })).toThrow(failure("invalid-series"));
  });

  it.each([
    { id: "" },
    { id: "  " },
    { id: null },
    { durationMs: 0 },
    { durationMs: -1000 },
    { durationMs: 1001 },
    { durationMs: Infinity },
    { durationMs: 1.5 },
    { exdates: null },
    { overlap: "compatible" },
    { rrule: null },
    { rrule: "FREQ=WEEKLY;UNTIL=20240301T000000Z" },
    { exdates: [third, third] },
  ])("rejects invalid timing %j", (changes) => {
    expect(() => edit(changes as Partial<SeriesTiming>)).toThrow(failure("invalid-series"));
  });

  it("rejects absent series, invalid exceptions, nonmembers and excluded selections", () => {
    expect(() =>
      planSeriesEdit(null as unknown as SeriesTiming, "this-event", second, single),
    ).toThrow(failure("invalid-series"));
    expect(() => edit({ exdates: [NaN] })).toThrow(failure("invalid-instant"));
    expect(() => edit({ exdates: [second + 1000] })).toThrow(failure("invalid-occurrence"));
    expect(() => edit({ exdates: [second] })).toThrow(failure("invalid-occurrence"));
    expect(() => edit({}, first - 7 * 86_400_000)).toThrow(failure("invalid-occurrence"));
    expect(() => edit({}, second + 1000)).toThrow(failure("invalid-occurrence"));
    expect(() => edit({}, fourth + 7 * 86_400_000)).toThrow(failure("invalid-occurrence"));
  });

  it.each([
    "",
    "FREQ=MONTHLY",
    "FREQ=YEARLY",
    "FREQ=HOURLY",
    "INTERVAL=1",
    "FREQ=DAILY;BYDAY=MO",
    "FREQ=DAILY;FREQ=DAILY",
    "FREQ=DAILY;COUNT=1;COUNT=2",
    "FREQ=DAILY;COUNT=0",
    "FREQ=DAILY;INTERVAL=-1",
    "FREQ=DAILY;COUNT=1.5",
    "FREQ=DAILY;INTERVAL=01",
    "FREQ=DAILY;INTERVAL=36601",
    "FREQ=DAILY;COUNT=999999999999999999999999",
    "FREQ=DAILY;UNTIL=20240310",
    "FREQ=DAILY;UNTIL=20240310T130000",
    "FREQ=DAILY;COUNT=2;UNTIL=20240310T130000Z",
    "RRULE:FREQ=DAILY",
    "freq=daily",
    "FREQ=DAILY;",
    "FREQ=DAILY=1",
    42,
  ])("fails closed for unsupported rule %s", (rrule) => {
    expect(() => edit({ rrule: rrule as string })).toThrow(failure("unsupported-rule"));
  });

  it("rejects malformed UNTIL dates instead of normalising them", () => {
    expect(() => edit({ rrule: "FREQ=WEEKLY;UNTIL=20240230T120000Z" })).toThrow(
      failure("invalid-wall-time"),
    );
  });

  it("rejects scope/identity/replacement combinations that lose recurrence semantics", () => {
    expect(() => planSeriesEdit(series, "unknown" as SeriesEditScope, second, single)).toThrow(
      failure("invalid-option"),
    );
    expect(() =>
      planSeriesEdit(series, "this-event", second, { ...single, id: series.id }),
    ).toThrow(failure("invalid-series"));
    expect(() => planSeriesEdit(series, "all-events", second, following)).toThrow(
      failure("invalid-series"),
    );
    expect(() => planSeriesEdit(series, "this-event", second, following)).toThrow(
      failure("invalid-series"),
    );
    expect(() => planSeriesEdit(series, "this-and-following", second, single)).toThrow(
      failure("invalid-series"),
    );
    expect(() =>
      planSeriesEdit(series, "this-event", second, { ...single, exdates: [third] }),
    ).toThrow(failure("invalid-series"));
    expect(() => edit({ start: NaN })).toThrow(failure("invalid-instant"));
    expect(() => edit({ start: epoch("2099-12-31T23:30:00Z") })).toThrow(
      failure("invalid-instant"),
    );
  });

  it("rejects COUNT plans that would miscount intervening nonexistent times", () => {
    const spring = { ...series, start: epoch("2024-03-09T07:30:00Z"), rrule: "FREQ=DAILY;COUNT=5" };
    expect(() =>
      planSeriesEdit(spring, "this-event", epoch("2024-03-11T06:30:00Z"), single),
    ).toThrow(failure("nonexistent-time"));
  });

  it("does not alias exceptions in any returned plan", () => {
    const plan = planSeriesEdit(series, "this-event", second, single);
    expect(plan.create?.exdates).not.toBe(single.exdates);
    expect(plan.original?.exdates).not.toBe(series.exdates);
  });
});

describe("recurrence validation work", () => {
  const daily: SeriesTiming = {
    ...series,
    start: epoch("2024-01-01T09:00:00Z"),
    zone: "UTC",
    rrule: "FREQ=DAILY;COUNT=200",
  };
  const day = (index: number) => daily.start + index * 86_400_000;
  const detached = { ...single, zone: "UTC" };

  function countConversions() {
    // These UTC fixtures prove the production work budget, not Intl offset search.
    // Real conversion, DST gaps and overlaps remain covered by the other tests.
    return vi.spyOn(conversion, "wallClockToInstant").mockImplementation((wall, zone) => {
      expect(zone).toBe("UTC");
      return Date.parse(`${wall}Z`);
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { indices: Array.from({ length: 40 }, (_, i) => i + 1), selected: 45, conversions: 47 },
    { indices: [40, 5, 30], selected: 45, conversions: 47 },
    { indices: [40, 30], selected: 5, conversions: 42 },
  ])("reuses prefixes and converted members: %j", ({ indices, selected, conversions }) => {
    const convert = countConversions();
    const input = { ...daily, exdates: Object.freeze(indices.map(day)) };
    expect(planSeriesEdit(input, "this-event", day(selected), detached).original?.exdates).toEqual(
      [...input.exdates, day(selected)].sort((a, b) => a - b),
    );
    // One conversion per visited day, plus the detached replacement's DTSTART.
    expect(convert).toHaveBeenCalledTimes(conversions);
    expect(input.exdates).toEqual(indices.map(day));
  });

  it("bounds distant COUNT selections before scanning the full recurrence", () => {
    const convert = countConversions();
    const input = {
      ...daily,
      start: epoch("2000-01-01T09:00:00Z"),
      rrule: "FREQ=DAILY;COUNT=36600",
    };
    expect(() =>
      planSeriesEdit(input, "this-event", epoch("2099-12-31T09:00:00Z"), detached),
    ).toThrow(failure("invalid-series"));
    expect(convert).toHaveBeenCalledTimes(128);
  });

  it("accepts exactly the work limit and rejects the next conversion", () => {
    const convert = countConversions();
    expect(planSeriesEdit(daily, "this-event", day(126), detached).create).toEqual(detached);
    expect(convert).toHaveBeenCalledTimes(128);
    convert.mockClear();
    expect(() => planSeriesEdit(daily, "this-event", day(127), detached)).toThrow(
      failure("invalid-series"),
    );
    expect(convert).toHaveBeenCalledTimes(128);
  });

  it.each([
    "FREQ=DAILY",
    "FREQ=DAILY;UNTIL=20241231T235959Z",
    "FREQ=DAILY;COUNT=200",
  ])("bounds exception validation for %s", (rrule) => {
    const convert = countConversions();
    const input = { ...daily, rrule, exdates: Array.from({ length: 129 }, (_, i) => day(i + 1)) };
    expect(() => planSeriesEdit(input, "this-event", daily.start, detached)).toThrow(
      failure("invalid-series"),
    );
    expect(convert).toHaveBeenCalledTimes(128);
  });

  it("shares the budget across both series and resets it for each plan", () => {
    const convert = countConversions();
    const input = { ...daily, exdates: [day(70)] };
    const replacement = {
      ...daily,
      start: epoch("2025-01-01T09:00:00Z"),
      exdates: [epoch("2025-03-12T09:00:00Z")],
    };
    expect(planSeriesEdit(input, "all-events", daily.start, daily).create).toBeNull();
    expect(planSeriesEdit(daily, "all-events", daily.start, replacement).create).toBeNull();
    convert.mockClear();
    expect(() => planSeriesEdit(input, "all-events", daily.start, replacement)).toThrow(
      failure("invalid-series"),
    );
    expect(convert).toHaveBeenCalledTimes(128);
    expect(planSeriesEdit(input, "all-events", daily.start, daily).create).toBeNull();
  });

  it("rejects a gap after an already validated prefix", () => {
    const spring = {
      ...series,
      start: epoch("2024-03-08T07:30:00Z"),
      rrule: "FREQ=DAILY;COUNT=5",
      exdates: [epoch("2024-03-09T07:30:00Z")],
    };
    expect(() =>
      planSeriesEdit(spring, "this-event", epoch("2024-03-11T06:30:00Z"), single),
    ).toThrow(failure("nonexistent-time"));
  });
});
