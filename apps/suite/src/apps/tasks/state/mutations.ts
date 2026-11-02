// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "../lib/model/rdf";
import type { StoredProject, StoredTask } from "../lib/model/store";
import { TaskItem } from "../lib/model/task";
import { TaskTracker } from "../lib/model/tracker";
export function changeTask(item: StoredTask, change: (task: TaskItem) => void): StoredTask {
  const dataset = new Store([...item.dataset]);
  const task = new TaskItem(item.task.id, dataset, DataFactory);
  change(task);
  return { ...item, dataset, task };
}
export function changeProject(
  item: StoredProject,
  change: (tracker: TaskTracker) => void,
): StoredProject {
  const dataset = new Store([...item.dataset]);
  const tracker = new TaskTracker(item.tracker.id, dataset, DataFactory);
  change(tracker);
  return { ...item, dataset, tracker };
}
export function sortedProjects(
  projects: readonly StoredProject[],
  inboxUrl: string,
): StoredProject[] {
  return projects
    .filter((project) => !project.tracker.archivedAt)
    .sort(
      (a, b) =>
        Number(b.url === inboxUrl) - Number(a.url === inboxUrl) ||
        (a.tracker.position ?? Infinity) - (b.tracker.position ?? Infinity) ||
        a.url.localeCompare(b.url),
    );
}
export function moveItem<T>(items: readonly T[], index: number, direction: "up" | "down"): T[] {
  const next = index + (direction === "up" ? -1 : 1);
  const result = [...items];
  if (index < 0 || next < 0 || next >= items.length) return result;
  [result[index], result[next]] = [result[next] as T, result[index] as T];
  return result;
}
/** Recompute from a confirmed baseline, never a captured optimistic snapshot. */
export function optimisticValue<T>(baseline: T, changes: readonly ((value: T) => T)[]): T {
  return changes.reduce((value, change) => change(value), baseline);
}
