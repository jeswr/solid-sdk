// AUTHORED-BY Codex GPT-6.1-Sol
import type { Category } from "../model/tracker";
import type { TaskView } from "../views/types";

export type BoardGrouping = "none" | "priority" | "assignee" | "label";
export interface Swimlane {
  readonly group: Exclude<BoardGrouping, "none">;
  readonly value: string;
}
export const LABEL_LANE_MESSAGE =
  "Tasks cannot be moved between Label rows. Change the task's labels instead.";
export function laneFor(task: TaskView, group: Exclude<BoardGrouping, "none">): Swimlane {
  return {
    group,
    value:
      group === "priority"
        ? String(task.priority)
        : group === "assignee"
          ? (task.assignee ?? "")
          : (task.labelIds[0] ?? ""),
  };
}
export function inLane(task: TaskView, lane: Swimlane): boolean {
  return laneFor(task, lane.group).value === lane.value;
}
export function boardLanes(
  tasks: readonly TaskView[],
  group: BoardGrouping,
  labels: readonly Category[] = [],
  members: readonly string[] = [],
) {
  if (group === "none") return [{ lane: undefined, name: "", tasks }];
  const choices =
    group === "priority"
      ? [1, 2, 3, 4].map((level) => ({ value: String(level), name: `P${level}` }))
      : group === "assignee"
        ? [
            { value: "", name: "Unassigned" },
            ...[
              ...new Set([
                ...members,
                ...tasks.flatMap((task) => (task.assignee ? [task.assignee] : [])),
              ]),
            ]
              .sort()
              .map((value) => ({ value, name: value })),
          ]
        : [
            { value: "", name: "No label" },
            ...labels.map((label) => ({ value: label.id, name: label.name })),
          ];
  return choices.map(({ value, name }) => {
    const lane: Swimlane = { group, value };
    return { lane, name, tasks: tasks.filter((task) => inLane(task, lane)) };
  });
}
