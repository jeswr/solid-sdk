// AUTHORED-BY Codex (GPT-6.1 Sol)
import { calendarDay, dailySeries, mean, type Series, shiftDay } from "@jeswr/suite-insights";
/** Compare elapsed calendar-week days with the same weekdays last week, excluding today. */
export function weekComparison(series: Series, now: Date, timeZone: string) {
  const today = calendarDay(now, timeZone);
  const elapsed = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(today, -elapsed);
  const daily = dailySeries(series.points, timeZone, series.aggregation);
  const current = daily
    .filter((p) => p.day >= start && p.day < today)
    .map((p) => p.value as number);
  const previous = daily
    .filter((p) => p.day >= shiftDay(start, -7) && p.day < shiftDay(today, -7))
    .map((p) => p.value as number);
  const value = mean(current);
  const before = mean(previous);
  return {
    value,
    previous: before,
    delta: value === null || before === null ? null : value - before,
    days: current.length,
    previousDays: previous.length,
    elapsed,
  };
}
export function availableSeries(sources: readonly { series: Series[] }[]) {
  return sources.flatMap((s) => s.series).filter((s) => s.points.length > 0);
}
