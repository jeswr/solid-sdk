// AUTHORED-BY Codex GPT-6.1-Sol
import { layoutMonthEvents, monthGrid } from "../lib/layout";
import type { CalendarEvent } from "../lib/model";
import { addDays, dateKey, localDate, type Occurrence, occursOn } from "./view";

/** Project instants onto civil dates; midnight ends are exclusive, including across DST. */
export function monthEventRange(event: CalendarEvent) {
  const startDate = dateKey(event.start);
  let endDate: string;
  if (typeof event.start === "string") {
    endDate = typeof event.end === "string" ? event.end : addDays(startDate, 1);
  } else if (event.end instanceof Date && +event.end > +event.start) {
    const endDay = dateKey(event.end);
    endDate = +event.end === +localDate(endDay) ? endDay : addDays(endDay, 1);
  } else endDate = addDays(startDate, 1);
  return { startDate, endDate };
}

export function monthBarLabel(event: CalendarEvent): string {
  return `${event.name}, ${monthRangeLabel(event)}`;
}

/** The inclusive day range of an all-day or multi-day event, e.g. "Sun 1 Nov 2026 – Tue 3 Nov 2026". */
export function monthRangeLabel(event: CalendarEvent): string {
  const { startDate, endDate } = monthEventRange(event);
  const format = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const formatDay = (day: string) => format.format(localDate(day)).replace(",", "");
  const first = formatDay(startDate);
  const last = addDays(endDate, -1);
  return `${first}${last === startDate ? "" : ` – ${formatDay(last)}`}`;
}

/** Pack all-day and multi-day occurrences above single-day timed events. No input is mutated. */
export function layoutMonth(
  events: readonly Occurrence[],
  year: number,
  month: number,
  weekStart: number,
  limit: number,
) {
  const grid = monthGrid(year, month, weekStart);
  const byId = new Map(events.map((event) => [event.id, event]));
  const ranges = events.map((event) => ({ id: event.id, ...monthEventRange(event.data) }));
  const spanning = ranges.filter((range) => {
    const event = byId.get(range.id) as Occurrence;
    return typeof event.data.start === "string" || range.endDate > addDays(range.startDate, 1);
  });
  const spanningIds = new Set(spanning.map((event) => event.id));
  const rows = layoutMonthEvents(spanning, year, month, weekStart);
  return grid.map((week, index) => {
    const row = rows[index] as (typeof rows)[number];
    const barLanes = Math.min(limit, row.laneCount);
    const bars = row.bars
      .filter((bar) => bar.lane < limit)
      .map((bar) => ({ ...bar, event: byId.get(bar.id) as Occurrence }));
    return {
      startDate: row.startDate,
      barLanes,
      bars,
      days: week.map((cell) => {
        const dayEvents = events.filter((event) => occursOn(event.data, cell.date));
        const dayBars = bars.filter(
          (bar) => bar.column <= cell.column && cell.column < bar.column + bar.span,
        );
        // Keep each continuous bar in its lane, but use empty columns for timed entries.
        const dayBarLanes = dayBars.reduce((count, bar) => Math.max(count, bar.lane + 1), 0);
        const timed = dayEvents
          .filter((event) => !spanningIds.has(event.id))
          .sort(
            (a, b) => +(a.data.start as Date) - +(b.data.start as Date) || a.id.localeCompare(b.id),
          )
          .slice(0, limit - dayBarLanes);
        return {
          ...cell,
          barLanes: dayBarLanes,
          events: dayEvents,
          timed,
          hidden: dayEvents.length - dayBars.length - timed.length,
        };
      }),
    };
  });
}
