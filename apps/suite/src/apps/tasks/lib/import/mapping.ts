// AUTHORED-BY Codex GPT-6.1-Sol
import type { NewTask } from "../../state/tasks-cache";
import type { StoredProject } from "../model/store";
import type { TodoistTaskDraft } from "../todoist";
import { priorityValue } from "../views/types";

/** Resolve imported names only against classes saved in the new tracker. */
export function importTaskInput(
  draft: TodoistTaskDraft,
  project: StoredProject,
  sections: ReadonlyMap<string, string>,
): NewTask {
  const description = [
    draft.description,
    ...draft.comments.flatMap((note) => [note.content, note.description]),
    draft.dueText,
  ]
    .filter((text) => text !== undefined && text !== "")
    .join("\n\n");
  return {
    title: draft.title,
    description,
    priority: priorityValue(draft.priority),
    due: draft.due ? new Date(draft.due.dateTime) : undefined,
    allDay: draft.due?.kind === "date" ? draft.due.date : undefined,
    position: draft.orderKey,
    sectionId: draft.sectionId === null ? undefined : sections.get(draft.sectionId),
    labelIds: [...new Set(draft.labels.map((name) => name.toLowerCase()))].map((name) => {
      const label = project.tracker.labels.find((label) => label.name.toLowerCase() === name);
      if (!label) throw new Error("An imported label has not been saved");
      return label.id;
    }),
  };
}
