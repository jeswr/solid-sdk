// AUTHORED-BY Codex GPT-6
/** A host-installed model reviews permitted uses. It has no authority to grant a use. */
import type { TermsVerdict } from "../gates/quality.js";

export interface UsageModelInput {
  /** Canonical text is untrusted context for the model, never instructions to the gate. */
  readonly action: string;
  readonly actionDigest: string;
  readonly operation: string;
  readonly purpose?: string;
  readonly recipient?: string;
  readonly item: string;
  readonly request?: string;
  readonly at: string;
}
export interface UsageModelOpinion {
  readonly effect: "permit" | "not-decided" | "prohibited";
  readonly reason: string;
}
/** A local model or a host-prepared model response implements the same narrow seam. */
export interface UsageModel {
  readonly id: string;
  review(input: UsageModelInput): UsageModelOpinion;
}
export interface UsageReview {
  readonly terms: TermsVerdict;
  readonly opinion?: UsageModelOpinion;
}

export function tightenUsage(
  rules: TermsVerdict,
  input: UsageModelInput,
  model: UsageModel,
): UsageReview {
  // This order is the security boundary: neither prohibition nor undecided rules reach a model.
  if (rules.verdict !== "pass") return { terms: rules };
  let opinion: UsageModelOpinion;
  try {
    const answer = model.review(input);
    if (
      !answer ||
      !["permit", "not-decided", "prohibited"].includes(answer.effect) ||
      typeof answer.reason !== "string" ||
      answer.reason.length === 0 ||
      answer.reason.length > 2048
    )
      throw new TypeError("Invalid model opinion");
    opinion = { effect: answer.effect, reason: answer.reason };
  } catch {
    opinion = { effect: "not-decided", reason: "The model could not provide a usable opinion." };
  }
  return {
    opinion,
    terms:
      opinion.effect === "permit"
        ? rules
        : opinion.effect === "prohibited"
          ? {
              verdict: "fail",
              reason: "prohibited",
              text: "The model's opinion narrows this permitted use to prohibited.",
            }
          : {
              verdict: "indeterminate",
              reason: "indeterminate-policy",
              text: "The model's opinion leaves this permitted use not decided.",
            },
  };
}
