// AUTHORED-BY Codex GPT-6.1-Sol
import { dateFromDayKey, localDayKey } from "./days";
import type { TaskView } from "./types";

/** All-day markers take precedence, including when read in another time zone. */
export function taskDayKey(task: TaskView): string | undefined {
  return task.allDay ?? (task.due && localDayKey(task.due));
}

/** Due ascending, all-day first on a shared day, then time and manual position. */
export function compareDue(a: TaskView, b: TaskView): number {
  const instant = (task: TaskView) =>
    task.allDay === undefined ? task.due?.getTime() : dateFromDayKey(task.allDay).getTime();
  return (
    (instant(a) ?? Infinity) - (instant(b) ?? Infinity) ||
    Number(b.allDay !== undefined) - Number(a.allDay !== undefined) ||
    (a.position ?? Infinity) - (b.position ?? Infinity) ||
    0
  );
}

export function todayGroups(
  tasks: readonly TaskView[],
  now: Date,
): { overdue: TaskView[]; today: TaskView[] } {
  const todayKey = localDayKey(now);
  const overdue: TaskView[] = [];
  const today: TaskView[] = [];
  for (const task of tasks) {
    if (task.state !== "open") continue;
    const key = taskDayKey(task);
    if (key === undefined) continue;
    if (key < todayKey) overdue.push(task);
    else if (key === todayKey) today.push(task);
  }
  return { overdue: overdue.sort(compareDue), today: today.sort(compareDue) };
}

export function todayCount(tasks: readonly TaskView[], now: Date): number {
  const groups = todayGroups(tasks, now);
  return groups.overdue.length + groups.today.length;
}

export function overdueCount(tasks: readonly TaskView[], now: Date): number {
  return todayGroups(tasks, now).overdue.length;
}
