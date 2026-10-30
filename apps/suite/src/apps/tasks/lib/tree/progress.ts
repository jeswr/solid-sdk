// AUTHORED-BY Codex GPT-6.1-Sol
import type { TreeProgress, TreeTask } from "./types";
import { descendants, getTask, readForest, requireInput } from "./validation";

/** Count children by default, or every descendant explicitly. The parent is excluded. */
export function getProgress(
  tasks: readonly TreeTask[],
  id: string,
  scope: "children" | "descendants" = "children",
): TreeProgress {
  const forest = readForest(tasks);
  getTask(forest, id);
  requireInput(scope === "children" || scope === "descendants", "Unknown progress scope");
  const group = scope === "children" ? (forest.children.get(id) ?? []) : descendants(forest, id);
  const completed = group.filter((task) => task.state === "completed").length;
  const total = group.length;
  return {
    completed,
    open: total - completed,
    total,
    allCompleted: total > 0 && completed === total,
  };
}
