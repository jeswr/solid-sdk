// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ApprovalRequest, ExecutionStatus, Executor } from "@jeswr/site-executor";
import type { SiteModel } from "@jeswr/site-model";

export interface PlannerHistory {
  request: string;
  status: ExecutionStatus;
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
  approve?(id: string): boolean;
  reject?(id: string): boolean;
  /** Host-side redaction; never sent to the planner. */
  redact?(text: string): string;
}

export interface RunTaskOptions {
  goal: string;
  executor: TaskExecutor;
  model: SiteModel;
  planner: Planner;
  approver: Approver;
  maxSteps?: number;
  /** Maximum host approval prompts per action, including price revalidation. Default 25. */
  maxApprovals?: number;
  persona?: string;
  /** Total observation characters across planner history, newest first. */
  observationBudget?: number;
}

export interface TraceStep {
  index: number;
  kind: PlannerOutput["kind"] | "error";
  promptTokensEstimate: number;
  request?: string;
  status: ExecutionStatus | "answer" | "ask";
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
  elapsedMs: number;
}

export interface TaskTrace {
  format: "agent-browser-trace/0.1";
  goal: string;
  outcome: "answer" | "ask" | "maxSteps";
  text?: string;
  steps: TraceStep[];
  promptTokensEstimate: number;
  elapsedMs: number;
}
