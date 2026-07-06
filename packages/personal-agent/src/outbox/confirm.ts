// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The GRADUATED human-confirm gate (§7). When the ODRL mandate does NOT pre-authorize an
 * action autonomously (a `confirm-required` decision), the owner must confirm it — and the
 * friction scales with the risk:
 *  - LOW (a reply to a known thread) → a simple confirm suffices;
 *  - HIGH (a novel recipient, any spend, bulk) → an EXPLICIT typed acknowledgement that echoes
 *    the recipient — never a one-tap yes.
 *
 * `confirmProposal` does NOT mutate the Actor-writable proposal (its `status` field is
 * advisory, and the Actor can write it — so it can never be the authorization). It produces a
 * {@link Confirmation}: a content-locked record the owner writes into the OWNER-ONLY
 * confirmations container (which the Actor cannot write). The executor authorizes a
 * `confirm-required` send only when a confirmation exists AND the proposal's CURRENT content
 * still hashes to the confirmed digest — so a deceived Actor can neither forge a confirmation
 * nor swap the body after it was confirmed.
 */
import type { Confirmation } from "../pod/confirmation-store.js";
import { proposalContentDigest } from "../pod/digest.js";
import type { ActionProposal, ConfirmFriction } from "../pod/proposals.js";

/**
 * Classify the confirmation friction an intent warrants. A reply to a known thread with zero
 * spend is LOW; a fresh send to a possibly-novel recipient, or any nonzero spend, is HIGH.
 */
export function classifyFriction(proposal: ActionProposal): ConfirmFriction {
  if ((proposal.spend ?? 0) > 0) return "high";
  if (!proposal.inReplyTo) return "high"; // no known thread → treat the recipient as novel
  return "low";
}

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
 * Produce a content-locked {@link Confirmation} for a proposal, enforcing the friction. Throws
 * (fail-closed) on an insufficient acknowledgement — a confirmation is never produced without a
 * valid owner acknowledgement at the required strength. The caller writes it to the OWNER-ONLY
 * confirmations container (`writeConfirmation`).
 */
export function confirmProposal(proposal: ActionProposal, input: ConfirmInput): Confirmation {
  if (proposal.friction === "high") {
    if (input.typedAcknowledgement !== proposal.recipient) {
      throw new Error("confirmProposal: high-friction confirm requires the recipient typed back");
    }
  } else if (input.confirm !== true && input.typedAcknowledgement !== proposal.recipient) {
    throw new Error("confirmProposal: a confirmation is required");
  }
  return {
    proposalId: proposal.id,
    contentDigest: proposalContentDigest(proposal),
    confirmedAt: input.confirmedAt,
  };
}
