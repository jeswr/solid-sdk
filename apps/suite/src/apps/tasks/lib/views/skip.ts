// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredTask } from "../model/store";
import { planCompletion, type TaskDetails, type TaskItem, taskDetails } from "../model/task";
import { shortDayLabel } from "./days";
import type { TaskView } from "./types";

export interface SkipPlan {
  kind: "advance" | "close";
  original: TaskDetails;
  previous: TaskDetails;
}

/** Use the completion calendar/bounds, but never persist its history copy or spend COUNT. */
export function planSkip(
  stored: StoredTask,
  siblings: readonly TaskView[],
  now: Date,
): SkipPlan | undefined {
  const previous = taskDetails(stored.url, stored.dataset);
  if (!previous) throw new TypeError("Expected a wf:Task.");
  if (previous.state === "closed" || !previous.recurrence) return;
  const completed = siblings.filter(
    (task) => task.state === "closed" && task.derivedFrom === stored.task.id,
  ).length;
  const plan = planCompletion(previous, stored.task.id, now, completed);
  return {
    kind: plan.copy ? "advance" : "close",
    original: structuredClone(plan.original),
    previous: structuredClone(previous),
  };
}

export function applySkip(task: TaskItem, data: TaskDetails): void {
  task.dueDate = data.dueDate;
  task.allDay = data.allDay;
  task.reminders = data.reminders ?? [];
  task.state = data.state;
  task.endedAt = data.endedAt;
}

/** Scheduling ownership for Undo/Retry; unrelated title/priority edits may still proceed. */
export function skipMatches(task: TaskItem, data: TaskDetails): boolean {
  // Blank-node reminder identities are derived from their trigger and change when shifted.
  const triggers = (reminders: TaskDetails["reminders"]) =>
    (reminders ?? []).map(({ offset, time }) => offset ?? (time as Date).toISOString()).sort();
  return (
    JSON.stringify([
      task.dueDate,
      task.allDay,
      triggers(task.reminders),
      task.state,
      task.endedAt,
    ]) ===
    JSON.stringify([data.dueDate, data.allDay, triggers(data.reminders), data.state, data.endedAt])
  );
}

export function skipToastCopy(plan: SkipPlan): string {
  return plan.kind === "close"
    ? "Series ended"
    : `Skipped to ${shortDayLabel(plan.original.dueDate as Date)}`;
}
