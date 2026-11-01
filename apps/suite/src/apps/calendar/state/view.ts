// AUTHORED-BY Codex GPT-6.1-Sol
import { type SuiteToken, tokens } from "@jeswr/suite-ui/tokens";
import { type MonthCell, monthGrid } from "../lib/layout";
import type {
  CalendarDate,
  CalendarEvent,
  RecurrenceRule,
  Reminder,
  StoredItem,
} from "../lib/model";
import { durationMilliseconds } from "../lib/model/validation";

export const VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof VIEWS)[number];
export interface CalendarInfo {
  url: string;
  title: string;
  colour: string;
  etag: string | null;
  container: string;
}
export interface Occurrence extends StoredItem<CalendarEvent> {
  id: string;
  calendar: CalendarInfo;
}
// Store portable colours from the suite's app tokens. Chips use neutral theme text/surfaces.
export const PALETTE = [
  "--app-calendar",
  "--app-drive",
  "--app-tasks",
  "--app-chat",
  "--app-mail",
  "--app-home",
  "--app-notes",
  "--app-photos",
].map((name) => (tokens.find((token) => token.name === name) as SuiteToken).light);
export function calendarColour(url: string): string {
  let hash = 0;
  for (const char of url) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}
export function isView(value: string): value is CalendarView {
  return VIEWS.some((v) => v === value);
}
export function dateKey(date: CalendarDate): string {
  if (typeof date === "string") return date;
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}
export function localDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}
export function parseDate(value: string | null | undefined, today = new Date()): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = localDate(value);
    if (
      Number.isFinite(+date) &&
      dateKey(date) === value &&
      date.getFullYear() >= 1 &&
      date.getFullYear() <= 9999
    )
      return value;
  }
  return dateKey(today);
}
export function addDays(key: string, days: number): string {
  const date = localDate(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function addMonths(key: string, months: number): string {
  const date = localDate(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return dateKey(date);
}
export function visibleRange(
  view: CalendarView,
  key: string,
  weekStart: number,
  agendaDays = 30,
): { from: string; to: string } {
  if (view === "month") {
    const date = localDate(key);
    const grid = monthGrid(date.getFullYear(), date.getMonth() + 1, weekStart);
    return {
      from: (grid.flat()[0] as MonthCell).date,
      to: addDays((grid.flat()[41] as MonthCell).date, 1),
    };
  }
  const from =
    view === "week" ? addDays(key, -((localDate(key).getDay() - weekStart + 7) % 7)) : key;
  return { from, to: addDays(from, view === "week" ? 7 : view === "agenda" ? agendaDays : 1) };
}
export function stepDate(view: CalendarView, key: string, step: number): string {
  return view === "month"
    ? addMonths(key, step)
    : addDays(key, step * (view === "week" ? 7 : view === "agenda" ? 30 : 1));
}
export function calendarHref(view: CalendarView, date: string): string {
  return `/calendar/${view}?d=${encodeURIComponent(date)}`;
}
export function rangeKey(webId: string, calendars: string[], from: string, to: string): string {
  return JSON.stringify([webId, [...calendars].sort(), from, to]);
}
export function rangeTitle(view: CalendarView, date: string, weekStart: number): string {
  const start = localDate(date);
  if (view === "day")
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .format(start)
      .replace(",", "");
  if (view === "month")
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(start);
  const range = visibleRange(view, date, weekStart);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatRange(localDate(range.from), localDate(addDays(range.to, -1)));
}
export function occursOn(event: CalendarEvent, day: string): boolean {
  const start = typeof event.start === "string" ? +localDate(event.start) : +event.start;
  const end =
    event.end === undefined
      ? typeof event.start === "string"
        ? +localDate(addDays(event.start, 1))
        : start + 1
      : typeof event.end === "string"
        ? +localDate(event.end)
        : +event.end;
  return start < +localDate(addDays(day, 1)) && end > +localDate(day);
}
export function eventTime(event: CalendarEvent): string {
  if (typeof event.start === "string") return "All day";
  const format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  return event.end instanceof Date
    ? `${format.format(event.start)}–${format.format(event.end)}`
    : format.format(event.start);
}
export function eventDateRange(event: CalendarEvent): string {
  const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "full" });
  if (typeof event.start === "string") {
    const end = typeof event.end === "string" ? addDays(event.end, -1) : event.start;
    return `${format.formatRange(localDate(event.start), localDate(end))} · All day`;
  }
  const timed = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" });
  return event.end instanceof Date
    ? timed.formatRange(event.start, event.end)
    : timed.format(event.start);
}
export function recurrenceSummary(rule: RecurrenceRule): string {
  const frequency = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[
    rule.frequency
  ];
  const base =
    rule.interval && rule.interval > 1
      ? `Every ${rule.interval} ${{ DAILY: "days", WEEKLY: "weeks", MONTHLY: "months", YEARLY: "years" }[rule.frequency]}`
      : frequency;
  const days = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
  return `${base}${rule.byDay?.length ? ` on ${rule.byDay.map((d) => days[d]).join(", ")}` : ""}${rule.count ? ` · ${rule.count} occurrences` : ""}${rule.until ? ` · until ${dateKey(rule.until)}` : ""}`;
}
export interface Preferences {
  hidden: string[];
  view: CalendarView;
  weekStart: number;
}
export function preferencesKey(webId: string): string {
  return `suite:calendar:${webId}`;
}
export function defaultWeekStart(locale?: {
  weekInfo?: { firstDay: number };
  getWeekInfo?: () => { firstDay: number };
}): number {
  const first = locale?.weekInfo?.firstDay ?? locale?.getWeekInfo?.().firstDay;
  return first === undefined ? 1 : first % 7;
}
export function readPreferences(raw: string | null, weekStart: number): Preferences {
  const fallback: Preferences = { hidden: [], view: "week", weekStart };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return fallback;
    return {
      hidden: Array.isArray(value.hidden)
        ? value.hidden.filter((id: unknown): id is string => typeof id === "string")
        : [],
      view: isView(value.view) ? value.view : "week",
      weekStart:
        Number.isInteger(value.weekStart) && value.weekStart >= 0 && value.weekStart <= 6
          ? value.weekStart
          : weekStart,
    };
  } catch {
    return fallback;
  }
}
export function projectTimed(events: Occurrence[], from: string, dayCount: number) {
  return Array.from({ length: dayCount }, (_, day) => {
    const date = addDays(from, day);
    return events
      .filter((e) => e.data.start instanceof Date && occursOn(e.data, date))
      .map((event) => {
        const start = event.data.start as Date;
        const end = event.data.end instanceof Date ? event.data.end : new Date(+start + 1800000);
        const startMinute = dateKey(start) < date ? 0 : start.getHours() * 60 + start.getMinutes();
        const endMinute = dateKey(end) > date ? 1440 : end.getHours() * 60 + end.getMinutes();
        return {
          id: `${event.id}:${day}`,
          day,
          startMinute,
          endMinute: Math.min(1440, Math.max(startMinute + 1, endMinute)),
          event,
        };
      });
  }).flat();
}
/** A multi-day occurrence is listed on every intersecting visible civil day. */
export function agendaGroups(
  events: Occurrence[],
  from: string,
  to: string,
): { day: string; events: Occurrence[] }[] {
  const groups: { day: string; events: Occurrence[] }[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) {
    const matches = events.filter((event) => occursOn(event.data, day));
    if (matches.length) groups.push({ day, events: matches });
  }
  return groups;
}

export function reminderSummary(reminder: Reminder): string {
  if (reminder.triggerTime)
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
      reminder.triggerTime,
    );
  const seconds = durationMilliseconds(reminder.triggerOffset as string) / 1000;
  if (seconds === 0) return "At event start";
  let remaining = Math.abs(seconds);
  const labels: string[] = [];
  for (const [scale, label] of [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const) {
    const count = Math.floor(remaining / scale);
    if (count) {
      labels.push(`${count} ${label}${count === 1 ? "" : "s"}`);
      remaining %= scale;
    }
  }
  return `${labels.join(" ")} ${seconds < 0 ? "before" : "after"}`;
}
