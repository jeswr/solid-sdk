// AUTHORED-BY Codex GPT-6.1-Sol
import type { DateRange, Occurrence, Recurrence, RecurringTemplate } from "./types";
import { dateDay, dateString, range, template, unique } from "./validation";

export function lastDay(date: string): boolean {
  return new Date((dateDay(date) + 1) * 86_400_000).getUTCDate() === 1;
}

/** Inputs are validated by the public entry points before calendar matching. */
export function matches(date: string, start: string, rule: Recurrence): boolean {
  switch (rule.frequency) {
    case "weekly":
      return (dateDay(date) - dateDay(start)) % 7 === 0;
    case "biweekly":
      return (dateDay(date) - dateDay(start)) % 14 === 0;
    case "monthly":
      return rule.day === "last" ? lastDay(date) : Number(date.slice(8)) === rule.day;
    case "yearly":
      return date.slice(5) === start.slice(5);
  }
}

/** Sort by date, then template ID (ascending UTF-16); never mutate inputs. */
export function expandRecurring(
  templates: readonly RecurringTemplate[],
  period: DateRange,
): Occurrence[] {
  range(period);
  unique(templates, template);
  const output: Occurrence[] = [];
  for (const item of templates) {
    const start = Math.max(dateDay(period.start), dateDay(item.startDate));
    const end = Math.min(dateDay(period.end), dateDay(item.endDate ?? period.end));
    for (let day = start; day <= end; day++) {
      const date = dateString(day);
      if (matches(date, item.startDate, item.recurrence)) {
        output.push({
          templateId: item.id,
          accountId: item.accountId,
          currency: item.currency,
          payee: item.payee,
          amount: item.amount,
          date,
        });
      }
    }
  }
  return output.sort((a, b) => compare(a.date, b.date) || compare(a.templateId, b.templateId));
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative scheduled occurrences only. Range is explicit; no implicit system clock. */
export function upcomingBills(
  templates: readonly RecurringTemplate[],
  period: DateRange,
): Occurrence[] {
  return expandRecurring(templates, period).filter((item) => item.amount < 0);
}
