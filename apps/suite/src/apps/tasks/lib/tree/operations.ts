// AUTHORED-BY Codex GPT-6.1-Sol
import { generateKeyBetween } from "../../../../lib/order";
import { type ReparentedTask, TaskTreeError, type TreeTask } from "./types";
import { descendants, type Forest, getTask, readForest, requireInput } from "./validation";

function relocate<T extends TreeTask>(
  tasks: readonly T[],
  forest: Forest<T>,
  task: T,
  parentId: string | undefined,
  index: number,
): ReparentedTask<T>[] {
  let parent = parentId === undefined ? undefined : getTask(forest, parentId);
  while (parent !== undefined) {
    if (parent.id === task.id)
      throw new TaskTreeError("cycle", "Cannot move a task into its subtree");
    parent = parent.parentId === undefined ? undefined : getTask(forest, parent.parentId);
  }
  const siblings = (forest.children.get(parentId) ?? []).filter((item) => item.id !== task.id);
  requireInput(
    Number.isSafeInteger(index) && index >= 0 && index <= siblings.length,
    "Expected a post-removal destination sibling index",
  );
  const previous = siblings[index - 1]?.orderKey ?? null;
  const next = siblings[index]?.orderKey ?? null;
  if (
    task.parentId === parentId &&
    (previous === null || previous < task.orderKey) &&
    (next === null || task.orderKey < next)
  ) {
    return [...tasks];
  }
  const { parentId: _previousParent, orderKey: _previousKey, ...rest } = task;
  const moved: ReparentedTask<T> = {
    ...rest,
    ...(parentId === undefined ? {} : { parentId }),
    orderKey: generateKeyBetween(previous, next),
  };
  return tasks.map((item) => (item.id === task.id ? moved : item));
}

/** Move a whole subtree; index addresses sorted destination siblings after removing the task. */
export function moveTask<T extends TreeTask>(
  tasks: readonly T[],
  id: string,
  parentId: string | undefined,
  index: number,
): ReparentedTask<T>[] {
  const forest = readForest(tasks);
  return relocate(tasks, forest, getTask(forest, id), parentId, index);
}

/** Append under the preceding sibling. First siblings cannot be indented. */
export function indentTask<T extends TreeTask>(
  tasks: readonly T[],
  id: string,
): ReparentedTask<T>[] {
  const forest = readForest(tasks);
  const task = getTask(forest, id);
  const siblings = forest.children.get(task.parentId) as T[];
  const parent = siblings[siblings.indexOf(task) - 1];
  if (parent === undefined) throw new TaskTreeError("invalid-operation", "No preceding sibling");
  return relocate(tasks, forest, task, parent.id, forest.children.get(parent.id)?.length ?? 0);
}

/** Promote after the former parent, retaining every descendant's parent link and order key. */
export function outdentTask<T extends TreeTask>(
  tasks: readonly T[],
  id: string,
): ReparentedTask<T>[] {
  const forest = readForest(tasks);
  const task = getTask(forest, id);
  if (task.parentId === undefined)
    throw new TaskTreeError("invalid-operation", "Root cannot be outdented");
  const parent = getTask(forest, task.parentId);
  const siblings = forest.children.get(parent.parentId) as T[];
  return relocate(tasks, forest, task, parent.parentId, siblings.indexOf(parent) + 1);
}

/** Remove exactly the task and all of its descendants, without changing completion states. */
export function deleteSubtree<T extends TreeTask>(tasks: readonly T[], id: string): T[] {
  const forest = readForest(tasks);
  getTask(forest, id);
  const removed = new Set([id, ...descendants(forest, id).map((task) => task.id)]);
  return tasks.filter((task) => !removed.has(task.id));
}
