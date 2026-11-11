// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { Filter } from "lucide-react";
import { filterTasks, savedFilters } from "../../lib/views/filter-query";
import { useNow } from "../../state/clock";
import { useTasks } from "../../state/tasks-context";
import { CrossProjectView } from "./cross-project-view";
import { ProjectError } from "./project-error";

export function FilterView({ slug }: { slug: string }) {
  const tasks = useTasks();
  const now = useNow();
  const inbox = tasks.projects.find((project) => project.url === tasks.inboxUrl);
  const filter = savedFilters(inbox?.tracker.savedViews ?? []).find(
    (filter) => filter.iri === `${tasks.inboxUrl}#view-${slug}`,
  );
  if (!filter)
    return (
      <div className="tsk-content">
        <h1>Filters</h1>
        {tasks.status === "loading" ? (
          <LoadingSkeleton preset="list" />
        ) : tasks.tasks[tasks.inboxUrl]?.error ? (
          <ProjectError
            error={tasks.tasks[tasks.inboxUrl]?.error}
            retry={() => {
              void tasks.cache.retryProject(tasks.inboxUrl);
            }}
          />
        ) : (
          <ErrorState error="not-found" />
        )}
      </div>
    );
  const projects = tasks.projects.map((project) => ({
    url: project.url,
    title: project.tracker.title ?? "Project",
    labels: project.tracker.labels,
  }));
  const rows = filterTasks(tasks.views, filter.query, projects, now, tasks.webId);
  return (
    <CrossProjectView
      title={filter.name}
      rows={rows}
      emptyTitle="No tasks match this filter"
      emptyIcon={<Filter size={24} aria-hidden="true" />}
    />
  );
}
