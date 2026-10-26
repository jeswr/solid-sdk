// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6
/**
 * The Actor's DETERMINISTIC proposal derivation (§5.1 hot path). Given the reified
 * interpretations the Reader landed and the inbound context, it produces
 * {@link ActionProposal} INTENTS with ZERO LLM tokens: today it recognises proposed
 * meeting times (deterministic, high-confidence `schema:startTime` assertions) and drafts a
 * single scheduling-reply intent back to the sender. Every proposal it mints is only a
 * PROPOSAL — the outbox executor decides (via the ODRL mandate) whether it may be sent.
 *
 * Residual/ambiguous prose is deliberately NOT handled here — that is the guarded LLM
 * fallback (the bridge's `LlmInterpreter` seam), out of the deterministic path.
 */
import { classifyReliability, vocab } from "@jeswr/agentic-legacy-bridge";
import type { ActionProposal, OfferedTime } from "../pod/proposals.js";
import { AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";
import {
  type InboundContext,
  isDeterministic,
  type ReadInterpretation,
} from "./interpretations.js";

const DEFAULT_MIN_CONFIDENCE = 0.9;
const MAX_OFFERED = 8;

/** Context for {@link deriveProposals}. */
export interface DeriveContext {
  /** The inbound message context (sender + raw anchor). */
  readonly inbound: InboundContext;
  /** A stable, url-slug-safe id base (the inbox resource slug) → deterministic proposal ids. */
  readonly idPrefix: string;
  /** "Now" (proposal creation time). */
  readonly now: Date;
  /** The minimum confidence a deterministic signal must carry (default 0.9). */
  readonly minConfidence?: number;
}

/** Format a deterministic scheduling-reply body listing the offered times. */
function schedulingBody(times: readonly OfferedTime[]): string {
  const list = times.map((t) => t.startTime).join(", ");
  return `Thanks for your message. I can offer these times (UTC): ${list}. Let me know which works best.`;
}

/**
 * Derive deterministic proposals from landed interpretations. Returns `[]` when there is no
 * deterministic, high-confidence, actionable signal (or no sender to reply to).
 */
export function deriveProposals(
  interps: readonly ReadInterpretation[],
  context: DeriveContext,
): ActionProposal[] {
  const recipient = context.inbound.senderEmail;
  if (!recipient) return []; // no reply address → nothing to propose autonomously
  const minConfidence = context.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  const times: OfferedTime[] = [];
  let confirmationRequired = false;
  const seen = new Set<string>();
  for (const interp of interps) {
    if (times.length >= MAX_OFFERED) break;
    if (!isDeterministic(interp) || interp.confidence < minConfidence) continue;
    if (interp.assertsPredicate !== vocab.SCHEMA_START_TIME) continue;
    const start = interp.assertsObjectLiteral;
    if (typeof start !== "string" || start.length === 0 || seen.has(start)) continue;
    const calibration =
      interp.calibration === vocab.AGENTIC_CALIBRATED
        ? "Calibrated"
        : interp.calibration === vocab.AGENTIC_VERIFIED
          ? "Verified"
          : "SelfReported";
    const reliability = classifyReliability({
      confidence: interp.confidence,
      calibration,
      securityBearing: interp.securityBearing,
    });
    if (reliability === "audit") continue;
    if (reliability !== "auto") confirmationRequired = true;
    seen.add(start);
    times.push({ startTime: start });
  }
  if (times.length === 0) return [];

  const proposal: ActionProposal = {
    id: `${context.idPrefix}-sched`,
    channel: "email",
    recipient,
    odrlAction: "distribute",
    purpose: AGENTIC_PURPOSE_SCHEDULING,
    spend: 0,
    status: "pending",
    friction: "low",
    ...(confirmationRequired ? { confirmationRequired: true } : {}),
    bodyText: schedulingBody(times),
    offeredTimes: times,
    proposedAt: context.now.toISOString(),
    ...(context.inbound.rawAnchor
      ? { inReplyTo: context.inbound.rawAnchor, derivedFrom: context.inbound.rawAnchor }
      : {}),
  };
  return [proposal];
}
