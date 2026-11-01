// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  EditableText,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  renderAsync,
} from "@jeswr/suite-ui";
import { Inbox, ListTodo } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { classifyError } from "../../lib/model/errors";
import { projectGroups } from "../../lib/views/project-groups";
import { focusAddTask } from "../../state/add-focus";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { TaskList } from "../task-list";

export function ProjectView({
  projectUrl,
  inbox = false,
}: {
  projectUrl?: string | undefined;
  inbox?: boolean;
}) {
  const tasks = useTasks();
  const { preferences } = useTasksPreferences();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const url = inbox ? tasks.inboxUrl : projectUrl;
  const project = tasks.projects.find((project) => project.url === url);
  const load = url ? tasks.tasks[url] : undefined;
  const title = inbox ? "Inbox" : (project?.tracker.title ?? "Project");
  useEffect(() => {
    if (project) void tasks.cache.loadTasks(project);
  }, [project, tasks.cache]);
  useEffect(() => {
    document.title = `${title} · Tasks · Solid Suite`;
  }, [title]);
  const add = params.get("add");
  useEffect(() => {
    if (add !== "1" || load?.status !== "ready") return;
    if (focusAddTask()) {
      const query = new URLSearchParams(params.toString());
      query.delete("add");
      router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
    }
  }, [add, load?.status, params, pathname, router]);
  const groups = projectGroups(
    tasks.views.filter((task) => task.projectUrl === url),
    project?.tracker.sections ?? [],
    preferences.sort[pathname] ?? "manual",
    preferences.showCompletedInProject,
  );
  const empty =
    !groups.unsectioned.length && !groups.sections.some((section) => section.rows.length);
  const list = project ? (
    <TaskList project={project} groups={groups} hideAddTaskTrigger={empty} />
  ) : null;
  // Keep TaskList at the same React position when the empty state disappears;
  // the first Enter must leave the add input open and focused.
  const content = (
    <>
      {empty && (
        <EmptyState
          icon={
            inbox ? (
              <Inbox size={24} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ListTodo size={24} strokeWidth={1.5} aria-hidden="true" />
            )
          }
          title={inbox ? "Your Inbox is empty" : "No tasks yet"}
          body={
            inbox
              ? "Add anything you need to do. Press q anywhere to add a task."
              : `Add the first task to ${title}`
          }
          primaryAction={
            <Button className="tsk-empty-add" onClick={() => focusAddTask()}>
              Add task
            </Button>
          }
        />
      )}
      {list}
    </>
  );
  return (
    <div className="tsk-content">
      <header className="tsk-view-header">
        <h1>
          {!inbox && project ? (
            <EditableText
              label="Project name"
              value={title}
              validate={(value) => (value.trim() ? undefined : "A name is required")}
              onCommit={(value) => {
                void tasks.renameProject(project, value);
              }}
            />
          ) : (
            title
          )}
        </h1>
      </header>
      {renderAsync({
        loading:
          tasks.status === "loading" ||
          (project && (!load || (load.status === "loading" && !load.items.length))) ? (
            <LoadingSkeleton preset="list" count={8} />
          ) : undefined,
        error:
          !project && tasks.status === "ready" ? (
            <ErrorState error="not-found" />
          ) : load?.status === "error" ? (
            <ErrorState
              error={classifyError(load.error)}
              actions={{
                retry: () => {
                  if (project) void tasks.cache.loadTasks(project, true);
                },
              }}
            >
              {classifyError(load.error) === "forbidden" && (
                <p>You no longer have access to {title}</p>
              )}
            </ErrorState>
          ) : undefined,
        empty: project && empty ? content : undefined,
        children: content,
      })}
    </div>
  );
}
