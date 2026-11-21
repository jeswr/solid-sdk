// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, FilterChips } from "@jeswr/suite-ui";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { completedGroups } from "../../lib/views/completed";
import { filterDateRange } from "../../lib/views/date-ranges";
import { groupTasks } from "../../lib/views/grouping";
import { compareTasks } from "../../lib/views/project-groups";
import { useNow } from "../../state/clock";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { DeleteCompletedButton } from "../delete-completed";
import { CrossProjectView } from "./cross-project-view";
import { DateRangeControl, useTaskDateRange } from "./date-range-control";
import { ViewGroup } from "./view-group";

export function CompletedView() {
  const tasks = useTasks();
  const now = useNow();
  const viewId = useRoutePathname();
  const { preferences } = useTasksPreferences();
  const mode = preferences.groupBy[viewId] ?? "none";
  const sort = preferences.sort[viewId];
  const [projectUrl, setProjectUrl] = useState<string>();
  const { range, change } = useTaskDateRange("completed", now);
  const [pagination, setPagination] = useState({ page: 0, from: range.from, to: range.to });
  const page = pagination.from === range.from && pagination.to === range.to ? pagination.page : 0;
  const setPage = (page: number) => setPagination({ page, from: range.from, to: range.to });
  const ranged = filterDateRange(tasks.views, range, "completed").filter(
    (task) => !projectUrl || task.projectUrl === projectUrl,
  );
  const project = tasks.projects.find((item) => item.url === projectUrl);
  const completionGroups = completedGroups(ranged, {}, now).groups;
  const allGroups =
    mode === "none"
      ? completionGroups.map((group) => ({
          id: group.dayKey ?? "earlier",
          title: group.label,
          tasks: sort ? [...group.tasks].sort(compareTasks(sort)) : group.tasks,
        }))
      : groupTasks(
          completionGroups.flatMap((group) => group.tasks),
          mode,
          {
            now,
            weekStart: preferences.weekStart,
            labels: new Map(
              tasks.projects.flatMap((project) =>
                project.tracker.labels.map((label) => [label.id, label.name]),
              ),
            ),
          },
          sort,
        );
  let remaining = (page + 1) * 50;
  const groups = allGroups.flatMap((group) => {
    const visible = group.tasks.slice(0, remaining);
    remaining -= visible.length;
    return visible.length ? [{ ...group, tasks: visible }] : [];
  });
  const rows = groups.flatMap((group) => group.tasks);
  const count = ranged.length;
  const hasMore = rows.length < count;
  return (
    <CrossProjectView
      title="Completed"
      rows={rows}
      count={count}
      emptyTitle="Nothing completed yet"
      emptyBody="Completed tasks will show up here"
      emptyIcon={<CircleCheck size={24} strokeWidth={1.5} aria-hidden="true" />}
      actions={project && <DeleteCompletedButton project={project} />}
      toolbar={
        <>
          <DateRangeControl kind="completed" now={now} range={range} onChange={change} />
          <FilterChips
            label="Filter by project"
            options={[
              { id: "all", label: "All projects" },
              ...tasks.projects.map((project) => ({
                id: project.url,
                label: project.tracker.title ?? "Project",
              })),
            ]}
            value={[projectUrl ?? "all"]}
            resultCount={count}
            onChange={(value) => {
              const next = value.at(-1);
              setProjectUrl(next && next !== "all" ? next : undefined);
              setPage(0);
            }}
          />
        </>
      }
    >
      {mode !== "none" && (
        <p className="tsk-date-subtitle">
          Manual reordering is unavailable while tasks are grouped.
        </p>
      )}
      {groups.map((group) => (
        <ViewGroup
          key={`${mode}:${group.id}`}
          title={group.title}
          rows={group.tasks}
          collapsible={mode !== "none"}
        />
      ))}
      {hasMore && (
        <Button
          type="button"
          className="tsk-show-more"
          variant="outline"
          onClick={() => setPage(page + 1)}
        >
          Show more
        </Button>
      )}
    </CrossProjectView>
  );
}
