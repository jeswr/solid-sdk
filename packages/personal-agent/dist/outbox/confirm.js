/**
 * Classify the confirmation friction an intent warrants. A reply to a known thread with zero
 * spend is LOW; a fresh send to a possibly-novel recipient, or any nonzero spend, is HIGH.
 */
export function classifyFriction(proposal) {
    if ((proposal.spend ?? 0) > 0)
        return "high";
    if (!proposal.inReplyTo)
        return "high"; // no known thread → treat the recipient as novel
    return "low";
}
/**
 * Transition a `pending` proposal to `confirmed`, enforcing the friction. Throws (fail-closed)
 * on a non-pending proposal or an insufficient acknowledgement — a proposal never becomes
 * `confirmed` without a valid owner acknowledgement at the required strength.
 */
export function confirmProposal(proposal, input) {
    if (proposal.status !== "pending") {
        throw new Error(`confirmProposal: cannot confirm a proposal in status "${proposal.status}"`);
    }
    const friction = proposal.friction;
    if (friction === "high") {
        if (input.typedAcknowledgement !== proposal.recipient) {
            throw new Error("confirmProposal: high-friction confirm requires the recipient typed back");
        }
    }
    else if (input.confirm !== true && input.typedAcknowledgement !== proposal.recipient) {
        throw new Error("confirmProposal: a confirmation is required");
    }
    return { ...proposal, status: "confirmed", confirmedAt: input.confirmedAt };
}
/** Transition a `pending` proposal to `rejected` (the owner declined). */
export function rejectProposal(proposal, note) {
    return {
        ...proposal,
        status: "rejected",
        ...(note ? { note } : {}),
    };
}
//# sourceMappingURL=confirm.js.map