// AUTHORED-BY Claude Opus 5.5
"use client";
import { useSyncExternalStore } from "react";
import type { TaskView } from "../lib/views/types";
import { completeTask } from "../state/actions";
import { completionVisuals } from "../state/completion-visuals";
import { useTasks } from "../state/tasks-context";
import { reopenTask } from "../state/view-actions";

/** Whether the task is mid-completion (the check fills, then the row fades). */
export function useCompleting(task: TaskView) {
  const tasks = useTasks();
  const visuals = completionVisuals(tasks.cache);
  return useSyncExternalStore(visuals.subscribe, visuals.getSnapshot, visuals.getSnapshot).has(
    task.url,
  );
}

/** The completion circle shared by list rows and board cards: complete with Undo, or reopen. */
export function TaskCheck({
  task,
  pending,
  completing,
  tabIndex = -1,
}: {
  task: TaskView;
  pending: boolean;
  completing: boolean;
  tabIndex?: number;
}) {
  const tasks = useTasks();
  return (
    <label className="tsk-check-target">
      <input
        className="tsk-check"
        data-priority={task.priority}
        type="checkbox"
        tabIndex={tabIndex}
        checked={task.state === "closed" || completing}
        disabled={pending || completing}
        aria-label={`${task.state === "closed" ? "Reopen" : "Complete"} '${task.title}'`}
        onChange={() => {
          void (task.state === "closed"
            ? reopenTask(task, tasks)
            : completeTask(task, tasks, { animate: true }));
        }}
      />
    </label>
  );
}
