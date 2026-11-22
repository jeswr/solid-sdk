// AUTHORED-BY Codex GPT-6
import type { UsageModel, UsageModelInput, UsageModelOpinion } from "../mechanisms/usage-model.js";

/** No inference is claimed. The fixed answer is deliberately visible and injectable in tests. */
export class FixedUsageModel implements UsageModel {
  readonly id = "urn:fictional:fixed-usage-review";
  readonly calls: UsageModelInput[] = [];
  constructor(
    private readonly answer: UsageModelOpinion = {
      effect: "permit",
      reason: "The fixed stand-in says the request matches the stated purpose.",
    },
  ) {}
  review(input: UsageModelInput): UsageModelOpinion {
    this.calls.push(input);
    return { ...this.answer };
  }
}
