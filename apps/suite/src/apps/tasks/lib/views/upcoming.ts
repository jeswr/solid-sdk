// AUTHORED-BY Codex GPT-6.1-Sol
import { addDays, dateFromDayKey, localDayKey, shortDayLabel } from "./days";
import { compareDue, taskDayKey, todayGroups } from "./today";
import type { TaskView } from "./types";

function weekDays(start: Date): Date[] {
  const midnight = dateFromDayKey(localDayKey(start));
  return Array.from({ length: 7 }, (_, index) => addDays(midnight, index));
}

export function weekStrip(start: Date, tasks: readonly TaskView[], now: Date) {
  const today = localDayKey(now);
  return weekDays(start).map((date) => {
    const dayKey = localDayKey(date);
    return {
      dayKey,
      date,
      weekdayLetter: date.toLocaleDateString("en-GB", { weekday: "narrow" }),
      dayOfMonth: date.getDate(),
      count: tasks.filter((task) => task.state === "open" && taskDayKey(task) === dayKey).length,
      isToday: dayKey === today,
    };
  });
}

export function agenda(start: Date, tasks: readonly TaskView[], now: Date) {
  const firstKey = localDayKey(start);
  const endKey = localDayKey(addDays(start, 7));
  const open = tasks.filter((task) => task.state === "open");
  return {
    ...(firstKey === localDayKey(now) ? { overdue: todayGroups(tasks, now).overdue } : {}),
    days: weekDays(start).map((date) => {
      const dayKey = localDayKey(date);
      return {
        dayKey,
        label: shortDayLabel(date),
        tasks: open.filter((task) => taskDayKey(task) === dayKey).sort(compareDue),
      };
    }),
    later: open
      .filter((task) => {
        const key = taskDayKey(task);
        return key !== undefined && key >= endKey;
      })
      .sort(compareDue),
  };
}

export function shiftWeek(start: Date, direction: -1 | 1): Date {
  return addDays(start, direction * 7);
}

/** Native Date resolves DST gaps forward and folds to the earlier local instant. */
export function rescheduleToDay(task: TaskView, dayKey: string): { due: Date; allDay?: string } {
  const due = dateFromDayKey(dayKey);
  if (task.allDay !== undefined || task.due === undefined) return { due, allDay: dayKey };
  due.setHours(
    task.due.getHours(),
    task.due.getMinutes(),
    task.due.getSeconds(),
    task.due.getMilliseconds(),
  );
  return { due };
}
