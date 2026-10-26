// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CalendarLayoutError,
  layoutTimeGrid,
  type TimedEvent,
} from "../src/apps/calendar/lib/layout";

const event = (id: string, startMinute: number, endMinute: number, day = 0): TimedEvent => ({
  id,
  day,
  startMinute,
  endMinute,
});

describe("layoutTimeGrid", () => {
  it("returns no placements for no events", () => expect(layoutTimeGrid([], 7)).toEqual([]));

  it("lays out isolated, endpoint-touching and full-day events in minute/fraction geometry", () => {
    const placements = layoutTimeGrid(
      [event("a", 0, 60), event("b", 60, 90.5), event("c", 0, 1440, 1)],
      7,
    );
    expect(
      placements.map((item) => [item.column, item.columnCount, item.left, item.width]),
    ).toEqual([
      [0, 1, 0, 1],
      [0, 1, 0, 1],
      [0, 1, 0, 1],
    ]);
    expect(placements[1]).toMatchObject({
      startMinute: 60,
      endMinute: 90.5,
      top: 60 / 1440,
      height: 30.5 / 1440,
    });
    expect(placements[2]).toMatchObject({ day: 1, top: 0, height: 1 });
  });

  it("packs simultaneous events longest first, then by id, without changing inputs", () => {
    const events = Object.freeze([
      Object.freeze(event("z", 60, 90)),
      Object.freeze(event("b", 60, 120)),
      Object.freeze(event("a", 60, 120)),
    ]);
    const placements = layoutTimeGrid(events, 1);
    expect(
      placements.map((item) => [item.id, item.column, item.columnCount, item.left, item.width]),
    ).toEqual([
      ["a", 0, 3, 0, 1 / 3],
      ["b", 1, 3, 1 / 3, 1 / 3],
      ["z", 2, 3, 2 / 3, 1 / 3],
    ]);
    expect(layoutTimeGrid([...events].reverse(), 1)).toEqual(placements);
    expect(events.map((item) => item.id)).toEqual(["z", "b", "a"]);
  });

  it("handles nested and transitive overlaps, reuses columns and resets after a cluster", () => {
    const placements = layoutTimeGrid(
      [
        event("outer", 0, 100),
        event("inner", 10, 30),
        event("third", 20, 40),
        event("reuse", 30, 70),
        event("bridge", 90, 110),
        event("later", 110, 120),
      ],
      1,
    );
    expect(placements.map((item) => [item.column, item.columnCount])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [1, 3],
      [1, 3],
      [0, 1],
    ]);
    expect(placements[4]?.width).toBe(1 / 3);
    expect(placements[5]?.width).toBe(1);
  });

  it("never clusters events on different days even with identical times", () => {
    const placements = layoutTimeGrid(
      [
        event("day6", 10, 40, 6),
        event("day0", 10, 40),
        event("day1", 0, 5, 1),
        event("day1b", 10, 20, 1),
      ],
      7,
    );
    expect(placements.map((item) => [item.id, item.width])).toEqual([
      ["day0", 1],
      ["day1", 1],
      ["day1b", 1],
      ["day6", 1],
    ]);
  });

  it("keeps overlapping rectangles disjoint and bounds all geometry", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 6 }),
            fc.integer({ min: 0, max: 1439 }),
            fc.integer({ min: 1, max: 1440 }),
          ),
          { maxLength: 40 },
        ),
        (ranges) => {
          const placements = layoutTimeGrid(
            ranges.map(([day, start, length], index) =>
              event(String(index), start, Math.min(1440, start + length), day),
            ),
            7,
          );
          expect(placements).toHaveLength(ranges.length);
          for (const [index, a] of placements.entries()) {
            expect(a.width).toBeGreaterThan(0);
            expect(a.left).toBeGreaterThanOrEqual(0);
            expect(a.left + a.width).toBeLessThanOrEqual(1 + Number.EPSILON);
            expect(a.top + a.height).toBeLessThanOrEqual(1 + Number.EPSILON);
            for (const b of placements.slice(index + 1)) {
              if (a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
                expect(a.column).not.toBe(b.column);
                expect(a.columnCount).toBe(b.columnCount);
                expect(Math.abs(a.left - b.left) + Number.EPSILON).toBeGreaterThanOrEqual(a.width);
              }
            }
          }
        },
      ),
      { seed: 427, numRuns: 100 },
    );
  });

  it.each([
    event("negative", -1, 60),
    event("underflow", 0, Number.MIN_VALUE),
    event("zero", 60, 60),
    event("reverse", 70, 60),
    event("overnight", 1400, 1500),
    event("nan", NaN, 60),
    event("nan-end", 0, NaN),
    event("inf", 0, Infinity),
    event("negative-inf", -Infinity, 1),
    event("day", 0, 1, -1),
    event("outside", 0, 1, 1),
    event("fraction-day", 0, 1, 0.5),
  ])("rejects invalid timed input $id with a typed range error", (item) => {
    expect(() => layoutTimeGrid([item], 1)).toThrow(CalendarLayoutError);
    expect(() => layoutTimeGrid([item], 1)).toThrow("invalid-range");
  });

  it("rejects malformed events and invalid day counts", () => {
    for (const value of [0, 8, 1.5, Infinity])
      expect(() => layoutTimeGrid([], value)).toThrow(CalendarLayoutError);
    for (const events of [
      null,
      [null],
      [{}],
      [event("duplicate", 0, 1), event("duplicate", 2, 3)],
    ]) {
      expect(() => layoutTimeGrid(events as readonly TimedEvent[], 1)).toThrow("invalid-event");
    }
    expect(() =>
      layoutTimeGrid(
        [{ id: "string-time", day: 0, startMinute: "0", endMinute: 10 }] as unknown as TimedEvent[],
        1,
      ),
    ).toThrow(CalendarLayoutError);
  });
});
