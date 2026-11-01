// AUTHORED-BY Codex GPT-6
import { toast } from "@jeswr/suite-ui";
import { type CompletionPlan, planComplete, toastCopy } from "../lib/views/completion";
import type { TaskView } from "../lib/views/types";
import { completionVisuals } from "./completion-visuals";
import { DelayedDeletes, UNDO_WINDOW } from "./delayed-delete";
import type { TasksCache } from "./tasks-cache";
import type { TasksContextValue } from "./tasks-context";

export { reopenTask } from "./view-actions";

const completing = new WeakMap<TasksCache, Map<string, Promise<CompletionPlan | undefined>>>();
export function completeTask(
  view: TaskView,
  tasks: TasksContextValue,
  options: { forever?: boolean; animate?: boolean } = {},
): Promise<CompletionPlan | undefined> {
  let operations = completing.get(tasks.cache);
  if (!operations) {
    operations = new Map();
    completing.set(tasks.cache, operations);
  }
  const existing = operations.get(view.url);
  if (existing) return existing;
  const run = async () => {
    const stored = tasks.cache
      .getSnapshot()
      .tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
    if (!stored) return;
    const now = new Date();
    const planned = planComplete(
      stored,
      tasks.cache.getSnapshot().views.filter((task) => task.projectUrl === view.projectUrl),
      now,
      options,
    );
    if (planned.kind === "close" && options.animate)
      await completionVisuals(tasks.cache).wait(view.url);
    const result = await tasks.cache.completeTask(stored, now, options);
    if (result) {
      toast.success(toastCopy(result, view), {
        duration: UNDO_WINDOW,
        action: {
          label: "Undo",
          onClick: () => {
            void tasks.cache.undoCompletion(stored, result);
          },
        },
      });
      return result;
    }
  };
  const running = run().finally(() => operations.delete(view.url));
  operations.set(view.url, running);
  return running;
}

const controllers = new WeakMap<TasksCache, DelayedDeletes>();
export function pendingDeletes(cache: TasksCache): DelayedDeletes {
  let controller = controllers.get(cache);
  if (!controller) {
    controller = new DelayedDeletes();
    controllers.set(cache, controller);
  }
  return controller;
}
export async function deleteTask(view: TaskView, tasks: TasksContextValue): Promise<void> {
  const stored = tasks.cache
    .getSnapshot()
    .tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (!stored) return;
  const deletes = pendingDeletes(tasks.cache);
  if (
    !deletes.schedule(
      view.url,
      () => tasks.cache.hideTask(view.url, true),
      () => {
        // Unhide only after the cache has installed its optimistic remove transform.
        const deleting = tasks.cache.deleteTask(stored);
        tasks.cache.hideTask(view.url, false);
        void deleting;
      },
      () => tasks.cache.hideTask(view.url, false),
    )
  )
    return;
  toast.success(`Deleted '${view.title}'`, {
    duration: UNDO_WINDOW,
    action: {
      label: "Undo",
      onClick: () => {
        deletes.undo(view.url);
      },
    },
    onDismiss: () => deletes.finish(view.url),
    onAutoClose: () => deletes.finish(view.url),
  });
}
