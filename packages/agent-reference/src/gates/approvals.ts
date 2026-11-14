// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import type { ActionIntent } from "../core/types.js";
import type { GateMemory } from "./common.js";
export const organisationApprovalSchema = z.strictObject({
  type: z.literal("OrganisationApproval"),
  id: z.string(),
  signer: z.string(),
  actor: z.string(),
  actionDigest: z.string(),
  conversation: z.string(),
  issuedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type OrganisationApproval = z.infer<typeof organisationApprovalSchema> & {
  kid: string;
  jws?: string;
  releaseBinding?: import("./approval-release.js").ApprovalReleaseBinding;
};
export interface ApprovalsRule {
  count: number;
  roles: readonly string[];
  distinctFromRequester: boolean;
}
export function checkOrganisationApprovals(input: {
  intent: ActionIntent;
  rule: ApprovalsRule;
  approvals: readonly OrganisationApproval[];
  memory: GateMemory;
  task: string;
  organization: string;
  requester: string;
  at: string;
}): "pass" | "missing" | "invalid" {
  if (input.rule.distinctFromRequester && !input.requester) return "invalid";
  const signers = new Set<string>();
  const keys = new Set<string>();
  for (const approval of input.approvals) {
    if (
      Date.parse(approval.validUntil) <= Date.parse(input.at) ||
      Date.parse(approval.issuedAt) > Date.parse(input.at)
    )
      return "invalid";
    if (
      input.rule.distinctFromRequester &&
      (approval.signer === input.requester || approval.kid === input.requester)
    )
      return "invalid";
    const roles = input.memory
      .context(input.task)
      .filter(
        (item) =>
          item.accepted === true &&
          item.claimType === "organization.role" &&
          input.memory.facts.get(item.id)?.digest === item.digest,
      );
    const role = roles.find((item) => {
      const s = item.statement;
      return (
        s &&
        s.subjectKey === approval.kid &&
        s.subject === approval.signer &&
        s.organization === input.organization &&
        input.rule.roles.includes(String(s.role)) &&
        s.status === "active" &&
        Date.parse(String(s.validFrom)) <= Date.parse(input.at) &&
        Date.parse(String(s.validUntil)) > Date.parse(input.at)
      );
    });
    if (!role) return "invalid";
    // A later admitted withdrawal prevails even if an older grant remains unexpired.
    if (
      roles.some(
        (item) =>
          item.statement?.subjectKey === approval.kid &&
          item.statement?.organization === input.organization &&
          item.statement?.status === "withdrawn",
      )
    )
      return "invalid";
    signers.add(approval.signer);
    keys.add(approval.kid);
  }
  return Math.min(signers.size, keys.size) >= input.rule.count ? "pass" : "missing";
}
