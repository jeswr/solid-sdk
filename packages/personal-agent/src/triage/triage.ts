/**
 * Triage of ONE message sample into a constrained, reviewable suggestion.
 *
 * Order (deterministic first):
 *  1. Text carrying an agent-protocol MARKER (a signed envelope format, the email binding's
 *     `SignedMessage` carrier, an unsigned public request, X-AWP-* headers) is routed to the
 *     protocol path and NEVER classified. The marker is not verification: the agent's protocol
 *     validation (signatures, trust and permission checks) decides what the message is. Routing
 *     conservatively only means a classifier can never be asked about such traffic.
 *  2. The local deterministic baseline always runs.
 *  3. A hosted classifier runs only if the caller passes an explicit permission (owner setting,
 *     server key and per-sample consent — decided by the caller). Its answers are validated and
 *     thresholded; failure, invalid answers or low confidence mean "ask the owner".
 * No suggestion authorises anything (`mayAct: false`).
 */
import type { TriageClassifier } from "./classifier.js";
import { ClassifierError } from "./classifier.js";
import { baselineTriage } from "./deterministic.js";
import {
  DEFAULT_THRESHOLDS,
  type Sample,
  sampleSchema,
  type TriageSuggestion,
} from "./taxonomy.js";

/** True if the text carries (or claims to carry) an agent-protocol message. */
export function isAgentProtocolMessage(text: string): boolean {
  return (
    /awp-jws-compact\/0\.1|awp-unsigned-json\/0\.1/.test(text) ||
    /"@type"\s*:\s*"SignedMessage"/.test(text) ||
    /\bX-AWP-(Profile|Conversation|Message)\s*:/i.test(text)
  );
}

export interface HostedRequest {
  classifier: TriageClassifier;
  /** The caller's decision (owner setting + key + consent + account permission). */
  allowed: boolean;
  why: string;
}

export async function triageSample(
  input: Sample,
  hosted?: HostedRequest,
  thresholds = DEFAULT_THRESHOLDS,
): Promise<TriageSuggestion> {
  const sample = sampleSchema.parse(input);
  if (isAgentProtocolMessage(`${sample.subject}\n${sample.body}`)) {
    return {
      route: "agent-protocol",
      primary: "uncertain",
      urgency: "uncertain",
      needsReply: "uncertain",
      confidence: { primary: null, urgency: null, needsReply: null },
      source: "none",
      askOwner: [],
      reasons: [
        "Possible structured agent message: it carries an agent-protocol marker, which proves nothing by itself. It is not classified; the agent's protocol validation (signature, trust and permission checks) decides what it is and what may happen.",
      ],
      mayAct: false,
      hosted: { status: "not-requested", detail: "not used for agent messages" },
    };
  }
  const base = baselineTriage(sample);
  const reasons = [
    `Local rules: ${base.primaryRule}; ${base.urgencyRule}.`,
    "Local rules are a simple baseline, so their confidence is deliberately low.",
  ];
  let hostedStatus: TriageSuggestion["hosted"] = {
    status: "not-requested",
    detail: "hosted triage was not requested",
  };
  if (hosted && !hosted.allowed) hostedStatus = { status: "not-allowed", detail: hosted.why };
  if (hosted?.allowed) {
    try {
      const a = await hosted.classifier.classify(sample);
      const ask: string[] = [];
      // Both the chosen label's probability and the provider's confidence must clear the
      // (uncalibrated) threshold; the model's own "uncertain" label is an abstention.
      const primaryOk =
        a.primary.label !== "uncertain" &&
        a.primary.probability >= thresholds.primary &&
        a.primary.confidence >= thresholds.primary;
      const urgencyOk =
        a.urgency.probability >= thresholds.urgency && a.urgency.confidence >= thresholds.urgency;
      const primaryLabel = a.primary.label === "uncertain" ? undefined : a.primary.label;
      const needsReply =
        a.needsReply >= thresholds.needsReplyYes
          ? "yes"
          : a.needsReply <= thresholds.needsReplyNo
            ? "no"
            : "uncertain";
      if (!primaryOk) ask.push("classification");
      if (!urgencyOk) ask.push("priority");
      if (needsReply === "uncertain") ask.push("whether a reply is needed");
      return {
        route: "suggestion",
        primary: primaryOk && primaryLabel ? primaryLabel : "uncertain",
        ...(!primaryOk && primaryLabel ? { primaryCandidate: primaryLabel } : {}),
        urgency: urgencyOk ? a.urgency.label : "uncertain",
        needsReply,
        confidence: {
          primary: a.primary.confidence,
          urgency: a.urgency.confidence,
          needsReply: a.needsReply,
        },
        probability: { primary: a.primary.probability, urgency: a.urgency.probability },
        distribution: { primary: a.primary.probabilities, urgency: a.urgency.probabilities },
        source: "typesafe",
        model: a.model,
        askOwner: ask,
        reasons: [
          `${hosted.classifier.provider} (${a.model}) answered; answers below the uncalibrated thresholds, or where it abstained, are marked uncertain.`,
        ],
        mayAct: false,
        hosted: { status: "ok", detail: `answered by ${a.model}` },
      };
    } catch (error) {
      const code = error instanceof ClassifierError ? error.code : "unavailable";
      hostedStatus = {
        status: code === "invalid-response" ? "invalid-response" : "failed",
        detail:
          error instanceof ClassifierError
            ? error.message
            : "the hosted classifier failed; using local rules only",
      };
      reasons.push(`Hosted triage did not answer (${hostedStatus.detail}); the owner is asked.`);
    }
  }
  const confident = base.confidence >= thresholds.primary;
  return {
    route: "suggestion",
    primary: confident ? base.primary : "uncertain",
    ...(confident ? {} : { primaryCandidate: base.primary }),
    urgency: base.confidence >= thresholds.urgency ? base.urgency : "uncertain",
    needsReply: "uncertain",
    confidence: { primary: base.confidence, urgency: base.confidence, needsReply: null },
    source: "deterministic-baseline",
    askOwner: ["classification", "priority", "whether a reply is needed"],
    reasons,
    mayAct: false,
    hosted: hostedStatus,
  };
}
