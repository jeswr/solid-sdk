/**
 * The GRADUATED human-confirm gate (§7). When the ODRL mandate does NOT pre-authorize an
 * action autonomously (a `confirm-required` decision), the owner must confirm it — and the
 * confirmation friction scales with the risk:
 *  - LOW friction (a reply to a known thread) → a simple confirm suffices;
 *  - HIGH friction (a novel recipient, any spend, bulk) → an EXPLICIT typed acknowledgement
 *    that echoes the recipient — never a one-tap yes.
 *
 * `confirmProposal` is the ONLY sanctioned `pending → confirmed` transition, and it is a pure
 * function of the proposal + the owner's acknowledgement (the human UI that collects the ack
 * is out of M1 scope). The outbox executor then treats `confirmed` as the owner's authorizing
 * event for a `confirm-required` intent.
 */
import type { ActionProposal, ConfirmFriction } from "../pod/proposals.js";
/**
 * Classify the confirmation friction an intent warrants. A reply to a known thread with zero
 * spend is LOW; a fresh send to a possibly-novel recipient, or any nonzero spend, is HIGH.
 */
export declare function classifyFriction(proposal: ActionProposal): ConfirmFriction;
/** The owner's acknowledgement. High-friction requires `typedAcknowledgement`. */
export interface ConfirmInput {
    /** A simple confirm — sufficient for LOW friction. */
    readonly confirm?: boolean;
    /** An explicit typed acknowledgement — REQUIRED for HIGH friction; must echo the recipient. */
    readonly typedAcknowledgement?: string;
    /** When the owner confirmed (ISO-8601). */
    readonly confirmedAt: string;
}
/**
 * Transition a `pending` proposal to `confirmed`, enforcing the friction. Throws (fail-closed)
 * on a non-pending proposal or an insufficient acknowledgement — a proposal never becomes
 * `confirmed` without a valid owner acknowledgement at the required strength.
 */
export declare function confirmProposal(proposal: ActionProposal, input: ConfirmInput): ActionProposal;
/** Transition a `pending` proposal to `rejected` (the owner declined). */
export declare function rejectProposal(proposal: ActionProposal, note?: string): ActionProposal;
//# sourceMappingURL=confirm.d.ts.map