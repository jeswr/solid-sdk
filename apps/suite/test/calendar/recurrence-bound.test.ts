// AUTHORED-BY Codex GPT-6
import { RRule } from "rrule";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandEvent } from "../../src/apps/calendar/lib/model/recurrence";
import type { CalendarEvent } from "../../src/apps/calendar/lib/model/types";

const date = (value: string) => new Date(value);
const event: CalendarEvent = {
  name: "Short series",
  start: date("2026-01-01T09:00Z"),
  recurrence: { frequency: "DAILY", until: date("2026-01-03T09:00Z") },
};

/** Count real generated candidates, failing before an unbounded regression can run away. */
function trackCandidates() {
  let visited = 0;
  const between = RRule.prototype.between;
  vi.spyOn(RRule.prototype, "between").mockImplementation(function (
    this: RRule,
    after,
    before,
    inc,
    iterator,
  ) {
    return between.call(this, after, before, inc, (wall, index) => {
      visited++;
      if (visited > 10) throw new Error("Generated too many candidates past UNTIL");
      return iterator?.(wall, index) ?? true;
    });
  });
  return () => visited;
}

afterEach(() => vi.restoreAllMocks());

describe("instant UNTIL generation bound", () => {
  it("bounds real candidate generation independently of a distant query end", () => {
    const visited = trackCandidates();
    const expected = [event.start, date("2026-01-02T09:00Z"), date("2026-01-03T09:00Z")];
    expect(
      expandEvent(event, date("2026-01-01Z"), date("2099-01-01Z")).map((item) => item.start),
    ).toEqual(expected);
    expect(visited()).toBeLessThanOrEqual(5);
  });

  it("stops before a query window wholly beyond the padded cutoff", () => {
    const visited = trackCandidates();
    expect(expandEvent(event, date("2098-01-01Z"), date("2099-01-01Z"))).toEqual([]);
    expect(visited()).toBe(0);
    const generation = vi.mocked(RRule.prototype.between).mock.instances[0] as RRule;
    // rrule must also stop while seeking the range start, before invoking its callback.
    expect(generation?.options.until).toBeInstanceOf(Date);
    expect(+(generation?.options.until as Date)).toBeLessThan(+date("2026-01-05Z"));
  });

  it.each([
    ["Europe/London", "2026-10-24T00:30Z", "2026-10-25T00:30Z", "2026-10-25T01:15Z"],
    ["America/New_York", "2026-10-31T05:30Z", "2026-11-01T05:30Z", "2026-11-01T06:15Z"],
    ["Australia/Lord_Howe", "2026-04-03T14:45Z", "2026-04-04T14:45Z", "2026-04-04T15:00Z"],
    ["Pacific/Kiritimati", "2025-12-31T19:00Z", "2026-01-01T19:00Z", "2026-01-01T19:00Z"],
    ["Etc/GMT+12", "2026-01-01T21:00Z", "2026-01-02T21:00Z", "2026-01-02T21:00Z"],
  ])("preserves inclusive instant semantics in %s", (zone, start, next, until) => {
    trackCandidates();
    const input: CalendarEvent = {
      name: "Zoned cutoff",
      start: date(start),
      recurrence: { frequency: "DAILY", until: date(until) },
    };
    const from = new Date(+date(start) - 86_400_000);
    const to = date("2099-01-01Z");
    expect(expandEvent(input, from, to, zone).map((item) => item.start)).toEqual([
      input.start,
      date(next),
    ]);
    expect(
      expandEvent(
        { ...input, recurrence: { frequency: "DAILY", until: new Date(+date(next) - 1) } },
        from,
        to,
        zone,
      ).map((item) => item.start),
    ).toEqual([input.start]);
  });

  it("retains the query bound when UNTIL is later", () => {
    const visited = trackCandidates();
    expect(
      expandEvent(
        { ...event, recurrence: { frequency: "DAILY", until: date("2099-01-01Z") } },
        date("2026-01-01Z"),
        date("2026-01-02Z"),
      ).map((item) => item.start),
    ).toEqual([event.start]);
    expect(visited()).toBeLessThanOrEqual(2);
  });

  it("handles a distant UNTIL without overflowing the finite query bound", () => {
    expect(
      expandEvent(
        { ...event, recurrence: { frequency: "DAILY", until: new Date(8_640_000_000_000_000) } },
        date("2026-01-01Z"),
        date("2026-01-02Z"),
      ).map((item) => item.start),
    ).toEqual([event.start]);
  });

  it("rejects an unrepresentable padded generation bound with a typed error", () => {
    expect(() =>
      expandEvent(
        { ...event, recurrence: { frequency: "DAILY", until: new Date(8_640_000_000_000_000) } },
        date("2026-01-01Z"),
        new Date(8_640_000_000_000_000),
      ),
    ).toThrow(TypeError);
  });
});
