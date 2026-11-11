// AUTHORED-BY Codex GPT-6.1-Sol
import type { Mandate } from "@jeswr/agent-mandate";
import { AGENT, evaluateIntent, solidOdrlEngine } from "@jeswr/agent-mandate/verify";
import type { ActionProposal, Transmission } from "@jeswr/agent-model";
import { proposalIntent } from "./mandate-rules";

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
  const matches = await Promise.all(
    rules.map(async (rule, index) =>
      (await solidOdrlEngine.evaluate({ ...policy, permissions: [rule] }, intent)).effect ===
      "permit"
        ? index + 1
        : undefined,
    ),
  );
  return {
    reason,
    rule: `Ask first · rule ${matches.filter((index) => index !== undefined).join(", ")}`,
    ruleDetails: JSON.stringify(
      { policy: policy.id, rules: rules.filter((_, index) => matches.includes(index + 1)) },
      null,
      2,
    ),
  };
}

/** Expiry is a view of proposal records, not an audit entry authored by the browser. */
export function expiredApprovals(
  proposals: readonly ActionProposal[],
  outbox: readonly Transmission[],
  now: number,
): ActionProposal[] {
  return proposals
    .filter(
      (proposal) =>
        ["proposed", "approved", "expired"].includes(proposal.state) &&
        Date.parse(proposal.validUntil) <= now &&
        !outbox.some((tx) => tx.proposal === proposal.id),
    )
    .sort((a, b) => Date.parse(b.validUntil) - Date.parse(a.validUntil));
}
