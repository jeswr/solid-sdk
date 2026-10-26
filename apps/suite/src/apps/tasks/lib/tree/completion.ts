// AUTHORED-BY Codex GPT-6.1-Sol
import type { CompletionOptions, TreeTask } from "./types";
import { descendants, getTask, readForest, requireInput } from "./validation";

/**
 * Change projected states only; persistence/recurrence/timestamps belong to the data layer.
 * Both propagation policies default off. Reopening never changes children or ancestors.
 * Upward completion considers all direct children along the edited task's ancestor chain.
 */
export function setTaskCompletion<T extends TreeTask>(
  tasks: readonly T[],
  id: string,
  state: TreeTask["state"],
  options: CompletionOptions = {},
): T[] {
  const forest = readForest(tasks);
  const task = getTask(forest, id);
  requireInput(state === "open" || state === "completed", "Unknown completion state");
  requireInput(
    options !== null &&
      typeof options === "object" &&
      Object.getPrototypeOf(options) === Object.prototype,
    "Expected completion options",
  );
  requireInput(
    Reflect.ownKeys(options).every(
      (key) =>
        (key === "completeDescendants" || key === "completeAncestors") &&
        typeof options[key] === "boolean",
    ),
    "Unknown option or nonboolean propagation policy",
  );
  requireInput(state === "completed" || !options.completeDescendants, "Cannot cascade reopening");
  const states = new Map<string, TreeTask["state"]>([[id, state]]);
  if (options.completeDescendants) {
    for (const child of descendants(forest, id)) states.set(child.id, "completed");
  }
  if (state === "completed" && options.completeAncestors) {
    let parentId = task.parentId;
    while (parentId !== undefined) {
      const children = forest.children.get(parentId) as T[];
      if (!children.every((child) => (states.get(child.id) ?? child.state) === "completed")) break;
      states.set(parentId, "completed");
      parentId = getTask(forest, parentId).parentId;
    }
  }
  return tasks.map((item) => {
    const next = states.get(item.id);
    return next === undefined || next === item.state ? item : { ...item, state: next };
  });
}
