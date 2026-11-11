// AUTHORED-BY Codex GPT-6.1-Sol
import { addDays, dateFromDayKey, localDayKey, startOfWeek, type WeekStart } from "./days";
import { taskDayKey } from "./today";
import type { TaskView } from "./types";

export interface DateRange {
  from: string;
  to: string;
}
export const upcomingRanges = { week: "This week", next7: "Next 7 days", next30: "Next 30 days" };
export const completedRanges = { last7: "Last 7 days", last30: "Last 30 days" };
export type RangePreset = keyof typeof upcomingRanges | keyof typeof completedRanges;
export function presetRange(preset: RangePreset, now: Date, weekStart: WeekStart): DateRange {
  const today = dateFromDayKey(localDayKey(now));
  const from =
    preset === "week"
      ? startOfWeek(today, weekStart)
      : addDays(today, preset === "last7" ? -6 : preset === "last30" ? -29 : 0);
  const to =
    preset === "week"
      ? addDays(from, 6)
      : addDays(today, preset === "next7" ? 6 : preset === "next30" ? 29 : 0);
  return { from: localDayKey(from), to: localDayKey(to) };
}
export function validRange(range: DateRange, maxDays?: number): boolean {
  try {
    const from = dateFromDayKey(range.from);
    const to = dateFromDayKey(range.to);
    return (
      range.from <= range.to &&
      (maxDays === undefined || to.getTime() <= addDays(from, maxDays - 1).getTime())
    );
  } catch {
    return false;
  }
}
/** Both bounds are required, single-valued, real calendar dates and inclusive. */
export function parseDateRange(
  params: URLSearchParams,
  fallback: DateRange,
  maxDays?: number,
): DateRange {
  const from = params.getAll("from");
  const to = params.getAll("to");
  const range = { from: from[0] ?? "", to: to[0] ?? "" };
  return from.length === 1 && to.length === 1 && validRange(range, maxDays) ? range : fallback;
}
export function filterDateRange(
  tasks: readonly TaskView[],
  range: DateRange,
  kind: "upcoming" | "completed",
): TaskView[] {
  return tasks.filter((task) => {
    if (task.state !== (kind === "completed" ? "closed" : "open")) return false;
    const key =
      kind === "completed" ? task.completedAt && localDayKey(task.completedAt) : taskDayKey(task);
    return key !== undefined && key >= range.from && key <= range.to;
  });
}
/** Calendar iteration, never fixed millisecond increments over DST. */
export function rangeDays(range: DateRange): string[] {
  const result: string[] = [];
  for (
    let date = dateFromDayKey(range.from);
    localDayKey(date) <= range.to;
    date = addDays(date, 1)
  ) {
    const key = localDayKey(date);
    result.push(key);
    if (key === range.to) break;
  }
  return result;
}
