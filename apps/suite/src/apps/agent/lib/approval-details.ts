// AUTHORED-BY Codex GPT-6.1-Sol
import type { Mandate } from "@jeswr/agent-mandate";
import { type Approval, readApprovalClaims } from "@jeswr/agent-mandate/approval";
import { AGENT, evaluateIntent, solidOdrlEngine } from "@jeswr/agent-mandate/verify";
import type { ActionProposal, Transmission } from "@jeswr/agent-model";
import type { AgentClient } from "./client";
import { actionNames, proposalIntent } from "./mandate-rules";
import type { ProfileSession } from "./profile";
import { type DisplayApproval, readApprovals } from "./readers";
import { createAgentVerifier } from "./verify";

/** Presentation aliases only: signed action names always reach the evaluator unchanged. */
export function approvalKind(action: string): string {
  const name = action.startsWith(AGENT) ? action.slice(AGENT.length) : action;
  return (
    new Map([
      ["SendMessage", "send"],
      ["send", "send"],
      ["BookAppointment", "book"],
      ["book", "book"],
      ["Transfer", "pay"],
      ["pay", "pay"],
      ["Remember", "remember"],
      ["remember", "remember"],
      ["Connect", "connect"],
      ["connect", "connect"],
    ]).get(name) ?? "Another action"
  );
}

/** Split styling from the stored preview without reconstructing or trimming any text. */
export function previewParts(preview: string) {
  const withoutFinalNewline = preview.replace(/\r?\n$/, "");
  const lineStart = withoutFinalNewline.lastIndexOf("\n") + 1;
  const lastLine = withoutFinalNewline.slice(lineStart);
  const start =
    lastLine.includes("Sent by ") && lastLine.includes("https://jeswr.org/agent")
      ? lineStart
      : preview.length;
  return { text: preview.slice(0, start), footer: preview.slice(start) };
}

export interface ApprovalExplanation {
  reason: string;
  rule: string;
  ruleDetails?: string;
}
const REASONS = {
  "mandate-invalid": "Your agent has no verified permissions",
  "mandate-expired": "Your agent's permissions have expired",
  "mandate-not-yet-valid": "Your agent's permissions have not started yet",
  "wrong-agent": "These permissions belong to another agent",
  prohibition: "Your permissions never allow this",
  indeterminate: "Your permissions could not confirm this action",
  autonomous: "This request still needs your approval",
  "owner-approval": "Your permissions require approval for this action",
  "no-matching-rule": "No permission allows this action without asking",
};

/** Explain the verified policy, never a rule label supplied by the proposal's author. */
export async function approvalExplanation(
  mandate: Mandate | undefined,
  proposal: ActionProposal,
  now = new Date(),
): Promise<ApprovalExplanation> {
  const intent = proposalIntent(proposal, mandate?.subject ?? "", now);
  const decision = await evaluateIntent(mandate, intent);
  const reason = REASONS[decision.reason];
  if (decision.reason !== "owner-approval") return { reason, rule: reason };
  // owner-approval is returned only for a present, valid policy.
  const policy = (mandate as Mandate).withApproval;
  const rules = policy.permissions as NonNullable<typeof policy.permissions>;
  try {
    const matches = (
      await Promise.all(
        rules.map(async (rule) =>
          (await solidOdrlEngine.evaluate({ ...policy, permissions: [rule] }, intent)).effect ===
          "permit"
            ? rule
            : undefined,
        ),
      )
    ).filter((rule) => rule !== undefined);
    if (matches.length) {
      const labels = matches.map(
        (rule) =>
          Object.entries(actionNames).find(
            ([action]) => rule.action === `${AGENT}${action}`,
          )?.[1] ?? "another action",
      );
      return {
        reason,
        rule: `Asks you first: ${[...new Set(labels)].join(", ")}`,
        ruleDetails: JSON.stringify({ policy: policy.id, rules: matches }, null, 2),
      };
    }
  } catch {
    // A rule-level engine failure must not prevent the queue from loading.
  }
  return { reason: REASONS.indeterminate, rule: REASONS.indeterminate };
}

/** Activity-only history: a verified refusal remains a refusal after its validity window. */
export function readApprovalHistory(client: AgentClient, session: ProfileSession) {
  const verifier = createAgentVerifier(session);
  return readApprovals(client, {
    ...verifier,
    async verifyApproval(document, claims) {
      const result = await verifier.verifyApproval(document, claims);
      if (typeof result === "object" && result.invalid === "expired") {
        // readApprovals has already parsed these same claims successfully.
        const approval = (await readApprovalClaims(document, claims.id)) as Approval;
        if (approval.decision === "deny") {
          // Reverify the signature and current owner key within the signed validity window.
          // The actionable queue continues to use the verifier's current-time checks.
          return createAgentVerifier(
            session,
            () => new Date(Date.parse(approval.expires) - 1),
          ).verifyApproval(document, claims);
        }
      }
      return result;
    },
  });
}

/** Expiry is a view of proposal records, not an audit entry authored by the browser. */
export function expiredApprovals(
  proposals: readonly ActionProposal[],
  outbox: readonly Transmission[],
  approvals: readonly DisplayApproval[],
  now: number,
): ActionProposal[] {
  return proposals
    .filter(
      (proposal) =>
        ["proposed", "approved", "expired"].includes(proposal.state) &&
        Date.parse(proposal.validUntil) <= now &&
        !approvals.some(
          (approval) =>
            approval.approves === proposal.id &&
            approval.verification === "verified" &&
            approval.decision === "deny",
        ) &&
        !outbox.some((tx) => tx.proposal === proposal.id),
    )
    .sort((a, b) => Date.parse(b.validUntil) - Date.parse(a.validUntil));
}
