// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, LoadingSkeleton, renderAsync } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { flatRows } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
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
}: {
  title: string;
  rows: readonly TaskView[];
  emptyTitle: string;
  emptyBody: string;
  emptyIcon: ReactNode;
}) {
  const tasks = useTasks();
  const router = useRouter();
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
        <h1>{title}</h1>
      </header>
      {failures.map(([url, load]) => {
        const title =
          tasks.projects.find((project) => project.url === url)?.tracker.title ?? "Project";
        return (
          <section key={url} aria-label={title}>
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
            {!loading && !rows.length && !failures.length ? (
              <EmptyState
                icon={emptyIcon}
                title={emptyTitle}
                body={emptyBody}
                primaryAction={
                  title === "Today" ? (
                    <Button onClick={() => router.push("/tasks/inbox?add=1")}>Add task</Button>
                  ) : undefined
                }
              />
            ) : null}
            <TaskList rows={flatRows(rows, tasks.views)} showProject />
          </>
        ),
      })}
    </div>
  );
}
