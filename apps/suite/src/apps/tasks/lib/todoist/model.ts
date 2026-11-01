// AUTHORED-BY Codex GPT-6.1-Sol
export const MAX_TODOIST_CSV_BYTES = 4 * 1024 * 1024;
/** Data records, excluding the header; embedded newlines are not records. */
export const MAX_TODOIST_CSV_ROWS = 20_000;
/** Formatter constructions per import, including the default zone and distinct aliases. */
export const MAX_TODOIST_TIME_ZONES = 32;

export type TodoistImportErrorCode =
  | "INVALID_CSV"
  | "CSV_TOO_LARGE"
  | "INVALID_INDENT"
  | "INVALID_PRIORITY"
  | "INVALID_DURATION"
  | "INVALID_DATE"
  | "INVALID_TIMEZONE";

/** Messages never echo CSV contents or caller-supplied values. */
export class TodoistImportError extends Error {
  constructor(
    public readonly code: TodoistImportErrorCode,
    public readonly line: number,
  ) {
    super(`Todoist import: ${code} (line ${line})`);
    this.name = "TodoistImportError";
  }
}

export interface TodoistWarning {
  readonly code: "UNKNOWN_TYPE" | "ORPHAN_NOTE" | "UNPARSED_DATE";
  /** One-based physical starting line, including the header. */
  readonly line: number;
}

export interface TodoistCommentDraft {
  readonly content: string;
  readonly description: string;
  readonly author: string;
  readonly line: number;
}

export type TodoistDue = {
  /** UTC instant, including local midnight for all-day dates. */
  readonly dateTime: string;
  readonly timeZone: string;
} & ({ readonly kind: "date"; readonly date: string } | { readonly kind: "dateTime" });

export interface TodoistSectionDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly orderKey: number;
  readonly line: number;
}

export interface TodoistTaskDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** P1 = highest, P4 = no priority, matching the quick-add draft. */
  readonly priority: 1 | 2 | 3 | 4;
  readonly indent: number;
  readonly labels: readonly string[];
  readonly sectionId: string | null;
  readonly parentId: string | null;
  /** Zero-based data-record index; notes and skipped rows leave gaps. */
  readonly orderKey: number;
  readonly line: number;
  readonly author: string;
  readonly responsible: string;
  readonly dateLang: string;
  readonly due?: TodoistDue;
  readonly dueText?: string;
  readonly duration?: { readonly amount: number; readonly unit: "minute" | "day" };
  readonly comments: TodoistCommentDraft[];
}

export interface TodoistProjectDraft {
  readonly sections: readonly TodoistSectionDraft[];
  readonly tasks: readonly TodoistTaskDraft[];
  readonly warnings: readonly TodoistWarning[];
}

export interface TodoistImportOptions {
  readonly defaultTimeZone: string;
}
