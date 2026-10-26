// AUTHORED-BY Codex GPT-6.1-Sol
import { monthGrid } from "./month";
import { CalendarLayoutError, compareId, dateDay, dayDate, eventIds, integer } from "./validation";

export interface DateEvent {
  readonly id: string;
  readonly startDate: string;
  /** Exclusive. A single-day event ends on the following date. */
  readonly endDate: string;
}

export interface EventBar {
  id: string;
  /** Zero-based day column within this row. */
  column: number;
  span: number;
  lane: number;
  /** Horizontal fractions of the row width. */
  left: number;
  width: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface BarRow {
  startDate: string;
  laneCount: number;
  bars: EventBar[];
}

function dateRows(
  events: readonly DateEvent[],
  start: number,
  rowCount: number,
  columns: number,
): BarRow[] {
  eventIds(events);
  const ranges = events.map((event) => {
    const from = dateDay(event.startDate);
    const to = dateDay(event.endDate);
    if (to <= from) throw new CalendarLayoutError("invalid-range");
    return { id: event.id, from, to };
  });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to || compareId(a.id, b.id));
  return Array.from({ length: rowCount }, (_, index) => {
    const from = start + index * columns;
    const to = from + columns;
    // Validate the final visible day, including when no events are present.
    dayDate(to - 1);
    const ends: number[] = [];
    const bars: EventBar[] = [];
    for (const event of ranges) {
      if (event.to <= from || event.from >= to) continue;
      const column = Math.max(event.from, from) - from;
      const end = Math.min(event.to, to) - from;
      let lane = ends.findIndex((previousEnd) => previousEnd <= column);
      if (lane === -1) lane = ends.length;
      ends[lane] = end;
      bars.push({
        id: event.id,
        column,
        span: end - column,
        lane,
        left: column / columns,
        width: (end - column) / columns,
        continuesBefore: event.from < from,
        continuesAfter: event.to > to,
      });
    }
    return { startDate: dayDate(from), laneCount: ends.length, bars };
  });
}

/** Clip to the full 42-cell grid and split at each week boundary; lanes restart per row. */
export function layoutMonthEvents(
  events: readonly DateEvent[],
  year: number,
  month: number,
  weekStartsOn: number,
): BarRow[] {
  const grid = monthGrid(year, month, weekStartsOn);
  // biome-ignore lint/style/noNonNullAssertion: monthGrid always returns six complete weeks.
  return dateRows(events, dateDay(grid[0]![0]!.date), 6, 7);
}

/** One all-day strip for a day/week view (1–7 consecutive dates). */
export function layoutAllDayEvents(
  events: readonly DateEvent[],
  startDate: string,
  dayCount: number,
): BarRow {
  integer(dayCount, 1, 7);
  // biome-ignore lint/style/noNonNullAssertion: dateRows is requested to produce exactly one row.
  return dateRows(events, dateDay(startDate), 1, dayCount)[0]!;
}
