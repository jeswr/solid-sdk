// AUTHORED-BY Codex GPT-6
import { toast } from "@jeswr/suite-ui";
import type { TaskView } from "../lib/views/types";
import type { TasksContextValue } from "./tasks-context";
/** Completion and deletion seams for TSK-06's undo-aware actions. */
export async function completeTask(view: TaskView, tasks: TasksContextValue): Promise<void> {
  const stored = tasks.tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (!stored) return;
  const result = await tasks.updateTask(stored, (task) => {
    task.state = "closed";
  });
  if (result) toast.success(`Completed '${view.title}'`);
}
export async function deleteTask(view: TaskView, tasks: TasksContextValue): Promise<void> {
  const stored = tasks.tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (stored && (await tasks.deleteTask(stored))) toast.success(`Deleted '${view.title}'`);
}
