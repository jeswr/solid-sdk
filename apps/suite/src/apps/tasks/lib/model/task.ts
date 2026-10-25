// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildTask,
  parseTask,
  Task,
  type TaskData,
  type TaskPriority,
} from "@jeswr/solid-task-model/task";
import type { DatasetCore } from "@rdfjs/types";
import {
  DataFactory,
  NS,
  node,
  requireDate,
  requireHttp,
  requireTitle,
  SCHED,
  SCHEMA,
  type Store,
} from "./rdf";
import { nextOccurrence, type RecurrenceRule, readRecurrence, writeRecurrence } from "./recurrence";
import { type Reminder, readReminders, shiftReminders, writeReminders } from "./reminders";

export interface TaskDetails extends Omit<TaskData, "rank" | "priority"> {
  rank?: number | undefined;
  priority?: TaskPriority | undefined;
  allDay?: string | undefined;
  categoryTypes?: string[] | undefined;
  recurrence?: RecurrenceRule | undefined;
  reminders?: Reminder[] | undefined;
}
export class TaskItem extends Task {
  private get extra() {
    return node(this.id, this.dataset);
  }
  get allDay(): string | undefined {
    const text = this.extra.text(`${SCHED}dueTime`);
    return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  }
  set allDay(value: string | undefined) {
    this.extra.setTyped(`${SCHED}dueTime`, value, `${NS.XSD}date`);
  }
  override get rank() {
    return this.extra.number(`${SCHEMA}position`);
  }
  override set rank(value: number | undefined) {
    this.extra.setNumber(`${SCHEMA}position`, value);
  }
  override get priority(): TaskPriority | undefined {
    const value = this.extra.text(`${SCHEMA}priority`)?.toLowerCase().trim();
    return value === "high" || value === "medium" || value === "low" ? value : undefined;
  }
  override set priority(value: TaskPriority | undefined) {
    this.extra.setText(`${SCHEMA}priority`, value);
  }
  get recurrence() {
    return readRecurrence(this.extra);
  }
  set recurrence(value: RecurrenceRule | undefined) {
    writeRecurrence(this.extra, value);
  }
  get reminders() {
    return readReminders(this.extra);
  }
  set reminders(value: Reminder[]) {
    writeReminders(this.extra, value, this.dueDate);
  }
}
export function validateTask(data: TaskDetails): void {
  requireTitle(data.title);
  for (const field of [data.created, data.modified, data.endedAt, data.dueDate])
    if (field) requireDate(field);
  for (const iri of [
    data.creator,
    data.assignee,
    data.project,
    data.parent,
    data.clonedFrom,
    data.duplicateOf,
    ...(data.categoryTypes ?? []),
    ...(data.blockedBy ?? []),
    ...(data.relatesTo ?? []),
  ])
    if (iri !== undefined) requireHttp(iri);
  if (data.rank !== undefined && !Number.isFinite(data.rank))
    throw new TypeError("Invalid position.");
  if (data.priority !== undefined && !["high", "medium", "low"].includes(data.priority))
    throw new TypeError("Invalid priority.");
  if (
    data.allDay !== undefined &&
    (!data.dueDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.allDay) ||
      new Date(`${data.allDay}T00:00:00Z`).toISOString().slice(0, 10) !== data.allDay)
  )
    throw new TypeError("Invalid all-day due date.");
}
export function createTask(url: string, data: TaskDetails): Store {
  validateTask(data);
  const { rank, priority, ...base } = data;
  const dataset = buildTask(url, base);
  const task = new TaskItem(`${url}#it`, dataset, DataFactory);
  task.rank = rank;
  task.priority = priority;
  for (const type of data.categoryTypes ?? []) task.types.add(type);
  task.allDay = data.allDay;
  task.recurrence = data.recurrence;
  task.reminders = data.reminders ?? [];
  return dataset;
}
/** Project shared fields through the existing model, then read app extensions. */
export function taskDetails(url: string, dataset: DatasetCore): TaskDetails | undefined {
  const data = parseTask(url, dataset);
  if (!data) return undefined;
  const task = new TaskItem(`${url}#it`, dataset, DataFactory);
  return {
    ...data,
    rank: task.rank,
    priority: task.priority,
    allDay: task.allDay,
    categoryTypes: [...task.types].filter(
      (type) => ![`${NS.WF}Task`, `${NS.WF}Open`, `${NS.WF}Closed`].includes(type),
    ),
    recurrence: task.recurrence,
    reminders: task.reminders,
  };
}
/** Pure §5.5 plan. The store/hook applies both conditional writes and retains its undo snapshot. */
export function planCompletion(
  data: TaskDetails,
  originalId: string,
  now: Date,
  completedCopies = 0,
  forever = false,
): { original: TaskDetails; copy?: TaskDetails } {
  requireDate(now);
  const close = (): { original: TaskDetails } => ({
    original: { ...data, state: "closed", endedAt: now, modified: now },
  });
  if (forever || data.state === "closed" || !data.recurrence) return close();
  if (!Number.isSafeInteger(completedCopies) || completedCopies < 0)
    throw new TypeError("Invalid completed-copy count.");
  const rule = data.recurrence;
  if (rule.count !== undefined && completedCopies + 1 >= rule.count) return close();
  const due = data.dueDate ?? now;
  // Count is measured through closed copies, rather than restarting count at each advanced due date.
  const next = nextOccurrence({ ...rule, count: undefined }, due, due);
  if (!next) return close();
  const allDay =
    data.allDay === undefined
      ? undefined
      : `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  const copy: TaskDetails = {
    ...data,
    state: "closed",
    endedAt: now,
    modified: now,
    clonedFrom: originalId,
    recurrence: undefined,
    reminders: [],
  };
  const original: TaskDetails = {
    ...data,
    dueDate: next,
    allDay,
    modified: now,
    reminders: shiftReminders(data.reminders ?? [], next.getTime() - due.getTime()),
  };
  return { original, copy };
}
export function subtaskProgress(
  parentId: string,
  tasks: readonly TaskDetails[],
): { completed: number; total: number } {
  const children = tasks.filter((task) => task.parent === parentId);
  return {
    completed: children.filter((task) => task.state === "closed").length,
    total: children.length,
  };
}
/** Mean-neighbour ordering; caller renumbers its section when needsRenumber is true. */
export function positionBetween(
  before?: number,
  after?: number,
): { position: number; needsRenumber: boolean } {
  const position =
    before === undefined
      ? (after ?? 1) - 1
      : after === undefined
        ? before + 1
        : (before + after) / 2;
  return {
    position,
    needsRenumber: before !== undefined && after !== undefined && after - before < 1e-6,
  };
}
