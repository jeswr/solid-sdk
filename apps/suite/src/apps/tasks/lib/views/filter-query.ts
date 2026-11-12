// AUTHORED-BY Codex GPT-6.1-Sol
import { requireHttp } from "../model/rdf";
import { addDays, localDayKey } from "./days";
import { type LabelProject, labelUnion } from "./labels";
import { taskDayKey } from "./today";
import type { PriorityLevel, TaskView } from "./types";

export type FilterDue = "overdue" | "today" | "next7" | "none" | "any";
export interface FilterQuery {
  v: 1;
  projects?: string[];
  labels?: string[];
  priorities?: PriorityLevel[];
  due?: FilterDue;
  assignedToMe?: boolean;
  text?: string;
  includeCompleted?: boolean;
}
const fields = new Set([
  "v",
  "projects",
  "labels",
  "priorities",
  "due",
  "assignedToMe",
  "text",
  "includeCompleted",
]);
const dueValues = ["overdue", "today", "next7", "none", "any"];

/** Stored pod data is untrusted. Unsupported versions and malformed queries are skipped. */
export function parseFilterQuery(payload: string): FilterQuery | undefined {
  try {
    const value = JSON.parse(payload);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      value.v !== 1 ||
      Object.keys(value).some((key) => !fields.has(key))
    )
      return undefined;
    for (const key of ["projects", "labels", "priorities"] as const) {
      if (!(key in value)) continue;
      const items = value[key];
      if (!Array.isArray(items)) return undefined;
      for (const item of items) {
        if (key === "priorities") {
          if (![1, 2, 3, 4].includes(item)) return undefined;
        } else {
          if (typeof item !== "string" || !item.trim()) return undefined;
          if (key === "projects") requireHttp(item);
        }
      }
    }
    if ("due" in value && !dueValues.includes(value.due)) return undefined;
    if ("text" in value && typeof value.text !== "string") return undefined;
    for (const key of ["assignedToMe", "includeCompleted"])
      if (key in value && typeof value[key] !== "boolean") return undefined;
    return value as FilterQuery;
  } catch {
    return undefined;
  }
}

export function serializeFilterQuery(query: FilterQuery): string {
  const payload = JSON.stringify(query);
  if (!parseFilterQuery(payload)) throw new TypeError("Invalid filter query.");
  return payload;
}

export interface SavedFilter {
  iri: string;
  name: string;
  query: FilterQuery;
}
export function savedFilters(
  views: readonly { iri: string; name: string; payload: string }[],
): SavedFilter[] {
  return views.flatMap(({ iri, name, payload }) => {
    const query = parseFilterQuery(payload);
    return query ? [{ iri, name, query }] : [];
  });
}

/** AND across fields, OR within each list. Next 7 days includes today through day + 6. */
export function filterTasks(
  tasks: readonly TaskView[],
  query: FilterQuery,
  projects: readonly LabelProject[],
  now: Date,
  webId: string,
): TaskView[] {
  const today = localDayKey(now);
  const end = localDayKey(addDays(now, 7));
  const labels = labelUnion(projects, tasks).filter((label) =>
    query.labels?.some((name) => name.toLowerCase() === label.key),
  );
  return tasks.filter((task) => {
    if (!query.includeCompleted && task.state === "closed") return false;
    if (query.projects?.length && !query.projects.includes(task.projectUrl)) return false;
    if (query.priorities?.length && !query.priorities.includes(task.priority)) return false;
    if (query.assignedToMe && task.assignee !== webId) return false;
    if (
      query.text &&
      !`${task.title}\n${task.description ?? ""}`.toLowerCase().includes(query.text.toLowerCase())
    )
      return false;
    if (
      query.labels?.length &&
      !labels.some((label) =>
        label.members.some(
          (member) =>
            member.projectUrl === task.projectUrl && task.labelIds.includes(member.labelId),
        ),
      )
    )
      return false;
    const day = taskDayKey(task);
    switch (query.due) {
      case "none":
        return day === undefined;
      case "overdue":
        return day !== undefined && day < today;
      case "today":
        return day === today;
      case "next7":
        return day !== undefined && day >= today && day < end;
      default:
        return true;
    }
  });
}
