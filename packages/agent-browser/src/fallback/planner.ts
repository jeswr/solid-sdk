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

/** History never retains printable key spellings, even if dispatch protection fails. */
export function maskedBrowserAction(action: BrowserAction): BrowserAction {
  switch (action.kind) {
    case "fill":
    case "type":
      return { ...action, text: "[redacted]" };
    case "select":
      return { ...action, value: "[redacted]" };
    case "goto":
      return { ...action, url: "[same-origin page]" };
    case "press":
      // An allowlist avoids leaking characters through KeyB, Digit7, Space or Shift+KeyB.
      return {
        kind: "press",
        key: /^(Enter|Tab|Escape|Backspace|Delete|Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown|Insert)$/.test(
          action.key,
        )
          ? action.key
          : "[redacted key]",
      };
    default:
      return { ...action };
  }
}

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
