// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, LoadingSkeleton, renderAsync } from "@jeswr/suite-ui";
import { type ReactNode, useEffect } from "react";
import { flatRows } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
import { openAddTask } from "../../state/add-focus";
import { useTasks } from "../../state/tasks-context";
import { TaskList } from "../task-list";
import { ProjectError } from "./project-error";
/** Shared state handling; smart-view bodies stay in their own replaceable files. */
export function CrossProjectView({
  title,
  rows,
  emptyTitle,
  emptyBody,
  emptyIcon,
  subtitle,
  actions,
  toolbar,
  children,
  emptyAction,
  count = rows.length,
}: {
  title: string;
  rows: readonly TaskView[];
  emptyTitle: string;
  emptyBody?: string;
  emptyIcon: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
  emptyAction?: ReactNode;
  count?: number;
}) {
  const tasks = useTasks();
  useEffect(() => {
    document.title = `${title} · Tasks · Solid Suite`;
  }, [title]);
  const failures = Object.entries(tasks.tasks).filter(([, load]) => load.status === "error");
  const loading =
    tasks.status === "loading" ||
    tasks.projects.some(
      (project) => !tasks.tasks[project.url] || tasks.tasks[project.url]?.status === "loading",
    );
  return (
    <div className="tsk-content">
      <header className="tsk-view-header">
        <div className="tsk-heading-line">
          <h1>{title}</h1>
          <span className="tsk-count">
            {count}
            <span className="tsk-sr-only"> tasks</span>
          </span>
          {actions}
        </div>
        {subtitle && <p className="tsk-date-subtitle">{subtitle}</p>}
      </header>
      {toolbar}
      {failures.map(([url, load]) => {
        const title =
          tasks.projects.find((project) => project.url === url)?.tracker.title ?? "Project";
        return (
          <section key={url} aria-label={title} className="tsk-project-error">
            <p>{title}</p>
            <ProjectError
              error={load.error}
              retry={() => {
                void tasks.cache.retryProject(url);
              }}
            />
          </section>
        );
      })}
      {renderAsync({
        loading:
          loading && rows.length === 0 ? <LoadingSkeleton preset="list" count={8} /> : undefined,
        children: (
          <>
            {!loading && !rows.length && !failures.length && emptyTitle ? (
              <EmptyState
                icon={emptyIcon}
                title={emptyTitle}
                body={emptyBody}
                primaryAction={
                  emptyAction ??
                  (title === "Today" ? (
                    <Button onClick={() => openAddTask()}>Add task</Button>
                  ) : undefined)
                }
              />
            ) : null}
            {children ?? <TaskList rows={flatRows(rows, tasks.views)} showProject />}
          </>
        ),
      })}
    </div>
  );
}
