import type { IssueRecord } from "./repository";

/** One positioned bar on the timeline (percentages of the full span). */
export interface TimelineBar {
  issue: IssueRecord;
  /** 0–100 left offset. */
  start: number;
  /** 0–100 width (≥ a visible minimum). */
  width: number;
}

export interface TimelineModel {
  from: Date;
  to: Date;
  bars: TimelineBar[];
  /** Month boundaries inside the span, for axis ticks (0–100 offsets). */
  ticks: { at: number; label: string }[];
}

const DAY = 24 * 3600 * 1000;
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short" });

/**
 * Build a Gantt model from issues that have dates: each bar runs from `created`
 * to `dateDue` (falling back to a one-day bar when only one of them exists).
 * Issues with neither date are omitted — a timeline can't place them.
 */
export function buildTimeline(issues: IssueRecord[], now = new Date()): TimelineModel | null {
  const dated = issues
    .map((i) => {
      const start = i.created ?? i.dateDue;
      const end = i.dateDue ?? (i.created ? new Date(Math.min(now.getTime(), i.created.getTime() + 7 * DAY)) : undefined);
      return start && end ? { issue: i, start, end: end.getTime() < start.getTime() ? start : end } : null;
    })
    .filter((x): x is { issue: IssueRecord; start: Date; end: Date } => x !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (dated.length === 0) return null;

  const from = new Date(Math.min(...dated.map((d) => d.start.getTime())));
  const to = new Date(Math.max(...dated.map((d) => d.end.getTime()), from.getTime() + DAY));
  const span = to.getTime() - from.getTime();
  const pct = (t: number) => ((t - from.getTime()) / span) * 100;

  const bars: TimelineBar[] = dated.map(({ issue, start, end }) => {
    const left = pct(start.getTime());
    const width = Math.max(pct(end.getTime()) - left, 1.5);
    return { issue, start: left, width: Math.min(width, 100 - left) };
  });

  const ticks: TimelineModel["ticks"] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  while (cursor.getTime() < to.getTime()) {
    ticks.push({ at: pct(cursor.getTime()), label: monthFmt.format(cursor) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { from, to, bars, ticks };
}

/** A month grid (6 weeks × 7 days) for the calendar view, with issues on due dates. */
export interface CalendarDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  issues: IssueRecord[];
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Build the weeks of `year`/`month` (0-based), Monday-first, with due issues placed. */
export function buildMonth(issues: IssueRecord[], year: number, month: number, today = new Date()): CalendarDay[][] {
  const first = new Date(year, month, 1);
  // Monday-first offset (getDay(): Sun=0 … Sat=6).
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      week.push({
        date,
        inMonth: date.getMonth() === month,
        isToday: sameDay(date, today),
        issues: issues.filter((i) => i.dateDue && sameDay(i.dateDue, date)),
      });
    }
    weeks.push(week);
  }
  return weeks;
}
