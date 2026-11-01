// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { DataFactory, NS, node, requireTitle } from "../lib/model/rdf";
import type { StoredProject } from "../lib/model/store";
import { runBulk } from "../lib/views/bulk";
import type { TaskView } from "../lib/views/types";
import { rescheduleToDay } from "../lib/views/upcoming";
import type { TasksContextValue } from "./tasks-context";

function storedTask(view: TaskView, tasks: TasksContextValue) {
  const stored = tasks.tasks[view.projectUrl]?.items.find((item) => item.url === view.url);
  if (!stored) throw new Error(`Couldn't find '${view.title}'`);
  return stored;
}

/** Cache mutations resolve undefined on rollback; bulk writes must count that as a failure. */
function saved<T>(result: T | undefined): T {
  if (!result) throw new Error("Couldn't save your changes");
  return result;
}

export async function rescheduleTasks(
  views: readonly TaskView[],
  dayKey: string,
  tasks: TasksContextValue,
) {
  const result = await runBulk(views, async (view) => {
    const due = rescheduleToDay(view, dayKey);
    saved(
      await tasks.updateTask(storedTask(view, tasks), (task) => {
        task.dueDate = due.due;
        task.allDay = due.allDay;
      }),
    );
  });
  toast.success(`Rescheduled ${result.done.length} tasks`);
  return result;
}

export async function reopenTask(view: TaskView, tasks: TasksContextValue): Promise<void> {
  const result = await tasks.updateTask(storedTask(view, tasks), (task) => {
    task.state = "open";
    task.endedAt = undefined;
  });
  if (result) toast.success("Reopened");
}

/** Retain every tracker-local identity, including multiple spellings in one tracker. */
export function labelTargets(key: string, projects: readonly StoredProject[]) {
  return projects.flatMap((project) => {
    const labelIds = project.tracker.labels
      .filter((label) => label.name.toLowerCase() === key.toLowerCase())
      .map((label) => label.id);
    return labelIds.length ? [{ project, labelIds }] : [];
  });
}

export async function renameLabel(key: string, name: string, tasks: TasksContextValue) {
  requireTitle(name);
  return runBulk(labelTargets(key, tasks.projects), async ({ project, labelIds }) => {
    saved(
      await tasks.updateProject(project, (tracker) => {
        for (const id of labelIds)
          node(id, tracker.dataset).setText(`${NS.RDFS}label`, name.trim());
      }),
    );
  });
}

/** At most four projects write at once. Clear all task references before removing a class. */
export async function deleteLabel(key: string, tasks: TasksContextValue) {
  const targets = labelTargets(key, tasks.projects);
  // Check the entire operation before its first write: skipped tasks can retain the label type.
  const incomplete = targets.filter(({ project }) => {
    const load = tasks.tasks[project.url];
    return load?.status !== "ready" || (load.warningCount ?? 0) > 0;
  });
  if (incomplete.length) {
    const error = new Error(
      `Couldn't delete @${key}. Reload all tasks in ${incomplete.map(({ project }) => project.tracker.title ?? "Project").join(", ")} and fix any loading errors before deleting the label.`,
    );
    toast.error(error.message);
    return { done: [], failed: incomplete.map((item) => ({ item, error })) };
  }
  return runBulk(targets, async ({ project, labelIds }) => {
    const load = tasks.tasks[project.url];
    if (!load) throw new Error("Load this project's tasks before deleting its label");
    const failed: string[] = [];
    for (const item of load.items.filter((item) =>
      labelIds.some((id) => item.task.types.has(id)),
    )) {
      const result = await tasks.updateTask(item, (task) => {
        for (const id of labelIds) task.types.delete(id);
      });
      if (!result) failed.push(item.task.title ?? item.url);
    }
    if (failed.length) throw new Error(`Couldn't remove the label from: ${failed.join(", ")}`);
    saved(
      await tasks.updateProject(project, (tracker) => {
        for (const id of labelIds)
          for (const quad of tracker.dataset.match(DataFactory.namedNode(id)))
            tracker.dataset.delete(quad);
      }),
    );
  });
}
