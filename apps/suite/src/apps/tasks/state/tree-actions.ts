// AUTHORED-BY Codex GPT-6.1-Sol
import { taskSection } from "../lib/views/project-groups";
import { planTreeMove } from "../lib/views/tree";
import type { TaskView } from "../lib/views/types";
import type { TasksCache } from "./tasks-cache";

/** One cache mutation and conditional PUT, retaining a bounded, idempotent retry intent. */
export async function changeTaskDepth(
  cache: TasksCache,
  active: TaskView,
  outdent: boolean,
  announce: (message: string) => void,
) {
  const plan = planTreeMove(cache.getSnapshot().views, active, outdent);
  const failure = `Couldn't ${outdent ? "outdent" : "indent"} '${active.title}'.`;
  if (!plan) {
    announce(failure);
    return;
  }
  const message = `${outdent ? "Outdented" : "Indented"} '${active.title}'.`;
  const run = async () => {
    const snapshot = cache.getSnapshot();
    const fresh = snapshot.views.find((task) => task.url === active.url);
    const item =
      fresh && snapshot.tasks[fresh.projectUrl]?.items.find((task) => task.url === fresh.url);
    if (!item || !fresh) return;
    if (fresh.parentId === plan.parentId && fresh.position === plan.position) {
      announce(message);
      return;
    }
    // Do not apply a relative indent twice or overwrite a concurrent reparenting on Retry.
    const next = fresh.parentId === active.parentId && planTreeMove(snapshot.views, fresh, outdent);
    if (!next || next.parentId !== plan.parentId) {
      announce(failure);
      return;
    }
    const written = await cache.updateTasks(
      [
        {
          item,
          change: (task) => {
            task.parent = next.parentId;
            task.rank = next.position;
            if (next.parentId === undefined) {
              const project = snapshot.projects.find((project) => project.url === fresh.projectUrl);
              for (const section of project?.tracker.sections ?? []) task.types.delete(section.id);
              const section = taskSection(fresh, snapshot.views, true);
              if (section) task.types.add(section);
            }
          },
        },
      ],
      () => {
        void run();
      },
    );
    announce(written ? message : failure);
  };
  await run();
}
