// AUTHORED-BY Codex GPT-6
import { toast } from "@jeswr/suite-ui";
import { type CompletionPlan, planComplete, toastCopy } from "../lib/views/completion";
import type { TaskView } from "../lib/views/types";
import type { TasksContextValue } from "./tasks-context";
/** Completion and deletion seams for TSK-06's undo-aware actions. */
export async function completeTask(
  view: TaskView,
  tasks: TasksContextValue,
): Promise<CompletionPlan | undefined> {
  const stored = tasks.tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (!stored) return;
  const now = new Date();
  const plan = planComplete(stored, tasks.views, now);
  const result =
    plan.kind === "advance"
      ? await tasks.cache.advanceTask(stored, plan)
      : await tasks.updateTask(stored, (task) => {
          task.state = "closed";
          task.endedAt = now;
        });
  if (result) {
    toast.success(toastCopy(plan, view));
    return plan;
  }
}
export async function deleteTask(view: TaskView, tasks: TasksContextValue): Promise<void> {
  const stored = tasks.tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (stored && (await tasks.deleteTask(stored))) toast.success(`Deleted '${view.title}'`);
}
