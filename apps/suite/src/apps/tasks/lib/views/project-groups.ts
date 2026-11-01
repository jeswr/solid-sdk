// AUTHORED-BY Codex GPT-6
import type { Category } from "../model/tracker";
import { compareDue } from "./today";
import type { TaskView } from "./types";

export type SortMode = "manual" | "due" | "priority" | "name";
export interface Row {
  task: TaskView;
  depth: 0 | 1;
  orphanParentTitle?: string;
}
export interface ProjectGroups {
  unsectioned: Row[];
  sections: { section: Category; rows: Row[]; openCount: number }[];
}
const position = (task: TaskView) => task.position ?? Infinity;
export function compareTasks(mode: SortMode): (a: TaskView, b: TaskView) => number {
  return (a, b) => {
    if (mode === "name") return a.title.localeCompare(b.title);
    if (mode === "due") return compareDue(a, b) || manual(a, b);
    if (mode === "priority") return a.priority - b.priority || manual(a, b);
    return manual(a, b);
  };
}
function manual(a: TaskView, b: TaskView): number {
  return (
    position(a) - position(b) ||
    (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0) ||
    a.url.localeCompare(b.url)
  );
}
/** One visible nesting level. Closed/filtered parents leave a breadcrumb on their children. */
export function flatRows(tasks: readonly TaskView[], allTasks: readonly TaskView[] = tasks): Row[] {
  const parents = new Map(
    tasks.filter((task) => task.state === "open" && !task.parentId).map((task) => [task.id, task]),
  );
  const titles = new Map(allTasks.map((task) => [task.id, task.title]));
  const result: Row[] = [];
  for (const task of tasks) {
    if (task.parentId && parents.has(task.parentId)) continue;
    result.push({
      task,
      depth: 0,
      ...(task.parentId ? { orphanParentTitle: titles.get(task.parentId) ?? "Parent task" } : {}),
    });
    if (parents.has(task.id))
      for (const child of tasks.filter((item) => item.parentId === task.id))
        result.push({ task: child, depth: 1 });
  }
  return result;
}
export function projectGroups(
  tasks: readonly TaskView[],
  sections: readonly Category[],
  sort: SortMode,
  showCompleted = false,
): ProjectGroups {
  const visible = tasks
    .filter((task) => showCompleted || task.state === "open")
    .sort(compareTasks(sort));
  const byId = new Map(
    visible
      .filter((task) => task.state === "open" && !task.parentId)
      .map((task) => [task.id, task]),
  );
  const sectionIds = new Set(sections.map((section) => section.id));
  const sectionOf = (task: TaskView) => {
    const id = (task.parentId ? (byId.get(task.parentId) ?? task) : task).sectionId;
    return id && sectionIds.has(id) ? id : undefined;
  };
  return {
    unsectioned: flatRows(
      visible.filter((task) => sectionOf(task) === undefined),
      tasks,
    ),
    sections: [...sections]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
      .map((section) => {
        const members = visible.filter((task) => sectionOf(task) === section.id);
        return {
          section,
          rows: flatRows(members, tasks),
          openCount: members.filter((task) => task.state === "open").length,
        };
      }),
  };
}
