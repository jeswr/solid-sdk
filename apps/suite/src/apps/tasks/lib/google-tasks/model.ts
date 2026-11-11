// AUTHORED-BY Codex GPT-6.1-Sol
import type { TodoistProjectDraft, TodoistTaskDraft, TodoistWarning } from "../todoist";

export const MAX_GOOGLE_TASKS_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_GOOGLE_TASKS_LISTS = 1_000;
/** Total source tasks, including deleted records, across all lists. */
export const MAX_GOOGLE_TASKS_TASKS = 20_000;
export const MAX_GOOGLE_TASKS_JSON_DEPTH = 32;

export type GoogleTasksImportErrorCode =
  | "INVALID_JSON"
  | "JSON_TOO_LARGE"
  | "JSON_TOO_DEEP"
  | "TOO_MANY_LISTS"
  | "TOO_MANY_TASKS"
  | "INVALID_DATA"
  | "INVALID_DATE"
  | "INVALID_HIERARCHY";

/** Messages never include file contents or caller-supplied values. */
export class GoogleTasksImportError extends Error {
  constructor(public readonly code: GoogleTasksImportErrorCode) {
    super(`Google Tasks import: ${code}`);
    this.name = "GoogleTasksImportError";
  }
}

export interface GoogleTasksWarning {
  readonly code: "DELETED_TASK" | "HIDDEN_COMPLETED" | "UNKNOWN_PARENT" | "DEPTH_FLATTENED";
  /** One-based source list/task ordinals, including deleted records. */
  readonly list: number;
  readonly task: number;
}

/** Shared consumer shape: Todoist drafts are assignable without changing that parser. */
export interface TaskImportDraft extends Omit<TodoistTaskDraft, "priority"> {
  readonly priority?: TodoistTaskDraft["priority"];
  readonly state?: "open" | "closed";
  readonly completedAt?: string;
}

export interface ProjectImportDraft<Warning = TodoistWarning | GoogleTasksWarning>
  extends Omit<TodoistProjectDraft, "tasks" | "warnings"> {
  readonly name?: string;
  readonly tasks: readonly TaskImportDraft[];
  readonly warnings: readonly Warning[];
}

export interface GoogleTasksTaskDraft extends TaskImportDraft {
  readonly priority?: never;
  readonly state: "open" | "closed";
}

export interface GoogleTasksProjectDraft extends ProjectImportDraft<GoogleTasksWarning> {
  readonly id: string;
  readonly name: string;
  readonly tasks: readonly GoogleTasksTaskDraft[];
}

export interface GoogleTasksImportResult {
  readonly projects: readonly GoogleTasksProjectDraft[];
  /** Also available on the owning project's warnings array. */
  readonly warnings: readonly GoogleTasksWarning[];
}

export interface GoogleTasksImportOptions {
  /** The tasks.list API omits its list title; defaults to "Imported tasks". */
  readonly singleListName?: string;
}
