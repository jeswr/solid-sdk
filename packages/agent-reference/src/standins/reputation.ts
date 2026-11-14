// AUTHORED-BY Codex GPT-6
import type { EvidenceItem } from "../core/types.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { signStatement } from "../mechanisms/statements.js";
export async function issueAgentRating(
  key: SigningKey,
  input: { service: string; party: string; actor: string; kid: string; score: number; at: string },
): Promise<EvidenceItem> {
  return {
    role: "membership",
    format: "agent-reputation+jws",
    value: await signStatement(key, "awp-agent-reputation+jws", {
      type: "AgentReputation",
      issuer: input.service,
      subject: input.party,
      actor: input.actor,
      subjectKey: input.kid,
      score: input.score,
      method: "evidence-reviewed-agent-behaviour",
      evidence: ["urn:fictional:agent-behaviour-review"],
      issuedAt: input.at,
      validUntil: new Date(Date.parse(input.at) + 86400000).toISOString(),
    }),
  };
}
