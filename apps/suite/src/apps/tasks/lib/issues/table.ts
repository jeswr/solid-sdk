// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredProject, StoredTask } from "../model/store";
import { type TaskView, toTaskView } from "../views/types";

export interface IssueRow {
  view: TaskView;
  updated?: Date | undefined;
  labels: string;
}
export interface IssueFilters {
  state: "open" | "closed" | "all";
  assignee: "anyone" | "me" | "unassigned";
  label: string;
  text: string;
}
export type IssueColumn =
  | "title"
  | "state"
  | "priority"
  | "labels"
  | "assignee"
  | "created"
  | "updated";
export const issueColumns: IssueColumn[] = [
  "title",
  "state",
  "priority",
  "labels",
  "assignee",
  "created",
  "updated",
];
export function issueRow(item: StoredTask, project: StoredProject): IssueRow {
  const view = toTaskView(item, project);
  return {
    view,
    updated: item.task.modified,
    labels: project.tracker.labels
      .filter((label) => view.labelIds.includes(label.id))
      .map((label) => label.name)
      .join(", "),
  };
}
export function issueTable(
  rows: readonly IssueRow[],
  filters: IssueFilters,
  webId: string,
  sort: IssueColumn,
  descending = false,
): IssueRow[] {
  const text = filters.text.trim().toLocaleLowerCase("en-GB");
  const value = (row: IssueRow) =>
    sort === "updated"
      ? (row.updated?.getTime() ?? 0)
      : sort === "created"
        ? (row.view.created?.getTime() ?? 0)
        : sort === "labels"
          ? row.labels
          : (row.view[sort] ?? "");
  return rows
    .filter(
      ({ view, labels }) =>
        (filters.state === "all" || view.state === filters.state) &&
        (filters.assignee === "anyone" ||
          (filters.assignee === "me" ? view.assignee === webId : !view.assignee)) &&
        (!filters.label || view.labelIds.includes(filters.label)) &&
        `${view.title} ${view.description ?? ""} ${labels}`
          .toLocaleLowerCase("en-GB")
          .includes(text),
    )
    .sort((a, b) => {
      const left = value(a),
        right = value(b);
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "en-GB");
      return (descending ? -compared : compared) || a.view.url.localeCompare(b.view.url);
    });
}
