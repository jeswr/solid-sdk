// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Agenda helpers ported from Pod Manager calendar.ts; civil dates retain their calendar fields.
import type { CalendarDate, CalendarEvent, StoredItem } from "./types";
import { asDate } from "./validation";

function displayDate(value: CalendarDate): Date {
  asDate(value);
  return typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
}
/** Sort events ascending by start time (chronological agenda order). */
export function sortByStart(items: StoredItem<CalendarEvent>[]): StoredItem<CalendarEvent>[] {
  return [...items].sort((a, b) => +displayDate(a.data.start) - +displayDate(b.data.start));
}

/** Stable `YYYY-MM` key: civil fields for dates, local time for instants. */
export function monthKey(date: CalendarDate): string {
  if (typeof date === "string") return date.slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Stable `YYYY-MM-DD` key: civil fields for dates, local time for instants. */
export function dayKey(date: CalendarDate): string {
  if (typeof date === "string") return date;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** A day's worth of events for the agenda view. */
export interface AgendaDay {
  /** `YYYY-MM-DD` key. */
  key: string;
  /** Midnight of the day (local). */
  date: Date;
  events: StoredItem<CalendarEvent>[];
}

/**
 * Group events into chronological day buckets for an agenda list. Each day is
 * sorted by start time; days are returned earliest-first.
 */
export function groupByDay(items: StoredItem<CalendarEvent>[]): AgendaDay[] {
  const byKey = new Map<string, AgendaDay>();
  for (const item of sortByStart(items)) {
    const key = dayKey(item.data.start);
    let day = byKey.get(key);
    if (!day) {
      day = {
        key,
        date: new Date(`${key}T00:00:00`),
        events: [],
      };
      byKey.set(key, day);
    }
    day.events.push(item);
  }
  return [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** One cell of a month grid. */
export interface MonthCell {
  date: Date;
  /** False for the leading/trailing days that belong to an adjacent month. */
  inMonth: boolean;
  events: StoredItem<CalendarEvent>[];
}

/**
 * Build a 6-row × 7-column month matrix (weeks start Sunday) for the month
 * containing `anchor`, with each cell carrying that day's events. Always 42
 * cells so the grid never reflows between months.
 */
export function monthMatrix(anchor: Date, items: StoredItem<CalendarEvent>[]): MonthCell[][] {
  const byDay = new Map<string, StoredItem<CalendarEvent>[]>();
  for (const item of items) {
    const k = dayKey(item.data.start);
    const list = byDay.get(k) ?? [];
    list.push(item);
    byDay.set(k, list);
  }

  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay()); // back up to the Sunday on/before the 1st

  const weeks: MonthCell[][] = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(cursor);
      const dayEvents = sortByStart(byDay.get(dayKey(date)) ?? []);
      week.push({ date, inMonth: date.getMonth() === anchor.getMonth(), events: dayEvents });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Calendar-neutral month selection. The caller supplies listing URLs; no new layout is minted. */
export function monthsInRange(from: Date, to: Date): string[] {
  asDate(from);
  asDate(to);
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (+cursor < +to) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return +to <= +from ? [] : keys;
}
export function selectMonthListings(
  listings: ReadonlyMap<string, string>,
  from: Date,
  to: Date,
): string[] {
  return monthsInRange(from, to).flatMap((key) => {
    const url = listings.get(key);
    return url === undefined ? [] : [url];
  });
}
export function groupByMonth(
  items: StoredItem<CalendarEvent>[],
): Map<string, StoredItem<CalendarEvent>[]> {
  const months = new Map<string, StoredItem<CalendarEvent>[]>();
  for (const item of sortByStart(items)) {
    const key = monthKey(item.data.start);
    const list = months.get(key) ?? [];
    list.push(item);
    months.set(key, list);
  }
  return months;
}
