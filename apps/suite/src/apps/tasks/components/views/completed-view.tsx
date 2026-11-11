// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, FilterChips } from "@jeswr/suite-ui";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { type CompletedGroup, completedGroups } from "../../lib/views/completed";
import { useNow } from "../../state/clock";
import { useTasks } from "../../state/tasks-context";
import { DeleteCompletedButton } from "../delete-completed";
import { CrossProjectView } from "./cross-project-view";
import { ViewGroup } from "./view-group";

export function CompletedView() {
  const tasks = useTasks();
  const now = useNow();
  const [projectUrl, setProjectUrl] = useState<string>();
  const [page, setPage] = useState(0);
  const project = tasks.projects.find((item) => item.url === projectUrl);
  const groups: CompletedGroup[] = [];
  let hasMore = false;
  for (let index = 0; index <= page; index++) {
    const result = completedGroups(
      tasks.views,
      { ...(projectUrl ? { projectUrl } : {}), page: index },
      now,
    );
    hasMore = result.hasMore;
    for (const group of result.groups) {
      const previous = groups.at(-1);
      if (previous && previous.dayKey === group.dayKey) previous.tasks.push(...group.tasks);
      else groups.push({ ...group, tasks: [...group.tasks] });
    }
  }
  const rows = groups.flatMap((group) => group.tasks);
  const count = tasks.views.filter(
    (task) => task.state === "closed" && (!projectUrl || task.projectUrl === projectUrl),
  ).length;
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
      }
    >
      {groups.map((group) => (
        <ViewGroup key={group.dayKey ?? "earlier"} title={group.label} rows={group.tasks} />
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
