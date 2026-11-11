// AUTHORED-BY Codex (GPT-6.1 Sol)
/**
 * Failure codes a future `AnswerModel` reports. There is no hosted model today: models are
 * reached only through `@jeswr/agent-model-gateway`, which has no grounded completion yet.
 */
export type AskErrorCode = "not-configured" | "rate-limited" | "network" | "invalid";
export class AskModelError extends Error {
  constructor(readonly code: AskErrorCode) {
    super(code);
  }
}
