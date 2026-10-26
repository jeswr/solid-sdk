// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6
/**
 * The GRADUATED human-confirm gate (§7). When the ODRL mandate does NOT pre-authorize an
 * action autonomously (a `confirm-required` decision), the owner must confirm it — and the
 * gate requires an EXPLICIT typed acknowledgement that echoes the recipient. Low friction
 * would require Reader-owned evidence binding both the thread and recipient; this synchronous
 * API has no such evidence source, so it always requires high friction.
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
 * Actor-written linkage, provenance and friction cannot establish a known thread or recipient.
 * Without independently verified Reader evidence, every intent requires HIGH friction.
 */
export function classifyFriction(_proposal: ActionProposal): ConfirmFriction {
  return "high";
}

/** The owner's acknowledgement. High-friction requires `typedAcknowledgement`. */
export interface ConfirmInput {
  /** A simple confirm. Insufficient without independently verified Reader evidence. */
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
  if (input.typedAcknowledgement !== proposal.recipient) {
    throw new Error("confirmProposal: high-friction confirm requires the recipient typed back");
  }
  return {
    proposalId: proposal.id,
    contentDigest: proposalContentDigest(proposal),
    confirmedAt: input.confirmedAt,
  };
}
