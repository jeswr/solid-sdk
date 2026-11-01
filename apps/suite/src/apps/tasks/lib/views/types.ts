// AUTHORED-BY Claude Opus 5.5
/**
 * The UI-facing projection of one stored task (06-tasks §2). Every view
 * helper and component reads this shape, never the RDF wrappers, so grouping,
 * sorting and formatting stay pure and testable. Mutations still go through
 * `TaskStore` with the original `StoredTask`, addressed by `url`.
 */

import type { StoredProject, StoredTask } from "../model/store";

/** P1 is the most urgent; P4 means no `schema:priority` (06-tasks §4.7). */
export type PriorityLevel = 1 | 2 | 3 | 4;

export interface TaskView {
  /** The task resource (document) URL, the key for mutations and `?task=`. */
  readonly url: string;
  /** The task subject IRI (`<url>#it`), as used by `dct:isPartOf`. */
  readonly id: string;
  /** The tracker document URL of the owning project. */
  readonly projectUrl: string;
  readonly projectTitle: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly state: "open" | "closed";
  readonly due?: Date | undefined;
  /** `yyyy-mm-dd` when the task is all-day (an `xsd:date` `sched:dueTime`). */
  readonly allDay?: string | undefined;
  readonly priority: PriorityLevel;
  /** `schema:position`; lower sorts first, absent sorts last. */
  readonly position?: number | undefined;
  /** The section class IRI, when the task carries one of the tracker's sections. */
  readonly sectionId?: string | undefined;
  /** Label class IRIs carried by the task (tracker-local). */
  readonly labelIds: readonly string[];
  /** The parent task subject IRI for sub-tasks. */
  readonly parentId?: string | undefined;
  readonly assignee?: string | undefined;
  readonly recurring: boolean;
  readonly hasReminders: boolean;
  readonly created?: Date | undefined;
  readonly completedAt?: Date | undefined;
  /** `prov:wasDerivedFrom`: set on closed copies of a recurring task. */
  readonly derivedFrom?: string | undefined;
}

const PRIORITY: Record<string, PriorityLevel> = { high: 1, medium: 2, low: 3 };

/** `schema:priority` value for a level; P4 is written as no triple. */
export function priorityValue(level: PriorityLevel): "high" | "medium" | "low" | undefined {
  return level === 1 ? "high" : level === 2 ? "medium" : level === 3 ? "low" : undefined;
}

/** Project a stored task through its project's tracker into the view shape. */
export function toTaskView(stored: StoredTask, project: StoredProject): TaskView {
  const task = stored.task;
  const sections = new Set(project.tracker.sections.map((section) => section.id));
  const labels = new Set(project.tracker.labels.map((label) => label.id));
  const types = [...task.types];
  return {
    url: stored.url,
    id: task.id,
    projectUrl: project.url,
    projectTitle: project.tracker.title ?? "",
    title: task.title ?? "",
    description: task.description,
    state: task.state === "closed" ? "closed" : "open",
    due: task.dueDate,
    allDay: task.allDay,
    priority: (task.priority && PRIORITY[task.priority]) || 4,
    position: task.rank,
    sectionId: types.find((type) => sections.has(type)),
    labelIds: types.filter((type) => labels.has(type)),
    parentId: task.parent,
    assignee: task.assignee,
    recurring: task.recurrence !== undefined,
    hasReminders: task.reminders.length > 0,
    created: task.created,
    completedAt: task.endedAt,
    derivedFrom: task.clonedFrom,
  };
}
