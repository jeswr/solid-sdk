import { proposalContentDigest } from "../pod/digest.js";
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
 * Produce a content-locked {@link Confirmation} for a proposal, enforcing the friction. Throws
 * (fail-closed) on an insufficient acknowledgement — a confirmation is never produced without a
 * valid owner acknowledgement at the required strength. The caller writes it to the OWNER-ONLY
 * confirmations container (`writeConfirmation`).
 */
export function confirmProposal(proposal, input) {
    // RECOMPUTE the friction owner-side — never trust the Actor-written `proposal.friction`,
    // or a deceived Actor could downgrade a novel/high-value send to a one-tap confirm.
    const friction = classifyFriction(proposal);
    if (friction === "high") {
        if (input.typedAcknowledgement !== proposal.recipient) {
            throw new Error("confirmProposal: high-friction confirm requires the recipient typed back");
        }
    }
    else if (input.confirm !== true && input.typedAcknowledgement !== proposal.recipient) {
        throw new Error("confirmProposal: a confirmation is required");
    }
    return {
        proposalId: proposal.id,
        contentDigest: proposalContentDigest(proposal),
        confirmedAt: input.confirmedAt,
    };
}
//# sourceMappingURL=confirm.js.map