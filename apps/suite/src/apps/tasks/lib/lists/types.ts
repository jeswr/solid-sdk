// AUTHORED-BY Codex GPT-6.1-Sol

export type DueDate =
  | { readonly kind: "all-day"; readonly date: string }
  | { readonly kind: "timed"; readonly at: string };

export interface ListContext {
  readonly clock: () => Date;
  readonly timeZone: string;
}

export interface RepeatRule {
  readonly frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  readonly interval?: number;
  readonly from?: "due" | "completion";
  readonly byDay?: readonly ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[];
  readonly byMonthDay?: number;
  readonly count?: number;
  readonly until?: DueDate;
}

/** A projection of task data, independent of RDF wrappers and persistence. */
export interface ListTask {
  readonly id: string;
  readonly state: "open" | "completed";
  readonly due?: DueDate;
  readonly priority?: 1 | 2 | 3 | 4;
  readonly orderKey?: string;
  readonly parentId?: string;
  readonly recurrence?: RepeatRule;
  readonly completedAt?: string;
  readonly modifiedAt?: string;
  readonly derivedFrom?: string;
}

export type ListErrorCode =
  | "invalid-input"
  | "unsupported-rule"
  | "invalid-time-zone"
  | "unresolvable-local-time"
  | "date-out-of-range"
  | "invalid-hierarchy";

export class TaskListError extends Error {
  constructor(
    readonly code: ListErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskListError";
  }
}
