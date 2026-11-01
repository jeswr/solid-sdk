// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { requireValue } from "./content-lines";
import { utcValue } from "./dates";
import type { TaskDataProjection, VTodoTask } from "./types";
import { validateTask } from "./validation";

export interface TaskMappingContext {
  readonly resourceIds?: ReadonlyMap<string, string>;
  /** Caller supplies the account-zone midnight for an all-day due date. */
  readonly allDayDueInstant?: Date;
}

/**
 * Project shared TaskData fields without minting IRIs or assuming a time zone.
 * Keep the VTodoTask alongside this projection for lossless export. dueDay is the
 * sched:dueTime xsd:date marker (§5.3); recurrence/start/progress stay in the exchange DTO.
 */
export function toTaskData(
  todo: VTodoTask,
  context: TaskMappingContext = {},
): {
  readonly task: TaskDataProjection;
  readonly dueDay?: string;
} {
  validateTask(todo);
  type Draft = { -readonly [K in keyof TaskDataProjection]: TaskDataProjection[K] };
  const task: Draft = { title: todo.title, state: todo.state };
  if (todo.description !== undefined) task.description = todo.description;
  if (todo.endedAt !== undefined) task.endedAt = new Date(todo.endedAt);
  if (todo.priority !== undefined) task.priority = todo.priority;
  if (todo.parentUid !== undefined) {
    const parent = context.resourceIds?.get(todo.parentUid);
    requireValue(
      typeof parent === "string" && /^https?:\/\/[^\s<>"{}|^`\\]+$/u.test(parent),
      "unresolved-parent",
    );
    let url: URL;
    try {
      url = new URL(parent);
    } catch {
      requireValue(false, "unresolved-parent");
    }
    requireValue(url.hostname.length > 0 && !url.username && !url.password, "unresolved-parent");
    task.parent = parent;
  }
  if (todo.due?.kind === "utc") task.dueDate = new Date(todo.due.value);
  if (todo.due?.kind === "date") {
    utcValue(context.allDayDueInstant);
    task.dueDate = new Date(context.allDayDueInstant);
    return { task, dueDay: todo.due.value };
  }
  return { task };
}
