// AUTHORED-BY Codex GPT-6.1-Sol

import type { ProjectImportDraft } from "../lib/google-tasks";
import { importProjectDescription, importTaskInput } from "../lib/import/mapping";
import type { StoredProject, StoredTask } from "../lib/model/store";
import { unionLabels } from "../lib/model/tracker";
import type { TasksCache } from "./tasks-cache";

/** Owned by one dialog list, so every retry keeps its creation reservation and confirmed writes. */
export interface ProjectImportState {
  create?: ReturnType<TasksCache["prepareProjectCreate"]>;
  project?: StoredProject | undefined;
  savedTasks?: Map<string, StoredTask>;
  warning?: string;
}

/** Setup uses the same project and tracker paths as the composer; tasks share one bounded batch. */
export async function importProject(
  cache: TasksCache,
  draft: ProjectImportDraft,
  title: string,
  signal: AbortSignal,
  onProgress: (completed: number) => void,
  state: ProjectImportState = {},
): Promise<{ project?: StoredProject; imported: number; failed: number; warning?: string }> {
  if (signal.aborted) return { imported: 0, failed: 0 };
  // Import owns feedback and never offers a background Retry that could resume a cancelled job.
  const stop = () => {};
  state.create ??= cache.prepareProjectCreate(title, stop, stop, undefined, () => {
    state.warning = "Couldn't save the project's position";
  });
  state.project ??= await state.create(signal);
  let project = state.project;
  if (!project) return { imported: 0, failed: signal.aborted ? 0 : draft.tasks.length };
  const result = {
    project,
    imported: 0,
    failed: 0,
    ...(state.warning ? { warning: state.warning } : {}),
  };
  if (signal.aborted) return result;
  const sections = new Map<string, string>();
  if (draft.sections.length) {
    const reservations = draft.sections.map((section) => ({ section, name: crypto.randomUUID() }));
    const saved = await cache.updateProject(
      project,
      (tracker) => {
        const description = importProjectDescription(draft);
        if (description) tracker.description = description;
        for (const { section, name } of reservations) {
          // A previous attempt may have saved sections before a later stage failed.
          if (tracker.sections.some((item) => item.position === section.orderKey)) continue;
          // defineCategory reuses identical names; reserve a distinct class even for repeated headings.
          const category = tracker.defineCategory("Section", name, section.orderKey);
          tracker.updateSection(category.id, { name: section.title });
        }
      },
      stop,
      stop,
      signal,
    );
    if (!saved) return { ...result, failed: signal.aborted ? 0 : draft.tasks.length };
    state.project = saved;
    project = saved;
    for (const section of draft.sections) {
      const category = saved.tracker.sections.find((item) => item.position === section.orderKey);
      if (category) sections.set(section.id, category.id);
    }
  }
  if (signal.aborted) return result;
  const union = unionLabels(cache.getSnapshot().projects.map((item) => item.tracker));
  const names = draft.tasks.flatMap((task) =>
    task.labels.map((name) => union.get(name.toLowerCase())?.[0]?.name ?? name),
  );
  if (names.length) {
    const saved = await cache.ensureLabels(project, names, stop, stop, signal);
    if (!saved) return { ...result, failed: signal.aborted ? 0 : draft.tasks.length };
    state.project = saved;
    project = saved;
  }
  if (signal.aborted) return result;
  const entries = draft.tasks.map((task) => ({
    id: task.id,
    parentId: task.parentId,
    data: importTaskInput(task, project, sections),
  }));
  state.savedTasks ??= new Map();
  const written = await cache.importTasks(project, entries, signal, onProgress, state.savedTasks);
  return { ...result, project, ...(written ?? { imported: 0, failed: draft.tasks.length }) };
}
