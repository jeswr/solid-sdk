// AUTHORED-BY Codex GPT-6.1-Sol
import type { NewTask } from "../../state/tasks-cache";
import type { GoogleTasksWarning, ProjectImportDraft, TaskImportDraft } from "../google-tasks";
import { requireHttp } from "../model/rdf";
import type { StoredProject } from "../model/store";
import type { TodoistWarning } from "../todoist";
import { priorityValue } from "../views/types";

interface MetadataWarning {
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
export type ImportWarning = GoogleTasksWarning | MetadataWarning;

/** The task writer's own IRI rule, so a value accepted here never fails at creation. */
function webId(value: string): string | undefined {
  try {
    return requireHttp(value);
  } catch {
    return undefined;
  }
}

/** Display names cannot be resolved to WebIDs without an identity mapping. Keep them verbatim. */
function taskMetadata(draft: TaskImportDraft) {
  const fields: Pick<NewTask, "creator" | "assignee"> = {};
  const description = [draft.description];
  const warnings: ImportWarning[] = [];
  const keep = (value: string, label: string, code: MetadataWarning["code"], line = draft.line) => {
    if (!value) return;
    description.push(`${label}: ${value}`);
    warnings.push({ code, line });
  };
  const creator = webId(draft.author);
  if (creator) fields.creator = creator;
  else keep(draft.author, "Author", "UNRESOLVED_AUTHOR");
  const assignee = webId(draft.responsible);
  if (assignee) fields.assignee = assignee;
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
export function importProjectDescription(draft: ProjectImportDraft): string {
  return draft.sections
    .filter((section) => section.description !== "")
    .map((section) => `Section "${section.title}" description: ${section.description}`)
    .join("\n\n");
}

/** Preview warnings contain only codes and source positions, never metadata copied from the file. */
export function importWarnings(draft: ProjectImportDraft): ImportWarning[] {
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
  draft: TaskImportDraft,
  project: StoredProject,
  sections: ReadonlyMap<string, string>,
): NewTask {
  const { fields, description } = taskMetadata(draft);
  return {
    ...fields,
    title: draft.title,
    description,
    priority: priorityValue(draft.priority ?? 4),
    ...(draft.state === undefined ? {} : { state: draft.state }),
    ...(draft.completedAt === undefined ? {} : { endedAt: new Date(draft.completedAt) }),
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
