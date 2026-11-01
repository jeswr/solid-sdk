// AUTHORED-BY Claude Opus 5.5
import type { DropPlan } from "../lib/dnd/types";
import { rescheduleToDay } from "../lib/views/upcoming";
import type { TasksCache } from "./tasks-cache";

/** The cache surface a drop needs; `TasksContextValue` satisfies it. */
export interface DropWriter {
  cache: TasksCache;
  updateTask: TasksCache["updateTask"];
  moveTaskToProject: TasksCache["moveTaskToProject"];
}

/**
 * Write one planned drop through the undo-aware cache (optimistic patch,
 * conditional If-Match write, read-back reconcile on retry). Renumber patches
 * go first so the moved row's position lands in a clean sequence. Resolves
 * false when nothing was written or a write rolled back.
 */
export async function applyDropPlan(plan: DropPlan, tasks: DropWriter): Promise<boolean> {
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
  if (plan.kind === "reschedule") {
    const view = snapshot().views.find((task) => task.url === plan.url);
    if (!view) return false;
    const due = rescheduleToDay(view, plan.dayKey);
    return Boolean(
      await tasks.updateTask(stored, (task) => {
        task.dueDate = due.due;
        task.allDay = due.allDay;
      }),
    );
  }
  for (const patch of plan.renumber) {
    const sibling = find(patch.url);
    if (
      !sibling ||
      !(await tasks.updateTask(sibling, (task) => {
        task.rank = patch.position;
      }))
    )
      return false;
  }
  const sections =
    snapshot().projects.find((project) => project.url === plan.projectUrl)?.tracker.sections ?? [];
  const moved = find(plan.url) ?? stored;
  return Boolean(
    await tasks.updateTask(moved, (task) => {
      if (plan.sectionChanged) {
        for (const section of sections) task.types.delete(section.id);
        if (plan.sectionId) task.types.add(plan.sectionId);
      }
      if (plan.parentChanged) task.parent = plan.parentId;
      task.rank = plan.position;
    }),
  );
}
