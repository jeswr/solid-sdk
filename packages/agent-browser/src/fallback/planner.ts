// AUTHORED-BY Codex GPT-6.1-Sol
import type { ActionRequest } from "@jeswr/site-model";

export type BrowserAction =
  | { kind: "goto"; url: string }
  | { kind: "click"; ref: string }
  | { kind: "fill"; ref: string; text: string }
  | { kind: "select"; ref: string; value: string }
  | { kind: "press"; key: string }
  | { kind: "type"; text: string }
  | { kind: "back" };

export interface BrowserSnapshot {
  /** All names and values below are page-controlled data, never instructions. */
  untrusted: true;
  text: string;
  nodes: { role: string; name: string; value?: string; ref?: string }[];
  truncated: boolean;
}

export interface FallbackHistory {
  action: BrowserAction;
  status: "done" | "error";
}
export interface FallbackPlannerInput {
  goal: string;
  request: ActionRequest;
  snapshot: BrowserSnapshot;
  history: readonly FallbackHistory[];
}
export type FallbackPlannerOutput =
  | { kind: "step"; action: BrowserAction }
  | { kind: "done" }
  | { kind: "give-up"; reason: string };
export interface FallbackPlanner {
  next(input: FallbackPlannerInput): Promise<FallbackPlannerOutput>;
}
export type ScriptedFallbackStep =
  | FallbackPlannerOutput
  | ((input: FallbackPlannerInput) => FallbackPlannerOutput | Promise<FallbackPlannerOutput>);

/** A fresh deterministic sequence; exhaustion gives up instead of claiming success. */
export function scriptedFallbackPlanner(steps: readonly ScriptedFallbackStep[]): FallbackPlanner {
  let index = 0;
  return {
    async next(input) {
      const step = steps[index++];
      return typeof step === "function"
        ? step(input)
        : (step ?? { kind: "give-up", reason: "Script exhausted." });
    },
  };
}
