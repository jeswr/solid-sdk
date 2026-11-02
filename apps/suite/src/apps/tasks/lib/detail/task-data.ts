// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredProject, StoredTask } from "../model/store";
import { type TaskDetails, taskDetails } from "../model/task";

export function copyTaskData(item: StoredTask): TaskDetails {
  const data = taskDetails(item.url, item.dataset);
  if (!data) throw new TypeError("Expected a wf:Task.");
  return {
    ...data,
    // Reminder identities are scoped to the resource being copied.
    reminders: item.task.reminders.map((reminder) =>
      reminder.time ? { time: reminder.time } : { offset: reminder.offset },
    ),
  };
}

export function projectMoveData(
  item: StoredTask,
  source: StoredProject,
  target: StoredProject,
): TaskDetails {
  const categories = [...source.tracker.sections, ...source.tracker.labels];
  const mapped = new Map<string, string | undefined>();
  for (const [from, to] of [
    [source.tracker.sections, target.tracker.sections],
    [source.tracker.labels, target.tracker.labels],
  ] as const)
    for (const category of from)
      mapped.set(
        category.id,
        to.find((entry) => entry.name.toLowerCase() === category.name.toLowerCase())?.id,
      );
  const data = copyTaskData(item);
  return {
    ...data,
    project: target.tracker.id,
    categoryTypes: (data.categoryTypes as string[]).flatMap((type) =>
      categories.some((category) => category.id === type)
        ? mapped.get(type)
          ? [mapped.get(type) as string]
          : []
        : [type],
    ),
  };
}

/** A duplicate starts open with fresh provenance, retaining the exact title and properties. */
export function duplicateTaskData(item: StoredTask, creator: string): TaskDetails {
  const {
    created: _created,
    endedAt: _endedAt,
    clonedFrom: _clonedFrom,
    duplicateOf: _duplicateOf,
    ...data
  } = copyTaskData(item);
  return { ...data, state: "open", creator };
}
