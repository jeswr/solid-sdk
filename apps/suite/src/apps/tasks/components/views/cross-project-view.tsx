// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, renderAsync } from "@jeswr/suite-ui";
import { type ReactNode, useEffect } from "react";
import { classifyError } from "../../lib/model/errors";
import { flatRows } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
import { openAddTask } from "../../state/add-focus";
import { useTasks } from "../../state/tasks-context";
import { TaskList } from "../task-list";
/** Shared state handling; smart-view bodies stay in their own replaceable files. */
export function CrossProjectView({
  title,
  rows,
  emptyTitle,
  emptyBody,
  emptyIcon,
}: {
  title: string;
  rows: readonly TaskView[];
  emptyTitle: string;
  emptyBody: string;
  emptyIcon: ReactNode;
}) {
  const tasks = useTasks();
  useEffect(() => {
    document.title = `${title} · Tasks · Solid Suite`;
  }, [title]);
  const failures = tasks.projects.filter((project) => tasks.tasks[project.url]?.status === "error");
  const loading =
    tasks.status === "loading" ||
    tasks.projects.some(
      (project) => !tasks.tasks[project.url] || tasks.tasks[project.url]?.status === "loading",
    );
  return (
    <div className="tsk-content">
      <header className="tsk-view-header">
        <h1>{title}</h1>
      </header>
      {failures.map((project) => (
        <section key={project.url} aria-label={project.tracker.title}>
          <p>{project.tracker.title}</p>
          <ErrorState
            error={classifyError(tasks.tasks[project.url]?.error)}
            actions={{
              retry: () => {
                void tasks.cache.loadTasks(project, true);
              },
            }}
          />
        </section>
      ))}
      {renderAsync({
        loading:
          loading && rows.length === 0 ? <LoadingSkeleton preset="list" count={8} /> : undefined,
        empty:
          !loading && !rows.length && !failures.length ? (
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              body={emptyBody}
              primaryAction={
                title === "Today" ? (
                  <Button onClick={() => openAddTask()}>Add task</Button>
                ) : undefined
              }
            />
          ) : undefined,
        children: <TaskList rows={flatRows(rows, tasks.views)} showProject />,
      })}
    </div>
  );
}
