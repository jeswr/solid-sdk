// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRRule } from "@jeswr/suite-ui/date-time/model";
import { fromEditorRule, recurrenceAnchor } from "../detail/recurrence-map";
import { type RecurrenceRule, toRRule } from "../model/recurrence";
import type { TaskDetails } from "../model/task";
import { priorityValue, type TaskView } from "../views/types";
import { toTaskData, type VTodoCalendar, VTodoError, type VTodoTask } from "../vtodo";

const seconds = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);
export interface CalendarSource {
  view: TaskView;
  recurrence?: RecurrenceRule | undefined;
}

/** Clock and label names are explicit inputs; task subjects are the stable calendar UIDs. */
export function toCalendar(
  sources: readonly CalendarSource[],
  labels: ReadonlyMap<string, string>,
  now: Date,
): VTodoCalendar {
  return {
    productId: "-//Solid Suite//Tasks//EN",
    tasks: sources.map(({ view, recurrence }) => {
      const due = view.allDay
        ? { kind: "date" as const, value: view.allDay }
        : view.due
          ? { kind: "utc" as const, value: seconds(view.due) }
          : undefined;
      // VTODO requires DTSTART before DUE. Tasks has no start field: use the smallest
      // representable duration, retaining DUE as the Tasks recurrence anchor on import.
      const start = recurrence
        ? due?.kind === "date"
          ? {
              kind: "date" as const,
              value: new Date(Date.parse(due.value) - 86400000).toISOString().slice(0, 10),
            }
          : {
              kind: "utc" as const,
              value: due ? new Date(due.value.getTime() - 1000) : seconds(now),
            }
        : undefined;
      return {
        uid: view.id,
        stamp: seconds(now),
        title: view.title,
        state: view.state,
        status: view.state === "closed" ? "COMPLETED" : "NEEDS-ACTION",
        ...(view.description !== undefined ? { description: view.description } : {}),
        ...(view.completedAt ? { endedAt: seconds(view.completedAt) } : {}),
        ...(due ? { due } : {}),
        ...(start ? { start } : {}),
        ...(view.priority < 4
          ? { priority: priorityValue(view.priority) as "high" | "medium" | "low" }
          : {}),
        ...(view.parentId ? { parentUid: view.parentId } : {}),
        categories: view.labelIds.map((id) => {
          const name = labels.get(id);
          if (name === undefined) throw new VTodoError("invalid-value");
          return name;
        }),
        ...(recurrence ? { rrule: toRRule(recurrence) } : {}),
      };
    }),
  };
}

/** Never interpret a calendar UID as an IRI. The caller supplies resolved parent resources. */
export function calendarTaskData(
  todo: VTodoTask,
  resourceIds: ReadonlyMap<string, string>,
  allDayDueInstant?: Date,
): TaskDetails {
  const { task, dueDay } = toTaskData(todo, {
    resourceIds,
    ...(allDayDueInstant ? { allDayDueInstant } : {}),
  });
  let recurrence: RecurrenceRule | undefined;
  if (todo.rrule) {
    try {
      recurrence = fromEditorRule(
        fromRRule(todo.rrule.toUpperCase()),
        recurrenceAnchor(task.dueDate ?? todo.stamp, dueDay),
      );
    } catch {
      throw new VTodoError("invalid-value");
    }
  }
  return { ...task, allDay: dueDay, recurrence, calendarUid: todo.uid };
}

/** Validate the whole dependency graph before writing; independent tasks share a level. */
export function importLevels(
  calendar: VTodoCalendar,
  existing: ReadonlyMap<string, string>,
): { levels: VTodoTask[][]; skipped: number } {
  const pending = new Map(
    calendar.tasks.filter((task) => !existing.has(task.uid)).map((task) => [task.uid, task]),
  );
  const skipped = calendar.tasks.length - pending.size;
  const known = new Set(existing.keys());
  const levels: VTodoTask[][] = [];
  while (pending.size) {
    const level = [...pending.values()].filter(
      (task) => !task.parentUid || known.has(task.parentUid),
    );
    if (!level.length) throw new VTodoError("unresolved-parent");
    levels.push(level);
    for (const task of level) {
      pending.delete(task.uid);
      known.add(task.uid);
    }
  }
  return { levels, skipped };
}

const messages = {
  "invalid-input": "Choose a calendar (.ics) file.",
  "invalid-syntax": "This file isn't a valid task calendar.",
  "unsupported-component": "This calendar contains unsupported items.",
  "unsupported-property": "This calendar contains unsupported task details.",
  "unsupported-parameter": "This calendar uses an unsupported date or option.",
  "invalid-value": "A task has an invalid or unsupported value.",
  duplicate: "This calendar contains duplicate task details or IDs.",
  "missing-required": "A task is missing required details.",
  "unresolved-parent": "Include each parent task and remove circular sub-tasks.",
} as const;
export function calendarError(error: unknown): string {
  return error instanceof VTodoError
    ? messages[error.code]
    : "Couldn't finish the calendar exchange. Try again.";
}
