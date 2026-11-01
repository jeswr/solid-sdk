// AUTHORED-BY Claude Opus 5.5
import { toast } from "@jeswr/suite-ui";
import type { StoredProject, StoredTask } from "../lib/model/store";
import { type BulkResult, bulkSummary, runBulk } from "../lib/views/bulk";
import type { CompletionPlan } from "../lib/views/completion";
import { type PriorityLevel, priorityValue, type TaskView } from "../lib/views/types";
import { rescheduleToDay } from "../lib/views/upcoming";
import { pendingDeletes } from "./actions";
import { UNDO_WINDOW } from "./delayed-delete";
import type { TasksContextValue } from "./tasks-context";

/** The context surface bulk writes need; `TasksContextValue` satisfies it. */
export type BulkTasks = Pick<
  TasksContextValue,
  "cache" | "updateTask" | "moveTaskToProject" | "ensureLabels"
>;

function stored(view: TaskView, tasks: BulkTasks): StoredTask {
  const item = tasks.cache
    .getSnapshot()
    .tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
  if (!item) throw new Error(`Couldn't find '${view.title}'`);
  return item;
}

/** Cache mutations resolve undefined after a rollback; count that as a failure. */
function saved<T>(result: T | undefined): T {
  if (!result) throw new Error("Couldn't save your changes");
  return result;
}

/**
 * Run one write per task, at most four in flight (06-tasks §4.5), then show a
 * single summary toast: "Completed 5 tasks", or "Completed 4 of 5 — 1 failed"
 * listing the failures with Retry for exactly those tasks.
 */
export async function bulkWrite(
  action: string,
  views: readonly TaskView[],
  tasks: BulkTasks,
  write: (view: TaskView, item: StoredTask) => Promise<unknown>,
  undo?: () => void,
): Promise<BulkResult<TaskView>> {
  const result = await runBulk(views, (view) => write(view, stored(view, tasks)), {
    concurrency: 4,
  });
  const message = bulkSummary(action, result.done.length, result.failed.length);
  if (result.failed.length)
    toast.error(message, {
      description: `Failed: ${result.failed.map(({ item }) => item.title).join(", ")}`,
      action: {
        label: "Retry",
        onClick: () => {
          void bulkWrite(
            action,
            result.failed.map(({ item }) => item),
            tasks,
            write,
          );
        },
      },
    });
  else
    toast.success(
      message,
      undo && result.done.length
        ? { duration: UNDO_WINDOW, action: { label: "Undo", onClick: undo } }
        : undefined,
    );
  return result;
}

export function completeTasks(views: readonly TaskView[], tasks: BulkTasks) {
  const completed: { item: StoredTask; plan: CompletionPlan }[] = [];
  const now = new Date();
  return bulkWrite(
    "Completed",
    views.filter((view) => view.state === "open"),
    tasks,
    async (_view, item) => {
      completed.push({ item, plan: saved(await tasks.cache.completeTask(item, now)) });
    },
    () => {
      for (const { item, plan } of completed) void tasks.cache.undoCompletion(item, plan);
    },
  );
}

export function prioritizeTasks(
  views: readonly TaskView[],
  level: PriorityLevel,
  tasks: BulkTasks,
) {
  return bulkWrite(`Set P${level} on`, views, tasks, async (_view, item) => {
    saved(
      await tasks.updateTask(item, (task) => {
        task.priority = priorityValue(level);
      }),
    );
  });
}

/** A day-only choice keeps each task's wall time, or its all-day marker. */
export function rescheduleMany(views: readonly TaskView[], dayKey: string, tasks: BulkTasks) {
  return bulkWrite("Rescheduled", views, tasks, async (view, item) => {
    const due = rescheduleToDay(view, dayKey);
    saved(
      await tasks.updateTask(item, (task) => {
        task.dueDate = due.due;
        task.allDay = due.allDay;
      }),
    );
  });
}

/**
 * Retry (the summary toast's or a task's own) is safe: the cache keeps one
 * move operation per task until it succeeds, so a retried move reuses its
 * destination copy instead of writing a second one.
 */
export function moveTasksToProject(
  views: readonly TaskView[],
  target: StoredProject,
  tasks: BulkTasks,
) {
  return bulkWrite(
    "Moved",
    views.filter((view) => view.projectUrl !== target.url),
    tasks,
    async (_view, item) => {
      saved(await tasks.moveTaskToProject(item, target));
    },
  );
}

/**
 * Add or remove a union label (case-insensitive name) on every task. Adding
 * first materialises the class once per tracker that lacks it (06-tasks §4.7).
 */
export async function labelTasks(
  views: readonly TaskView[],
  name: string,
  add: boolean,
  tasks: BulkTasks,
) {
  const key = name.toLowerCase();
  const labelIds = (project: StoredProject | undefined) =>
    (project?.tracker.labels ?? [])
      .filter((label) => label.name.toLowerCase() === key)
      .map((label) => label.id);
  const projectOf = (url: string) =>
    tasks.cache.getSnapshot().projects.find((project) => project.url === url);
  if (add)
    for (const url of new Set(views.map((view) => view.projectUrl))) {
      const project = projectOf(url);
      if (project && !labelIds(project).length) await tasks.ensureLabels(project, [name]);
    }
  return bulkWrite(
    add ? `Labelled @${name} on` : `Removed @${name} from`,
    views,
    tasks,
    async (view, item) => {
      const ids = labelIds(projectOf(view.projectUrl));
      if (add && !ids.length) throw new Error(`Couldn't add @${name}`);
      saved(
        await tasks.updateTask(item, (task) => {
          if (add) task.types.add(ids[0] as string);
          else for (const id of ids) task.types.delete(id);
        }),
      );
    },
  );
}

/**
 * Bulk delete reuses the delayed delete (06-tasks §7): every row hides now,
 * one toast offers a single Undo for the batch, and the deletes are issued
 * when that toast closes.
 */
export function deleteTasks(views: readonly TaskView[], tasks: BulkTasks): number {
  const deletes = pendingDeletes(tasks.cache);
  const toastId = crypto.randomUUID();
  const scheduled = views.filter((view) => {
    const item = tasks.cache
      .getSnapshot()
      .tasks[view.projectUrl]?.items.find((task) => task.url === view.url);
    return (
      item &&
      deletes.schedule(
        view.url,
        () => tasks.cache.hideTask(view.url, true),
        () => {
          toast.dismiss(toastId);
          // Unhide only after the cache has installed its optimistic remove transform.
          const deleting = tasks.cache.deleteTask(item);
          tasks.cache.hideTask(view.url, false);
          void deleting;
        },
        () => tasks.cache.hideTask(view.url, false),
      )
    );
  });
  if (!scheduled.length) return 0;
  const finish = () => {
    for (const view of scheduled) deletes.finish(view.url);
  };
  toast.success(
    scheduled.length === 1
      ? `Deleted '${scheduled[0]?.title}'`
      : `Deleted ${scheduled.length} tasks`,
    {
      id: toastId,
      duration: UNDO_WINDOW,
      action: {
        label: "Undo",
        onClick: () => {
          for (const view of scheduled) deletes.undo(view.url);
        },
      },
      onDismiss: finish,
      onAutoClose: finish,
    },
  );
  return scheduled.length;
}
