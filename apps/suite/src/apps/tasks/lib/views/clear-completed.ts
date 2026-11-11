// AUTHORED-BY Codex GPT-6.1-Sol
import type { TaskView } from "./types";

/** Deletion leaves children untouched, so retain completed ancestors of open tasks. */
export function completedParentsToKeep(
  tasks: readonly Pick<TaskView, "id" | "parentId" | "state">[],
  candidates?: ReadonlySet<string>,
) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set<string>();
  const openSubtasks = new Set<string>();
  for (const task of tasks) {
    if (task.state !== "open") continue;
    const seen = new Set([task.id]);
    let parentId = task.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.state === "closed" && (!candidates || candidates.has(parent.id))) {
        parents.add(parent.id);
        openSubtasks.add(task.id);
      }
      parentId = parent.parentId;
    }
  }
  return { parents, openSubtasks };
}
