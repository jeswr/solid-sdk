// AUTHORED-BY Codex GPT-6.1-Sol
import type { TaskView } from "./types";

/** Deletion leaves children untouched, so retain completed ancestors of protected tasks. */
export function completedParentsToKeep(
  tasks: readonly Pick<TaskView, "id" | "parentId" | "state">[],
  candidates?: ReadonlySet<string>,
  kept: ReadonlySet<string> = new Set(),
) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set<string>();
  const openSubtasks = new Set<string>();
  for (const task of tasks) {
    if (task.state !== "open" && !kept.has(task.id)) continue;
    const seen = new Set([task.id]);
    let parentId = task.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.state === "closed" && (!candidates || candidates.has(parent.id))) {
        parents.add(parent.id);
        if (task.state === "open") openSubtasks.add(task.id);
      }
      parentId = parent.parentId;
    }
  }
  return { parents, openSubtasks };
}

/** Keep all recurrence copies: even an unbounded or finished series may be edited later. */
export function completedHistoryToKeep(
  tasks: readonly Pick<TaskView, "id" | "state" | "derivedFrom">[],
  candidates?: ReadonlySet<string>,
): Set<string> {
  return new Set(
    tasks
      .filter(
        (task) =>
          task.state === "closed" && task.derivedFrom && (!candidates || candidates.has(task.id)),
      )
      .map((task) => task.id),
  );
}

/** Queue children before parents; cycles remain protected by the cache's child guard. */
export function descendantsFirst<T extends Pick<TaskView, "id" | "parentId">>(
  tasks: readonly T[],
): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = (task: T) => {
    const seen = new Set([task.id]);
    let parent = task.parentId;
    while (parent && !seen.has(parent) && byId.has(parent)) {
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    return seen.size;
  };
  return tasks.toSorted((a, b) => depth(b) - depth(a));
}
