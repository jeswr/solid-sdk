// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { type ControlStatementClaims, issueControlStatement } from "@jeswr/agent-mandate/control";
import type { ActionProposal } from "@jeswr/agent-model";
import type { PodSession } from "../../../lib/session/pod-session";
import type { AgentClient } from "./client";
import { withApprovalKey } from "./keys";

export function createAgentSigner(
  session: Pick<PodSession, "fetch" | "webId">,
  client: AgentClient,
  now = () => new Date(),
) {
  return {
    async signApproval(proposal: ActionProposal, decision: "approve" | "deny") {
      if (Date.parse(proposal.validUntil) <= now().getTime())
        throw new Error("This proposal has expired.");
      if (decision === "approve" && proposal.intent.parameters.prohibited === true)
        throw new Error("Your permissions never allow this");
      const id = `${client.paths.approvals}${crypto.randomUUID()}.trig`;
      const claims = {
        id,
        approves: proposal.id,
        termsDigest: proposal.intent.termsDigest,
        expires: proposal.validUntil,
        decision,
      };
      const document = await withApprovalKey(session, (key) => issueApproval(claims, key, now()));
      await client.create(id, document, "application/trig");
      return claims;
    },
    async signControl(
      kind: ControlStatementClaims["kind"],
      fields: Pick<ControlStatementClaims, "target" | "binding" | "bindingState"> = {},
    ) {
      const at = now();
      const id = `${client.paths.control}${at.getTime()}-${kind}-${crypto.randomUUID()}.trig`;
      const claims: ControlStatementClaims = {
        ...fields,
        id,
        kind,
        attributedTo: session.webId,
        createdAt: at.toISOString(),
        expires: new Date(
          at.getTime() + (["Halt", "Resume"].includes(kind) ? 365 : 1) * 86400000,
        ).toISOString(),
      };
      const document = await withApprovalKey(session, (key) =>
        issueControlStatement(claims, key, at),
      );
      await client.create(id, document, "application/trig");
      return claims;
    },
  };
}
