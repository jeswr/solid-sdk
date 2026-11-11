// AUTHORED-BY Codex GPT-6
import type { Category } from "../model/tracker";
import { compareDue } from "./today";
import type { TaskView } from "./types";

export type SortMode = "manual" | "due" | "priority" | "name";
export interface Row {
  task: TaskView;
  depth: number;
  orphanParentTitle?: string;
}
export interface ProjectGroups {
  unsectioned: Row[];
  sections: { section: Category; rows: Row[]; openCount: number }[];
}
const indexes = new WeakMap<readonly TaskView[], ReadonlyMap<string, TaskView>>();
/** View arrays are immutable cache snapshots; share their ancestry index across rows/plans. */
export function taskIndex(tasks: readonly TaskView[]): ReadonlyMap<string, TaskView> {
  let index = indexes.get(tasks);
  if (!index) {
    index = new Map(tasks.map((task) => [task.id, task]));
    indexes.set(tasks, index);
  }
  return index;
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
/** Flat date/label views retain the parent breadcrumb at every depth. */
export function flatRows(tasks: readonly TaskView[], allTasks: readonly TaskView[] = tasks): Row[] {
  const titles = new Map(allTasks.map((task) => [task.id, task.title]));
  return tasks.map((task) => ({
    task,
    depth: 0,
    ...(task.parentId ? { orphanParentTitle: titles.get(task.parentId) ?? "Parent task" } : {}),
  }));
}

/** Iterative preorder at unlimited depth; malformed cycles still render each task once. */
export function treeRows(tasks: readonly TaskView[], allTasks: readonly TaskView[] = tasks): Row[] {
  const byId = taskIndex(tasks);
  const children = new Map<string, TaskView[]>();
  for (const task of tasks) {
    if (!task.parentId || byId.get(task.parentId)?.state !== "open") continue;
    const group = children.get(task.parentId) ?? [];
    group.push(task);
    children.set(task.parentId, group);
  }
  const result: Row[] = [];
  const seen = new Set<string>();
  const visit = (root: Row) => {
    const pending = [root];
    while (pending.length) {
      const row = pending.pop() as Row;
      if (seen.has(row.task.id)) continue;
      seen.add(row.task.id);
      result.push(row);
      for (const task of [...(children.get(row.task.id) ?? [])].reverse())
        pending.push({ task, depth: row.depth + 1 });
    }
  };
  for (const row of flatRows(tasks, allTasks))
    if (!row.task.parentId || byId.get(row.task.parentId)?.state !== "open") visit(row);
  for (const row of flatRows(tasks, allTasks)) if (!seen.has(row.task.id)) visit(row);
  return result;
}

/** Descendants inherit the highest visible open ancestor's section. */
export function taskSection(
  task: TaskView,
  tasks: readonly TaskView[],
  includeClosed = false,
): string | undefined {
  const byId = taskIndex(tasks);
  const seen = new Set([task.id]);
  let current = task;
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent || (!includeClosed && parent.state !== "open") || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.sectionId;
}
export function projectGroups(
  tasks: readonly TaskView[],
  sections: readonly Category[],
  sort: SortMode,
  showCompleted = false,
  flat = false,
): ProjectGroups {
  const visible = tasks
    .filter((task) => showCompleted || task.state === "open")
    .sort(compareTasks(sort));
  const sectionIds = new Set(sections.map((section) => section.id));
  const sectionOf = (task: TaskView) => {
    const id = flat ? task.sectionId : taskSection(task, visible);
    return id && sectionIds.has(id) ? id : undefined;
  };
  const rows = flat ? flatRows : treeRows;
  return {
    unsectioned: rows(
      visible.filter((task) => sectionOf(task) === undefined),
      tasks,
    ),
    sections: [...sections]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
      .map((section) => {
        const members = visible.filter((task) => sectionOf(task) === section.id);
        return {
          section,
          rows: rows(members, tasks),
          openCount: members.filter((task) => task.state === "open").length,
        };
      }),
  };
}
