// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRRule } from "@jeswr/suite-ui/date-time/model";
import { fromEditorRule, recurrenceAnchor } from "../detail/recurrence-map";
import { humanise, type RecurrenceRule, weekdays } from "../model/recurrence";
import type { TaskDetails } from "../model/task";
import { priorityValue, type TaskView } from "../views/types";
import {
  toTaskData,
  type VTodoCalendar,
  type VTodoDate,
  VTodoError,
  type VTodoTask,
} from "../vtodo";

const seconds = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);
export interface CalendarSource {
  view: TaskView;
  recurrence?: RecurrenceRule | undefined;
}

function matchesAnchor(rule: RecurrenceRule, anchor: Date): boolean {
  return (
    (!rule.byDay ||
      rule.byDay.includes(weekdays[(anchor.getDay() + 6) % 7] as (typeof weekdays)[number])) &&
    (rule.byMonthDay === undefined || rule.byMonthDay === anchor.getDate())
  );
}
function appendDescription(description: string | undefined, rule: string): string {
  return description ? `${description}\n\n${rule}` : rule;
}
function importRule(todo: VTodoTask): RecurrenceRule | undefined {
  // DUE must be later than DTSTART in VTODO. A duration would shift the series' anchor.
  if (!todo.rrule || todo.start?.kind !== "date" || todo.due) return;
  try {
    const parsed = fromRRule(todo.rrule.toUpperCase());
    if (parsed.until && parsed.until.length !== 10) return;
    const anchor = new Date(`${todo.start.value}T00:00:00`);
    const rule = fromEditorRule(parsed, anchor) as RecurrenceRule;
    if (
      matchesAnchor(rule, anchor) &&
      (parsed.until === undefined || parsed.until >= todo.start.value)
    )
      return rule;
  } catch {
    // Preserve unsupported rules as description text, with a preview warning.
  }
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
      // Recurrence needs DTSTART equal to DUE; the exchange library rejects equal dates.
      const description = recurrence
        ? appendDescription(
            view.description,
            humanise(recurrence, recurrenceAnchor(view.due ?? now, view.allDay)),
          )
        : view.description;
      return {
        uid: view.id,
        stamp: seconds(now),
        title: view.title,
        state: view.state,
        status: view.state === "closed" ? "COMPLETED" : "NEEDS-ACTION",
        ...(description !== undefined ? { description } : {}),
        ...(view.completedAt ? { endedAt: seconds(view.completedAt) } : {}),
        ...(due ? { due } : {}),
        ...(view.priority < 4
          ? { priority: priorityValue(view.priority) as "high" | "medium" | "low" }
          : {}),
        ...(view.parentId ? { parentUid: view.parentId } : {}),
        categories: view.labelIds.map((id) => {
          const name = labels.get(id);
          if (name === undefined) throw new VTodoError("invalid-value");
          return name;
        }),
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
  const context = { resourceIds, ...(allDayDueInstant ? { allDayDueInstant } : {}) };
  // Validate the original DTO before mapping a DTSTART-only series to the Tasks due field.
  const mapped = toTaskData(todo, context);
  const { start, rrule, ...fields } = todo;
  const { task, dueDay } =
    rrule && !todo.due ? toTaskData({ ...fields, due: start as VTodoDate }, context) : mapped;
  const recurrence = importRule(todo);
  return {
    ...task,
    allDay: dueDay,
    recurrence,
    calendarUid: todo.uid,
    ...(todo.rrule && !recurrence
      ? { description: appendDescription(task.description, `RRULE:${todo.rrule}`) }
      : {}),
  };
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
