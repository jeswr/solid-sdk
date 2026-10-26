// AUTHORED-BY Codex GPT-6.1-Sol
import {
  DAY,
  dayOf,
  dueLocal,
  localTime,
  range,
  readContext,
  record,
  requireInput,
  validateDue,
} from "./calendar";
import type { ListContext, ListTask } from "./types";

export type SmartList = "today" | "upcoming" | "overdue" | "no-date" | "completed";

export function validateTask(task: ListTask): void {
  record(task);
  requireInput(typeof task.id === "string" && task.id.trim().length > 0, "Task ID is required");
  requireInput(task.state === "open" || task.state === "completed", "Unknown task state");
  if (task.due !== undefined) validateDue(task.due);
}

/** Today includes overdue; Upcoming spans today through today + 6 local dates. */
export function filterSmartList<T extends ListTask>(
  tasks: readonly T[],
  list: SmartList,
  context: ListContext,
): T[] {
  requireInput(Array.isArray(tasks), "Expected a task array");
  requireInput(
    ["today", "upcoming", "overdue", "no-date", "completed"].includes(list),
    "Unknown smart list",
  );
  const { now, format } = readContext(context);
  const today = dayOf(range(localTime(now, format)));
  return Array.from(tasks).filter((task) => {
    validateTask(task);
    if (list === "completed") return task.state === "completed";
    if (task.state === "completed") return false;
    if (list === "no-date") return task.due === undefined;
    if (task.due === undefined) return false;
    const date = dayOf(dueLocal(task.due, format));
    if (list === "today") return date <= today;
    if (list === "upcoming") return date >= today && date < today + 7 * DAY;
    return task.due.kind === "all-day" ? date < today : Date.parse(task.due.at) < now;
  });
}
