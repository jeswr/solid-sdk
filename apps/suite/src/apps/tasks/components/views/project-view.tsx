// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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
import { useRoutePathname } from "@/lib/route-params";
import { classifyError } from "../../lib/model/errors";
import { replaceQuery } from "../../lib/route/replace-query";
import { projectGroups } from "../../lib/views/project-groups";
import { focusAddTask } from "../../state/add-focus";
import { TaskListFocus } from "../../state/list-focus";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { AddTaskRow } from "../add-task-row";
import { BulkToolbar } from "../bulk-toolbar";
import { LabelFilterBar } from "../label-filter-bar";
import { ProjectDot } from "../project-dot";
import { TaskList } from "../task-list";
import { projectHref, useViewMode } from "../view-toggle";
import { GroupedTasks } from "./grouped-tasks";
import { ProjectError } from "./project-error";

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
  // The sort key matches the menu, which keys views by the slash-free route.
  const viewId = useRoutePathname();
  const params = useSearchParams();
  const router = useRouter();
  const url = inbox ? tasks.inboxUrl : projectUrl;
  const project = tasks.projects.find((project) => project.url === url);
  const load = url ? tasks.tasks[url] : undefined;
  const title = inbox
    ? "Inbox"
    : (project?.tracker.title ??
      preferences.sharedProjects.find((shared) => shared.url === url)?.title ??
      "Project");
  useEffect(() => {
    if (project) void tasks.cache.loadTasks(project);
  }, [project, tasks.cache]);
  useEffect(() => {
    document.title = `${title} · Tasks · Solid Suite`;
  }, [title]);
  // A project opens in its persisted layout (06-tasks §2.5); the Inbox is always a list.
  const viewMode = useViewMode(inbox ? undefined : url);
  useEffect(() => {
    if (url && viewMode.mode === "board") router.replace(projectHref(url, "board"));
  }, [url, viewMode.mode, router]);
  const add = params.get("add");
  useEffect(() => {
    if (add !== "1" || load?.status !== "ready") return;
    if (focusAddTask()) {
      const query = new URLSearchParams(params.toString());
      query.delete("add");
      replaceQuery(pathname, query);
    }
  }, [add, load?.status, params, pathname]);
  const groups = projectGroups(
    tasks.views.filter((task) => task.projectUrl === url),
    project?.tracker.sections ?? [],
    preferences.sort[viewId] ?? "manual",
    preferences.showCompletedInProject,
  );
  const empty =
    !groups.unsectioned.length && !groups.sections.some((section) => section.rows.length);
  const list = project ? (
    <>
      {preferences.groupBy[viewId] && preferences.groupBy[viewId] !== "none" && (
        <AddTaskRow project={project} />
      )}
      <GroupedTasks
        rows={tasks.views.filter(
          (task) =>
            task.projectUrl === url &&
            (preferences.showCompletedInProject || task.state === "open"),
        )}
        showProject={false}
        defaultSort="manual"
      >
        <TaskList project={project} groups={groups} hideAddTaskTrigger={empty} />
      </GroupedTasks>
    </>
  ) : null;
  // Keep TaskList at the same React position when the empty state disappears;
  // the first Enter must leave the add input open and focused.
  const content = (
    <>
      {empty && (
        <div className="tsk-project-empty">
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
        </div>
      )}
      {list}
    </>
  );
  return (
    <TaskListFocus className="tsk-content">
      <header className="tsk-view-header">
        <h1>
          {!inbox && project && <ProjectDot colour={project.tracker.color} />}
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
      <LabelFilterBar projectUrl={url} />
      <BulkToolbar />
      {renderAsync({
        loading:
          tasks.status === "loading" || load?.status === "loading" || (project && !load) ? (
            <LoadingSkeleton preset="list" count={8} />
          ) : undefined,
        error:
          load?.status === "error" ? (
            <ProjectError
              error={load.error}
              retry={() => {
                if (url) void tasks.cache.retryProject(url);
              }}
            >
              {classifyError(load.error) === "forbidden" && (
                <>
                  <p>You no longer have access to {title}</p>
                  <p>Ask the owner to share this project</p>
                </>
              )}
            </ProjectError>
          ) : !project && tasks.status === "ready" ? (
            <ErrorState error="not-found" />
          ) : undefined,
        empty: project && empty ? content : undefined,
        children: content,
      })}
    </TaskListFocus>
  );
}
