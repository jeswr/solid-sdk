// AUTHORED-BY Codex GPT-6
import type { ActionProposal, Transmission } from "@jeswr/agent-model";
import type { DisplayApproval } from "./readers";

export type ProposalCardState =
  | "pending"
  | "renew"
  | "approved"
  | "sent"
  | "denied"
  | "failed"
  | "expired";
/** States in which the owner can still approve or deny. */
export const DECIDABLE_STATES: readonly ProposalCardState[] = ["pending", "renew"];
export const PROPOSAL_STATE_LABELS: Record<ProposalCardState, string> = {
  pending: "Awaiting your approval",
  renew: "Needs a new approval",
  approved: "Approved, waiting for the agent",
  sent: "Sent",
  denied: "Denied",
  failed: "Sending failed or couldn't be confirmed",
  expired: "This proposal has expired",
};

/** Display state only. Approval verification and send authorization remain in P2/the daemon. */
export function proposalCardState(
  proposal: ActionProposal,
  approvals: readonly DisplayApproval[],
  outbox: readonly Transmission[],
  now: number,
): ProposalCardState {
  const transmissions = outbox
    .filter((t) => t.proposal === proposal.id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (proposal.state === "sent" || transmissions.some((t) => t.status === "sent")) return "sent";
  if (proposal.state === "failed" || proposal.state === "denied") return proposal.state;
  const verified = approvals
    .filter(
      (a) =>
        a.approves === proposal.id &&
        a.verification === "verified" &&
        Date.parse(a.createdAt) <= now &&
        Date.parse(a.expires) > now,
    )
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.decision === "deny" ? -1 : 1),
    );
  const approval = verified.find((a) => a.termsDigest === proposal.intent.termsDigest);
  // Approvals exist only for earlier terms: the owner changed the proposal after deciding.
  const renew = !approval && verified.length > 0;
  const latest = transmissions[0];
  // A failed send stops counting once a newer decision or changed terms supersede it.
  // A failed send stops counting once a newer decision or changed terms supersede it. The
  // daemon links a transmission to its approval; compare clocks only without that link.
  const superseded =
    renew ||
    (approval !== undefined &&
      (latest?.underApproval !== undefined
        ? latest.underApproval !== approval.id
        : Date.parse(approval.createdAt) > Date.parse(latest?.startedAt ?? "")));
  if (latest && ["not-sent", "refused", "uncertain"].includes(latest.status) && !superseded)
    return "failed";
  if (approval) return approval.decision === "approve" ? "approved" : "denied";
  if (proposal.state === "approved" || proposal.state === "expired") return proposal.state;
  if (Date.parse(proposal.validUntil) <= now) return "expired";
  return renew ? "renew" : "pending";
}
