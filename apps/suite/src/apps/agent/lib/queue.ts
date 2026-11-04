// AUTHORED-BY Codex GPT-6.1-Sol
import type { ActionProposal, Transmission } from "@jeswr/agent-model";
import type { DisplayApproval } from "./readers";
export interface PendingApproval {
  proposal: ActionProposal;
  reason: string;
  expiresIn: number;
  approvedAwaitingSend: boolean;
  needsNewApproval: boolean;
  state: "pending" | "approved" | "denied" | "sent";
  verification: DisplayApproval["verification"];
}
/** Display reducer. Only verified approvals may settle the queue; it never grants send authority. */
export function pendingApprovals(
  proposals: readonly ActionProposal[],
  approvals: readonly DisplayApproval[],
  transmissions: readonly Transmission[],
  now: number,
  complete = true,
): PendingApproval[] {
  // No decision or transmission may settle a proposal from incomplete evidence.
  approvals = complete ? approvals : [];
  transmissions = complete ? transmissions : [];
  return proposals
    .flatMap((proposal): PendingApproval[] => {
      if (proposal.state !== "proposed" || Date.parse(proposal.validUntil) <= now) return [];
      const decisions = approvals
        .filter(
          (a) =>
            a.approves === proposal.id &&
            a.verification === "verified" &&
            Date.parse(a.expires) > now &&
            Date.parse(a.createdAt) <= now,
        )
        .sort(
          (a, b) =>
            Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.decision === "deny" ? -1 : 1),
        );
      const current = decisions.find((a) => a.termsDigest === proposal.intent.termsDigest);
      const needsNewApproval =
        !current && decisions.some((a) => a.termsDigest !== proposal.intent.termsDigest);
      const sent = transmissions.some(
        (t) =>
          t.proposal === proposal.id &&
          t.status === "sent" &&
          !!current &&
          t.underApproval === current.id,
      );
      const state = sent
        ? "sent"
        : current?.decision === "approve"
          ? "approved"
          : current?.decision === "deny"
            ? "denied"
            : "pending";
      return [
        {
          proposal,
          state,
          reason:
            proposal.intent.parameters.prohibited === true
              ? "Never"
              : needsNewApproval
                ? "Needs a new approval"
                : "Ask first",
          expiresIn: Date.parse(proposal.validUntil) - now,
          approvedAwaitingSend: state === "approved",
          needsNewApproval,
          verification:
            current?.verification ??
            approvals.find((a) => a.approves === proposal.id)?.verification ??
            "unchecked",
        },
      ];
    })
    .sort((a, b) => Date.parse(b.proposal.createdAt) - Date.parse(a.proposal.createdAt));
}
export function canBulkApprove(rows: readonly PendingApproval[]) {
  const first = rows[0];
  return (
    !!first &&
    rows.every(
      (row) =>
        row.state === "pending" &&
        row.reason !== "Never" &&
        row.proposal.intent.action === first.proposal.intent.action &&
        row.proposal.intent.recipientHash === first.proposal.intent.recipientHash,
    )
  );
}
