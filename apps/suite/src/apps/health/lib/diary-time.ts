// AUTHORED-BY Codex GPT-6
import type { Range } from "./model";
import { bucketKey } from "./stats/buckets";

export function diaryDay(at: Date): string {
  return bucketKey(at.getTime(), {
    period: "day",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
function shift(day: Date, days: number) {
  const result = new Date(day);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
}
/** Seven civil days ending on the requested day, capped at today. DST days may be 23/25 hours. */
export function diaryWeek(now: Date, requested: string | null, offset: number): Range {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const candidate =
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
      ? new Date(`${requested}T00:00:00`)
      : new Date(NaN);
  const anchor =
    Number.isFinite(candidate.getTime()) && diaryDay(candidate) === requested
      ? new Date(Math.min(candidate.getTime(), today.getTime()))
      : today;
  const last = new Date(Math.min(shift(anchor, -offset * 7).getTime(), today.getTime()));
  return { start: shift(last, -6), end: shift(last, 1) };
}
export function diaryMonday(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return shift(start, -((start.getDay() + 6) % 7));
}
