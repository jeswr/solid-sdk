// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { isIssuesProject } from "../../lib/issues/model";
import { IssuesTaskStore } from "../../lib/issues/store";
import type { TaskView } from "../../lib/views/types";
import { useTasks } from "../../state/tasks-context";

/** Shared rows and cards use the same document permission as issue detail. */
export function useIssueAccess(task: TaskView) {
  const tasks = useTasks();
  const project = tasks.projects.find((project) => project.url === task.projectUrl);
  const item = tasks.tasks[task.projectUrl]?.items.find((item) => item.url === task.url);
  const issue = Boolean(project && isIssuesProject(project));
  return {
    issue,
    readOnly: Boolean(
      issue &&
        project &&
        item &&
        tasks.cache.store instanceof IssuesTaskStore &&
        !tasks.cache.store.canEdit(project, item),
    ),
  };
}
