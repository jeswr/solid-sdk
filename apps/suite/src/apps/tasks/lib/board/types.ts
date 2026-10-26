// AUTHORED-BY Codex GPT-6.1-Sol

/** Projection supplied by the task data layer; keys use src/lib/order's base-62 alphabet. */
export interface BoardTask {
  readonly id: string;
  readonly status: string;
  readonly orderKey: string;
}

export interface BoardColumn<T extends BoardTask> {
  readonly status: string;
  readonly tasks: readonly T[];
  /** All tasks in this status, independent of any UI filtering or terminal-state policy. */
  readonly wipCount: number;
}

export interface BoardChange extends BoardTask {}

export interface BoardViewState {
  readonly filter: {
    readonly query?: string;
    readonly statuses?: readonly string[];
    readonly labels?: readonly string[];
    readonly priorities?: readonly (1 | 2 | 3 | 4)[];
    readonly project?: string;
  };
  readonly sort: "manual" | "due" | "priority" | "name";
}
