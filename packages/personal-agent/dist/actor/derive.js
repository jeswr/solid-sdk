// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { vocab } from "@jeswr/agentic-legacy-bridge";
import { AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";
import { isDeterministic, } from "./interpretations.js";
const DEFAULT_MIN_CONFIDENCE = 0.9;
const MAX_OFFERED = 8;
/** Format a deterministic scheduling-reply body listing the offered times. */
function schedulingBody(times) {
    const list = times.map((t) => t.startTime).join(", ");
    return `Thanks for your message. I can offer these times (UTC): ${list}. Let me know which works best.`;
}
/**
 * Derive deterministic proposals from landed interpretations. Returns `[]` when there is no
 * deterministic, high-confidence, actionable signal (or no sender to reply to).
 */
export function deriveProposals(interps, context) {
    const recipient = context.inbound.senderEmail;
    if (!recipient)
        return []; // no reply address → nothing to propose autonomously
    const minConfidence = context.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const times = [];
    const seen = new Set();
    for (const interp of interps) {
        if (times.length >= MAX_OFFERED)
            break;
        if (!isDeterministic(interp) || interp.confidence < minConfidence)
            continue;
        if (interp.assertsPredicate !== vocab.SCHEMA_START_TIME)
            continue;
        const start = interp.assertsObjectLiteral;
        if (typeof start !== "string" || start.length === 0 || seen.has(start))
            continue;
        seen.add(start);
        times.push({ startTime: start });
    }
    if (times.length === 0)
        return [];
    const proposal = {
        id: `${context.idPrefix}-sched`,
        channel: "email",
        recipient,
        odrlAction: "distribute",
        purpose: AGENTIC_PURPOSE_SCHEDULING,
        spend: 0,
        status: "pending",
        friction: "low",
        bodyText: schedulingBody(times),
        offeredTimes: times,
        proposedAt: context.now.toISOString(),
        ...(context.inbound.rawAnchor
            ? { inReplyTo: context.inbound.rawAnchor, derivedFrom: context.inbound.rawAnchor }
            : {}),
    };
    return [proposal];
}
//# sourceMappingURL=derive.js.map