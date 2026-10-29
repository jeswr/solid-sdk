// AUTHORED-BY Codex GPT-6.1-Sol
import { requireInput } from "./calendar";
import { validateTask } from "./filters";
import { type ListTask, TaskListError } from "./types";

export interface SubtaskProgress {
  readonly completed: number;
  readonly total: number;
  readonly open: number;
  /** Empty groups are not complete. This never changes the parent's state. */
  readonly allCompleted: boolean;
}

/** Complete, one-level snapshots only; compute before filtering a smart list. */
export function rollUpSubtasks(tasks: readonly ListTask[]): ReadonlyMap<string, SubtaskProgress> {
  requireInput(Array.isArray(tasks), "Expected a task array");
  const byId = new Map<string, ListTask>();
  for (const task of tasks) {
    validateTask(task);
    if (byId.has(task.id)) throw new TaskListError("invalid-hierarchy", "Duplicate task ID");
    byId.set(task.id, task);
  }
  const counts = new Map<string, { completed: number; total: number }>();
  for (const task of tasks) counts.set(task.id, { completed: 0, total: 0 });
  for (const task of tasks) {
    if (task.parentId === undefined) continue;
    const parent = byId.get(task.parentId);
    if (parent === undefined || parent.id === task.id || parent.parentId !== undefined) {
      throw new TaskListError(
        "invalid-hierarchy",
        "Expected a complete, one-level subtask hierarchy",
      );
    }
    const progress = counts.get(parent.id) as { completed: number; total: number };
    progress.total += 1;
    if (task.state === "completed") progress.completed += 1;
  }
  return new Map(
    [...counts].map(([id, { completed, total }]) => [
      id,
      { completed, total, open: total - completed, allCompleted: total > 0 && completed === total },
    ]),
  );
}
