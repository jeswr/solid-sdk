// AUTHORED-BY Codex GPT-6.1-Sol
import { isHttpIri } from "@jeswr/solid-task-model/task";
import type { NewTask } from "../../state/tasks-cache";
import type { StoredProject } from "../model/store";
import type { TodoistProjectDraft, TodoistTaskDraft, TodoistWarning } from "../todoist";
import { priorityValue } from "../views/types";

export interface ImportWarning {
  code:
    | TodoistWarning["code"]
    | "UNRESOLVED_AUTHOR"
    | "UNRESOLVED_RESPONSIBLE"
    | "DURATION_TEXT"
    | "DATE_LANGUAGE_TEXT"
    | "NOTE_AUTHOR_TEXT"
    | "SECTION_DESCRIPTION";
  line: number;
}

/** Display names cannot be resolved to WebIDs without an identity mapping. Keep them verbatim. */
function taskMetadata(draft: TodoistTaskDraft) {
  const fields: Pick<NewTask, "creator" | "assignee"> = {};
  const description = [draft.description];
  const warnings: ImportWarning[] = [];
  const keep = (value: string, label: string, code: ImportWarning["code"], line = draft.line) => {
    if (!value) return;
    description.push(`${label}: ${value}`);
    warnings.push({ code, line });
  };
  if (isHttpIri(draft.author)) fields.creator = draft.author;
  else keep(draft.author, "Author", "UNRESOLVED_AUTHOR");
  if (isHttpIri(draft.responsible)) fields.assignee = draft.responsible;
  else keep(draft.responsible, "Responsible", "UNRESOLVED_RESPONSIBLE");
  if (draft.duration) {
    const { amount, unit } = draft.duration;
    keep(`${amount} ${unit}${amount === 1 ? "" : "s"}`, "Duration", "DURATION_TEXT");
  }
  keep(draft.dateLang, "Date language", "DATE_LANGUAGE_TEXT");
  for (const note of draft.comments) {
    description.push(note.content, note.description);
    keep(note.author, "Note author", "NOTE_AUTHOR_TEXT", note.line);
  }
  if (draft.dueText) description.push(`Original date: ${draft.dueText}`);
  return { fields, description: description.filter((text) => text !== "").join("\n\n"), warnings };
}

/** Sections have no description field in the model; the project retains even empty sections' text. */
export function importProjectDescription(draft: TodoistProjectDraft): string {
  return draft.sections
    .filter((section) => section.description !== "")
    .map((section) => `Section "${section.title}" description: ${section.description}`)
    .join("\n\n");
}

/** Preview warnings contain only codes and line numbers, never metadata copied from the file. */
export function importWarnings(draft: TodoistProjectDraft): ImportWarning[] {
  return [
    ...draft.warnings,
    ...draft.sections
      .filter((section) => section.description !== "")
      .map((section): ImportWarning => ({ code: "SECTION_DESCRIPTION", line: section.line })),
    ...draft.tasks.flatMap((task) => taskMetadata(task).warnings),
  ];
}

/** Resolve imported names only against classes saved in the new tracker. */
export function importTaskInput(
  draft: TodoistTaskDraft,
  project: StoredProject,
  sections: ReadonlyMap<string, string>,
): NewTask {
  const { fields, description } = taskMetadata(draft);
  return {
    ...fields,
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
