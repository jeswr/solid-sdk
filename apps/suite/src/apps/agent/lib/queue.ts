// AUTHORED-BY Codex GPT-6.1-Sol
import type { ActionProposal, Approval, Transmission } from "@jeswr/agent-model";
export interface PendingApproval {
  proposal: ActionProposal;
  reason: string;
  expiresIn: number;
  approvedAwaitingSend: boolean;
  needsNewApproval: boolean;
}
/** Claims are displayed unchecked in P1; this reducer confers no authority to send. */
export function pendingApprovals(
  proposals: readonly ActionProposal[],
  approvals: readonly Approval[],
  transmissions: readonly Transmission[],
  now: number,
): PendingApproval[] {
  return proposals
    .flatMap((proposal) => {
      if (
        proposal.state !== "proposed" ||
        Date.parse(proposal.validUntil) <= now ||
        transmissions.some((t) => t.proposal === proposal.id && t.status === "sent")
      )
        return [];
      const decisions = approvals
        .filter(
          (a) =>
            a.approves === proposal.id &&
            Date.parse(a.expires) > now &&
            Date.parse(a.createdAt) <= now,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const current = decisions.find((a) => a.termsDigest === proposal.intent.termsDigest);
      if (current?.decision === "deny") return [];
      const needsNewApproval =
        !current && decisions.some((a) => a.termsDigest !== proposal.intent.termsDigest);
      return [
        {
          proposal,
          reason:
            proposal.intent.parameters.prohibited === true
              ? "prohibited"
              : needsNewApproval
                ? "Needs a new approval"
                : "confirm-required",
          expiresIn: Date.parse(proposal.validUntil) - now,
          approvedAwaitingSend: current?.decision === "approve",
          needsNewApproval,
        },
      ];
    })
    .sort((a, b) => Date.parse(b.proposal.createdAt) - Date.parse(a.proposal.createdAt));
}
