// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

export type VTodoErrorCode =
  | "invalid-input"
  | "invalid-syntax"
  | "unsupported-component"
  | "unsupported-property"
  | "unsupported-parameter"
  | "invalid-value"
  | "duplicate"
  | "missing-required"
  | "unresolved-parent";

/** Messages contain no input values, titles, identifiers or calendar contents. */
export class VTodoError extends Error {
  readonly code: VTodoErrorCode;
  constructor(code: VTodoErrorCode) {
    super(`VTODO: ${code}`);
    this.name = "VTodoError";
    this.code = code;
  }
}

export type VTodoDate =
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "utc"; readonly value: Date };

export type VTodoStatus = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";

/** Structural subset of solid-task-model's TaskData; no RDF or runtime dependency. */
export interface TaskDataProjection {
  readonly title: string;
  readonly state: "open" | "closed";
  readonly description?: string;
  readonly endedAt?: Date;
  readonly dueDate?: Date;
  readonly priority?: "high" | "medium" | "low";
  readonly parent?: string;
}

/** Exchange fields extend the task-model fields without discarding finer iCalendar data. */
export interface VTodoTask extends Omit<TaskDataProjection, "dueDate" | "parent"> {
  readonly uid: string;
  readonly stamp: Date;
  readonly due?: VTodoDate;
  readonly start?: VTodoDate;
  readonly status?: VTodoStatus;
  /** Exact iCalendar priority (0 = undefined, 1–4 high, 5 medium, 6–9 low). */
  readonly icalPriority?: number;
  readonly percentComplete?: number;
  /** Opaque RRULE value, never evaluated or converted to scheduling RDF here. */
  readonly rrule?: string;
  /** Calendar UID, resolved explicitly before writing dct:isPartOf. */
  readonly parentUid?: string;
}

export interface VTodoCalendar {
  readonly productId: string;
  readonly scale?: "GREGORIAN";
  readonly tasks: readonly VTodoTask[];
}
