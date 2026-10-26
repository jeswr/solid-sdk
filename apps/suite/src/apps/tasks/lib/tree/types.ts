// AUTHORED-BY Codex GPT-6.1-Sol

/** Complete forest projection. Omit parentId for roots; keys are unique among siblings. */
export interface TreeTask {
  readonly id: string;
  readonly parentId?: string;
  readonly orderKey: string;
  readonly state: "open" | "completed";
}

export type TreeErrorCode =
  | "invalid-input"
  | "invalid-order"
  | "invalid-tree"
  | "task-not-found"
  | "cycle"
  | "invalid-operation";

export class TaskTreeError extends Error {
  override readonly name = "TaskTreeError";
  constructor(
    readonly code: TreeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CompletionOptions {
  readonly completeDescendants?: boolean;
  readonly completeAncestors?: boolean;
}

export interface TreeProgress {
  readonly completed: number;
  readonly open: number;
  readonly total: number;
  /** False for an empty group. */
  readonly allCompleted: boolean;
}
