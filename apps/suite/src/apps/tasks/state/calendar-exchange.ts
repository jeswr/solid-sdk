// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredProject, StoredTask } from "../lib/model/store";
import { type TaskDetails, validateTask } from "../lib/model/task";
import { runBulk } from "../lib/views/bulk";
import { toTaskView } from "../lib/views/types";
import { serializeVTodo, type VTodoCalendar, VTodoError, type VTodoTask } from "../lib/vtodo";
import { calendarTaskData, importLevels, toCalendar } from "../lib/vtodo-adapter";
import type { TasksCache } from "./tasks-cache";

function identities(items: readonly StoredTask[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const { task } of items) {
    ids.set(task.id, task.id);
    if (task.calendarUid !== undefined) ids.set(task.calendarUid, task.id);
  }
  return ids;
}
function dataFor(todo: VTodoTask, ids: ReadonlyMap<string, string>): TaskDetails {
  return calendarTaskData(
    todo,
    ids,
    todo.due?.kind === "date" ? new Date(`${todo.due.value}T00:00:00`) : undefined,
  );
}
/** Reject unsupported recurrence and invalid parents before the user confirms any writes. */
export function previewCalendar(calendar: VTodoCalendar, items: readonly StoredTask[]) {
  const ids = identities(items);
  const plan = importLevels(calendar, ids);
  const placeholders = new Map(ids);
  for (const todo of calendar.tasks) placeholders.set(todo.uid, "https://calendar.invalid/task#it");
  for (const level of plan.levels)
    for (const todo of level) validateTask(dataFor(todo, placeholders));
  return {
    count: calendar.tasks.length,
    completed: calendar.tasks.filter((task) => task.state === "closed").length,
    skipped: plan.skipped,
  };
}
async function loadedProject(cache: TasksCache, project: StoredProject) {
  await cache.loadTasks(project, true);
  const snapshot = cache.getSnapshot();
  const load = snapshot.tasks[project.url];
  const current = snapshot.projects.find((item) => item.url === project.url);
  if (!current || load?.status !== "ready" || load.refreshing || load.warningCount)
    throw new Error("Couldn't load every task in the project.");
  return { project: current, items: load.items };
}
export async function exportCalendar(cache: TasksCache, project: StoredProject): Promise<string> {
  const loaded = await loadedProject(cache, project);
  return serializeVTodo(
    toCalendar(
      loaded.items.map((item) => ({
        view: toTaskView(item, loaded.project),
        recurrence: item.task.recurrence,
      })),
      new Map(loaded.project.tracker.labels.map((label) => [label.id, label.name])),
      new Date(),
    ),
  );
}

/** One operation owns reservations across inline and toast retries, including lost responses. */
export function calendarImport(cache: TasksCache, project: StoredProject, calendar: VTodoCalendar) {
  const creates = new Map<string, () => Promise<StoredTask | undefined>>();
  const added = new Set<string>();
  let running: Promise<{ added: number; skipped: number; failed: number }> | undefined;
  const run = (): NonNullable<typeof running> => {
    if (running) return running;
    running = (async () => {
      const loaded = await loadedProject(cache, project);
      previewCalendar(calendar, loaded.items);
      const ids = identities(loaded.items);
      for (const uid of creates.keys()) if (ids.has(uid)) added.add(uid);
      const { levels } = importLevels(calendar, ids);
      const names = [...new Set(levels.flat(1).flatMap((todo) => todo.categories ?? []))];
      const labelled = names.length
        ? await cache.ensureLabels(loaded.project, names, retry)
        : loaded.project;
      if (!labelled) throw new Error("Couldn't save labels.");
      let failed = 0;
      for (const level of levels) {
        const result = await runBulk(
          level,
          async (todo) => {
            // A failed parent never turns its descendants into unrelated top-level tasks.
            if (todo.parentUid && !ids.has(todo.parentUid))
              throw new VTodoError("unresolved-parent");
            let create = creates.get(todo.uid);
            if (!create) {
              create = cache.prepareTaskCreate(
                labelled,
                {
                  ...dataFor(todo, ids),
                  labelIds: labelled.tracker.labels
                    .filter((label) =>
                      todo.categories?.some(
                        (name) => name.toLowerCase() === label.name.toLowerCase(),
                      ),
                    )
                    .map((label) => label.id),
                },
                retry,
              );
              creates.set(todo.uid, create);
            }
            const saved = await create();
            if (!saved) throw new Error("Couldn't add task.");
            added.add(todo.uid);
            ids.set(todo.uid, saved.task.id);
          },
          { concurrency: 4 },
        );
        failed += result.failed.length;
      }
      return {
        added: added.size,
        skipped: calendar.tasks.filter((todo) => ids.has(todo.uid) && !added.has(todo.uid)).length,
        failed,
      };
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
  const retry = () => {
    void run().catch(() => {});
  };
  return run;
}
