// AUTHORED-BY Claude Opus 5.5
import { failedMessage } from "../lib/dnd/announce";
import { renumberWriteOrder } from "../lib/dnd/plan";
import type { DropPlan } from "../lib/dnd/types";
import type { StoredTask } from "../lib/model/store";
import type { TaskItem } from "../lib/model/task";
import type { TaskView } from "../lib/views/types";
import { rescheduleToDay } from "../lib/views/upcoming";
import type { TasksCache } from "./tasks-cache";

/** The cache surface a drop needs; `TasksContextValue` satisfies it. */
export interface DropWriter {
  cache: TasksCache;
  updateTask: TasksCache["updateTask"];
  moveTaskToProject: TasksCache["moveTaskToProject"];
}

/**
 * Plans a drop again from the latest snapshot, for Retry: `plan` receives the
 * task's fresh view and every task of its project. A vanished task plans nothing.
 */
export function replanner(
  cache: TasksCache,
  url: string,
  plan: (task: TaskView, project: readonly TaskView[]) => DropPlan,
): () => DropPlan {
  return () => {
    const { views } = cache.getSnapshot();
    const task = views.find((view) => view.url === url);
    return task
      ? plan(
          task,
          views.filter((view) => view.projectUrl === task.projectUrl),
        )
      : { kind: "none" };
  };
}

/**
 * The `onRetried` announcer for a drop: a written retry describes its own
 * plan; a retry with nothing left to do (the task already sits where it was
 * meant to go) repeats the original message; anything else is a failure.
 */
export function announceRetries(
  cache: TasksCache,
  task: TaskView,
  original: string,
  describe: (plan: DropPlan) => string,
  announce: (message: string) => void,
): (written: boolean, plan: DropPlan) => void {
  return (written, plan) => {
    if (written) announce(describe(plan));
    else if (
      plan.kind === "none" &&
      cache.getSnapshot().views.some((view) => view.url === task.url)
    )
      announce(original);
    else announce(failedMessage(task));
  };
}

/**
 * Write one planned drop through the undo-aware cache (optimistic patch,
 * conditional If-Match writes, read-back reconcile). A position drop is ONE
 * cache mutation: renumber patches and the moved row patch together, write
 * siblings first (in an order that never scrambles them), and revert
 * confirmed writes if any write fails. Retry runs
 * `replan` so the whole drop is planned again from what the pod now holds,
 * and reports each retry's outcome (and the plan it wrote) to `onRetried`.
 * Resolves false when nothing was written or a write rolled back.
 */
export async function applyDropPlan(
  plan: DropPlan,
  tasks: DropWriter,
  replan: () => DropPlan = () => plan,
  onRetried: (written: boolean, plan: DropPlan) => void = () => {},
): Promise<boolean> {
  if (plan.kind === "none") return false;
  const snapshot = () => tasks.cache.getSnapshot();
  const find = (url: string) => {
    for (const load of Object.values(snapshot().tasks)) {
      const item = load.items.find((task) => task.url === url);
      if (item) return item;
    }
  };
  const stored = find(plan.url);
  if (!stored) return false;
  if (plan.kind === "project") {
    const target = snapshot().projects.find((project) => project.url === plan.projectUrl);
    return Boolean(target && (await tasks.moveTaskToProject(stored, target)));
  }
  const retry = () => {
    const next = replan();
    void applyDropPlan(next, tasks, replan, onRetried).then((written) => onRetried(written, next));
  };
  if (plan.kind === "reschedule") {
    const view = snapshot().views.find((task) => task.url === plan.url);
    if (!view) return false;
    const due = rescheduleToDay(view, plan.dayKey);
    return Boolean(
      await tasks.updateTask(
        stored,
        (task) => {
          task.dueDate = due.due;
          task.allDay = due.allDay;
        },
        retry,
      ),
    );
  }
  const edits: { item: StoredTask; change: (task: TaskItem) => void }[] = [];
  // Ordered so no prefix of the writes scrambles the siblings, should a revert be impossible.
  for (const patch of renumberWriteOrder(plan.renumber, (url) => find(url)?.task.rank)) {
    const sibling = find(patch.url);
    if (!sibling) return false;
    edits.push({
      item: sibling,
      change: (task) => {
        task.rank = patch.position;
      },
    });
  }
  const sections =
    snapshot().projects.find((project) => project.url === plan.projectUrl)?.tracker.sections ?? [];
  edits.push({
    item: stored,
    change: (task) => {
      if (plan.sectionChanged) {
        for (const section of sections) task.types.delete(section.id);
        if (plan.sectionId) task.types.add(plan.sectionId);
      }
      if (plan.parentChanged) task.parent = plan.parentId;
      task.rank = plan.position;
    },
  });
  return Boolean(await tasks.cache.updateTasks(edits, retry));
}
