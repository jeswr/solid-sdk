// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type {
  ApprovalRequest,
  ExecutionResult,
  ExecutionStatus,
  Executor,
} from "@jeswr/site-executor";
import type { SiteModel } from "@jeswr/site-model";
import type { Fallback } from "./fallback/index.js";

export type TaskStatus = ExecutionStatus | "repeat-blocked";

export interface PlannerHistory {
  request: string;
  status: TaskStatus;
  observations: string;
  error?: string;
}

export interface PlannerInput {
  goal: string;
  catalogue: string;
  history: PlannerHistory[];
  persona?: string;
}

export type PlannerOutput =
  | { kind: "act"; turtle: string }
  | { kind: "answer"; text: string }
  | { kind: "ask"; question: string };

export interface Planner {
  next(input: PlannerInput): Promise<PlannerOutput>;
}

/** A per-action cap, in the approval's currency; it never creates standing consent. */
export type ApprovalDecision = "approve" | "deny" | { limit: number };
export type Approver = (request: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>;

export interface TaskExecutor extends Executor {
  execute(...args: Parameters<Executor["execute"]>): Promise<TaskExecutionResult>;
  approve?(id: string): boolean;
  reject?(id: string): boolean;
  /** Host-side redaction; never sent to the planner. */
  redact?(text: string): string;
  /** Rebuild with a learned model while retaining all host executor configuration. */
  withModel?(model: SiteModel): TaskExecutor;
}

export type TaskExecutionResult = ExecutionResult & { refreshError?: string };

export interface RunTaskOptions {
  goal: string;
  executor: TaskExecutor;
  model: SiteModel;
  planner: Planner;
  approver: Approver;
  fallback?: Fallback;
  maxSteps?: number;
  /** Maximum host approval prompts per action, including price revalidation. Default 25. */
  maxApprovals?: number;
  persona?: string;
  /** Total observation characters across planner history, newest first. */
  observationBudget?: number;
  /** Permit writes whose canonical requests already committed in this task. Default false. */
  allowRepeats?: boolean;
  /** Host recovery authorization for these specific committed/uncertain requests. */
  allowRetryOf?: string[];
}

export interface TraceStep {
  index: number;
  via?: "fallback";
  learned?: string[];
  kind: PlannerOutput["kind"] | "error";
  promptTokensEstimate: number;
  request?: string;
  status: TaskStatus | "answer" | "ask";
  statuses: string[];
  approval?: {
    summary: string;
    decision: ApprovalDecision;
    outcome: "approved" | "denied";
  };
  /** Every approval in execution order; approval retains the latest for compatibility. */
  approvals?: NonNullable<TraceStep["approval"]>[];
  observations: string;
  error?: string;
  /** Auxiliary host failure; execution status and commitment memory remain authoritative. */
  refreshError?: string;
  elapsedMs: number;
}

export interface TaskTrace {
  format: "agent-browser-trace/0.1";
  goal: string;
  /** Host storage value, present only when fallback ran; never sent to the planner. */
  model?: SiteModel;
  outcome: "answer" | "ask" | "maxSteps";
  text?: string;
  steps: TraceStep[];
  promptTokensEstimate: number;
  elapsedMs: number;
}
