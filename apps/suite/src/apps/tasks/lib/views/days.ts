// AUTHORED-BY Codex GPT-6.1-Sol
import { requireDate } from "../model/rdf";

export type WeekStart = "monday" | "sunday" | "locale";

/** Local calendar date, yyyy-mm-dd. Never derive an all-day key from a UTC instant. */
export function localDayKey(date: Date): string {
  requireDate(date);
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Parse a date-only key at local midnight, rejecting Date's calendar rollover. */
export function dateFromDayKey(dayKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new TypeError("Invalid day key.");
  const date = new Date(`${dayKey}T00:00:00`);
  if (localDayKey(date) !== dayKey) throw new TypeError("Invalid day key.");
  return date;
}

/** Calendar arithmetic retains local time across 23-hour and 25-hour days. */
export function addDays(date: Date, amount: number): Date {
  requireDate(date);
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/** Browsers expose the locale week either as a method, a legacy property, or neither. */
function localeFirstDay(): number {
  const locale = new Intl.Locale(new Intl.DateTimeFormat().resolvedOptions().locale) as {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  return (
    (typeof locale.getWeekInfo === "function"
      ? locale.getWeekInfo().firstDay
      : (locale.weekInfo?.firstDay ?? 1)) % 7
  );
}

export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  const firstDay = weekStart === "locale" ? localeFirstDay() : weekStart === "monday" ? 1 : 0;
  const start = dateFromDayKey(localDayKey(date));
  return addDays(start, -((start.getDay() - firstDay + 7) % 7));
}

/** Exact English agenda/toast copy, without locale-dependent commas or padding. */
export function shortDayLabel(date: Date, includeYear = false): string {
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return includeYear
    ? `${date.getDate()} ${month} ${date.getFullYear()}`
    : `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${date.getDate()} ${month}`;
}
