// AUTHORED-BY Codex GPT-6
import type { TaskView } from "../views/types";

type Due = Pick<TaskView, "due" | "allDay">;
/** Calendar dates, rather than elapsed 24-hour periods, survive DST transitions. */
export function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}
export function dueDate(view: Due): Date | undefined {
  return view.allDay ? new Date(`${view.allDay}T00:00:00`) : view.due;
}
export function isOverdue(view: Due, now: Date): boolean {
  const due = dueDate(view);
  return Boolean(due && (view.allDay ? localDay(due) < localDay(now) : due < now));
}
export function formatDue(view: Due, now: Date, locale = "en-GB"): string {
  const due = dueDate(view);
  if (!due) return "";
  const days = (localDay(due) - localDay(now)) / 86_400_000;
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days > 1 && days <= 6
          ? due.toLocaleDateString(locale, { weekday: "short" })
          : due.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
              ...(due.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
            });
  return view.allDay
    ? day
    : `${day} ${due.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}
