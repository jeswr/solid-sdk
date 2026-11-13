// AUTHORED-BY Claude Opus 5.5
import type { TaskTrace } from "@jeswr/agent-browser";
import type { ExecutorOptions } from "@jeswr/site-executor";

export const SITES = ["shopping", "shopping_admin", "reddit", "gitlab"] as const;
export type Site = (typeof SITES)[number];
export type TaskType = "RETRIEVE" | "MUTATE" | "NAVIGATE";
export const STATUSES = [
  "SUCCESS",
  "ACTION_NOT_ALLOWED_ERROR",
  "PERMISSION_DENIED_ERROR",
  "NOT_FOUND_ERROR",
  "DATA_VALIDATION_ERROR",
  "UNKNOWN_ERROR",
] as const;
export type Status = (typeof STATUSES)[number];
export type Transport = NonNullable<ExecutorOptions["fetch"]>;
export type ResultItem = string | number | boolean | Record<string, unknown> | null;

/** Deliberately excludes eval, expected values, schemas and instantiation metadata. */
export interface BenchTask {
  task_id: number;
  sites: Site[];
  intent: string;
  start_urls: string[];
  taskType: TaskType;
}

export interface FinalAgentResponse {
  task_type: TaskType;
  status: Status;
  retrieved_data: ResultItem[] | null;
  error_details: string | null;
}

export interface TaskMetrics {
  taskId: number;
  sites: Site[];
  taskType: TaskType;
  steps: number;
  promptTokensEstimate: number;
  wallTimeMs: number;
  outcome: TaskTrace["outcome"] | "error" | "timeout";
  error?: string;
}
