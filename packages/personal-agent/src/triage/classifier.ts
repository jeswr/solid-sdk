/**
 * Provider-neutral classifier boundary for UNSTRUCTURED messages. A classifier returns
 * constrained, validated answers; everything it says is a suggestion. It is never consulted for
 * possible agent-protocol messages and never participates in trust, permission or policy
 * decisions.
 */
import type { PrimaryClass, Sample, UrgencyClass } from "./taxonomy.js";

/** One validated `choice` answer. */
export interface ChoiceAnswer<L extends string> {
  label: L;
  /** Probability the provider assigned to the chosen label. */
  probability: number;
  /** The provider's distribution-shape statistic (NOT the chosen label's probability). */
  confidence: number;
  /** The complete distribution over the requested labels (kept for review and evaluation). */
  probabilities: Record<L, number>;
}

export interface ClassifierAnswer {
  /** `uncertain` is a requested abstention label: the provider itself declined to pick. */
  primary: ChoiceAnswer<PrimaryClass | "uncertain">;
  urgency: ChoiceAnswer<UrgencyClass>;
  /** Probability that the sender expects a reply. */
  needsReply: number;
  /** The exact model version that answered (equal to the pinned version requested). */
  model: string;
}

export class ClassifierError extends Error {
  constructor(
    readonly code:
      | "timeout"
      | "network"
      | "rejected"
      | "rate-limited"
      | "unavailable"
      | "invalid-response",
    message: string,
  ) {
    super(message);
    this.name = "ClassifierError";
  }
}

export interface TriageClassifier {
  /** Human name of the provider, e.g. "TypeSafe". */
  readonly provider: string;
  /** The pinned model requested. */
  readonly model: string;
  classify(sample: Sample): Promise<ClassifierAnswer>;
}
