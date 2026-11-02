// AUTHORED-BY Codex GPT-6.1-Sol
import { addDays, dateFromDayKey, localDayKey, shortDayLabel } from "./days";
import type { TaskView } from "./types";

export interface CompletedGroup {
  dayKey: string | undefined;
  label: string;
  tasks: TaskView[];
}

/** Page is zero-based. Filter and sort before slicing; groups can span page boundaries. */
export function completedGroups(
  tasks: readonly TaskView[],
  options: { projectUrl?: string; page: number },
  now: Date,
): { groups: CompletedGroup[]; hasMore: boolean } {
  if (!Number.isSafeInteger(options.page) || options.page < 0) throw new TypeError("Invalid page.");
  const today = localDayKey(now);
  const yesterday = localDayKey(addDays(now, -1));
  const completed = tasks
    .filter(
      (task) =>
        task.state === "closed" &&
        (task.completedAt === undefined || Number.isFinite(task.completedAt.getTime())) &&
        (options.projectUrl === undefined || task.projectUrl === options.projectUrl),
    )
    .sort(
      (a, b) => (b.completedAt?.getTime() ?? -Infinity) - (a.completedAt?.getTime() ?? -Infinity),
    );
  const groups = new Map<string | undefined, CompletedGroup>();
  for (const task of completed.slice(options.page * 50, (options.page + 1) * 50)) {
    const dayKey = task.completedAt && localDayKey(task.completedAt);
    let group = groups.get(dayKey);
    if (!group) {
      const date = dayKey === undefined ? undefined : dateFromDayKey(dayKey);
      const label =
        date === undefined
          ? "Earlier"
          : dayKey === today
            ? "Today"
            : dayKey === yesterday
              ? "Yesterday"
              : shortDayLabel(date, date.getFullYear() !== now.getFullYear());
      group = { dayKey, label, tasks: [] };
      groups.set(dayKey, group);
    }
    group.tasks.push(task);
  }
  return { groups: [...groups.values()], hasMore: (options.page + 1) * 50 < completed.length };
}
