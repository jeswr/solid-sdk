// AUTHORED-BY Codex GPT-6.1-Sol
import { addDays, localDayKey, startOfWeek, type WeekStart } from "./days";
import { compareTasks, type SortMode } from "./project-groups";
import { taskDayKey } from "./today";
import type { TaskView } from "./types";

export const groupOptions = {
  none: "None",
  due: "Due date",
  priority: "Priority",
  project: "Project",
  label: "Label",
  assignee: "Assignee",
} as const;
export type GroupMode = keyof typeof groupOptions;
export interface TaskGroup {
  id: string;
  title: string;
  tasks: TaskView[];
}
export interface GroupContext {
  now: Date;
  weekStart: WeekStart;
  labels: ReadonlyMap<string, string>;
}
const dueTitles = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date"];
function dueGroup(task: TaskView, context: GroupContext): number {
  const key = taskDayKey(task);
  const today = localDayKey(context.now);
  if (key === undefined) return 5;
  if (key < today) return 0;
  if (key === today) return 1;
  if (key === localDayKey(addDays(context.now, 1))) return 2;
  return key < localDayKey(addDays(startOfWeek(context.now, context.weekStart), 7)) ? 3 : 4;
}

/** Label names union across projects; multi-labelled tasks use the first name alphabetically. */
export function groupTasks(
  tasks: readonly TaskView[],
  mode: GroupMode,
  context: GroupContext,
  sort?: SortMode,
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const fallback = mode === "label" ? "No label" : "Unassigned";
  for (const task of tasks) {
    let keys: { id: string; title: string }[];
    if (mode === "due") {
      const rank = dueGroup(task, context);
      keys = [{ id: String(rank), title: dueTitles[rank] as string }];
    } else if (mode === "priority") {
      keys = [{ id: String(task.priority), title: `P${task.priority}` }];
    } else if (mode === "project") {
      keys = [{ id: task.projectUrl, title: task.projectTitle }];
    } else if (mode === "label") {
      const names = new Map<string, string>();
      for (const id of task.labelIds) {
        const name = context.labels.get(id);
        if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      }
      keys = [...names].map(([id, title]) => ({ id: `label:${id}`, title }));
      keys.sort((a, b) => a.title.localeCompare(b.title, "en-GB"));
      keys = keys.slice(0, 1);
      if (!keys.length) keys = [{ id: "missing", title: fallback }];
    } else if (mode === "assignee") {
      keys = [{ id: task.assignee ?? "missing", title: task.assignee ?? fallback }];
    } else keys = [{ id: "none", title: "" }];
    for (const { id, title } of keys) {
      let group = groups.get(id);
      if (!group) {
        group = { id, title, tasks: [] };
        groups.set(id, group);
      }
      group.tasks.push(task);
    }
  }
  const result = [...groups.values()];
  result.sort((a, b) => {
    if (mode === "due" || mode === "priority") return Number(a.id) - Number(b.id);
    return (
      Number(a.id === "missing") - Number(b.id === "missing") ||
      a.title.localeCompare(b.title, "en-GB") ||
      a.id.localeCompare(b.id)
    );
  });
  if (sort) for (const group of result) group.tasks.sort(compareTasks(sort));
  return result;
}
