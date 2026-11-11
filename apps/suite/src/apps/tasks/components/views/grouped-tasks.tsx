// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { ReactNode } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { groupTasks } from "../../lib/views/grouping";
import type { SortMode } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { ViewGroup } from "./view-group";

export function GroupedTasks({
  rows,
  children,
  showProject = true,
  defaultSort,
}: {
  rows: readonly TaskView[];
  children: ReactNode;
  showProject?: boolean;
  defaultSort?: SortMode;
}) {
  const viewId = useRoutePathname();
  const { preferences } = useTasksPreferences();
  const { projects } = useTasks();
  const now = useNow();
  const mode = preferences.groupBy[viewId] ?? "none";
  if (mode === "none") return children;
  const groups = groupTasks(
    rows,
    mode,
    {
      now,
      weekStart: preferences.weekStart,
      labels: new Map(
        projects.flatMap((project) =>
          project.tracker.labels.map((label) => [label.id, label.name]),
        ),
      ),
    },
    preferences.sort[viewId] ?? defaultSort,
  );
  return (
    <>
      <p className="tsk-date-subtitle">Manual reordering is unavailable while tasks are grouped.</p>
      {groups.map((group) => (
        <ViewGroup
          key={`${mode}:${group.id}`}
          title={group.title}
          rows={group.tasks}
          collapsible
          showProject={showProject}
        />
      ))}
    </>
  );
}
