// AUTHORED-BY Codex GPT-6.1-Sol
import { readContext, requireInput } from "./calendar";
import { validateTask } from "./filters";
import { nextOccurrence, type RepeatContext } from "./repeat";
import type { ListTask } from "./types";

export interface CompletionOptions extends RepeatContext {
  /** Caller allocates a new identity, without performing I/O in this library. */
  readonly occurrenceId?: string;
}

export interface CompletionPlan<T extends ListTask> {
  readonly task: Omit<T, "state" | "due" | "completedAt" | "modifiedAt"> &
    Pick<ListTask, "state" | "due" | "completedAt" | "modifiedAt">;
  readonly completedOccurrence?: Omit<
    T,
    "recurrence" | "id" | "state" | "completedAt" | "modifiedAt" | "derivedFrom"
  > & {
    readonly id: string;
    readonly state: "completed";
    readonly completedAt: string;
    readonly modifiedAt: string;
    readonly derivedFrom: string;
  };
}

/**
 * Plan §5.5's two writes: advance the open original and close a non-recurring copy.
 * The caller persists the plan conditionally and retains its old snapshot for undo.
 * Ordinary/exhausted tasks close directly. Subtasks are never changed by this plan.
 */
export function completeTask<T extends ListTask>(
  task: T,
  options: CompletionOptions,
): CompletionPlan<T> {
  validateTask(task);
  requireInput(
    task.state === "open" && task.completedAt === undefined,
    "Only open tasks without a completion timestamp can be completed",
  );
  const { now } = readContext(options);
  const timestamp = new Date(now).toISOString();
  // Capture the injected clock once, even if it is advancing between calls.
  const due =
    task.recurrence === undefined
      ? undefined
      : nextOccurrence(task.due, task.recurrence, { ...options, clock: () => new Date(now) });
  if (due === undefined) {
    return { task: { ...task, state: "completed", completedAt: timestamp, modifiedAt: timestamp } };
  }
  requireInput(
    typeof options.occurrenceId === "string" &&
      options.occurrenceId.trim().length > 0 &&
      options.occurrenceId !== task.id,
    "Repeating completion requires a distinct occurrence ID",
  );
  const {
    recurrence: _recurrence,
    id: _id,
    state: _state,
    completedAt: _completedAt,
    modifiedAt: _modifiedAt,
    derivedFrom: _derivedFrom,
    ...snapshot
  } = task;
  return {
    task: { ...task, due, modifiedAt: timestamp },
    completedOccurrence: {
      ...snapshot,
      id: options.occurrenceId,
      state: "completed",
      completedAt: timestamp,
      modifiedAt: timestamp,
      derivedFrom: task.id,
    },
  };
}
