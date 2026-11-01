// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredTask } from "../model/store";
import { planCompletion, type TaskDetails, taskDetails } from "../model/task";
import { shortDayLabel } from "./days";
import type { TaskView } from "./types";

export type CompletionPlan =
  | { kind: "close" }
  | {
      kind: "advance";
      next: Date;
      copy: TaskDetails;
      /** Resource reserved by the cache; retries and Undo keep the same identity. */
      copyUrl?: string;
      original: TaskDetails;
      /** Detached pre-write snapshot retained across optimistic writes for Undo. */
      previous: TaskDetails;
    };

export function planComplete(
  stored: StoredTask,
  siblings: readonly TaskView[],
  now: Date,
  { forever = false }: { forever?: boolean } = {},
): CompletionPlan {
  const data = taskDetails(stored.url, stored.dataset);
  if (!data) throw new TypeError("Expected a wf:Task.");
  const completedCopies = siblings.filter(
    (item) => item.state === "closed" && item.derivedFrom === stored.task.id,
  ).length;
  const plan = planCompletion(data, stored.task.id, now, completedCopies, forever);
  if (!plan.copy) return { kind: "close" };
  return {
    kind: "advance",
    next: plan.original.dueDate as Date,
    copy: plan.copy,
    original: plan.original,
    previous: structuredClone(data),
  };
}

export type UndoPlan =
  | { kind: "reopen"; original: { state: "open"; endedAt: undefined } }
  | {
      kind: "restore";
      /** Delete the resource allocated by the caller for CompletionPlan.copy. */
      deleteCopy: true;
      original: { [Key in "dueDate" | "allDay" | "reminders"]: TaskDetails[Key] };
    };

export function planUndo(plan: CompletionPlan): UndoPlan {
  if (plan.kind === "close")
    return { kind: "reopen", original: { state: "open", endedAt: undefined } };
  const { dueDate, allDay, reminders } = structuredClone(plan.previous);
  return { kind: "restore", deleteCopy: true, original: { dueDate, allDay, reminders } };
}

export function toastCopy(plan: CompletionPlan, view: TaskView): string {
  return plan.kind === "close"
    ? `Completed '${view.title}'`
    : `Completed · next: ${shortDayLabel(plan.next)}`;
}
