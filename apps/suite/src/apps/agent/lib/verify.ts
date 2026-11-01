// AUTHORED-BY Codex GPT-6.1-Sol
import { verifyApproval } from "@jeswr/agent-mandate/approval";
import { verifyControlStatement } from "@jeswr/agent-mandate/control";
import { createWebIdKeyResolver } from "@jeswr/solid-vc";
import type { PodSession } from "../../../lib/session/pod-session";

export type Verification = "verified" | "unchecked" | { invalid: string };
export function createAgentVerifier(
  session: Pick<PodSession, "fetch" | "webId">,
  now = () => new Date(),
) {
  // Each call gets a fresh profile snapshot, so key revocations cannot live in a UI cache.
  const options = () => ({
    ownerWebId: session.webId,
    webIdKeyResolver: createWebIdKeyResolver({ fetch: session.fetch }),
    now,
  });
  return {
    async verifyApproval(
      document: string,
      claims: { id: string; approves: string; termsDigest: string },
    ): Promise<Verification> {
      const result = await verifyApproval(document, {
        ...options(),
        id: claims.id,
        proposal: claims.approves,
        termsDigest: claims.termsDigest,
      });
      return result.valid ? "verified" : { invalid: result.reason };
    },
    async verifyControl(document: string, id: string): Promise<Verification> {
      const result = await verifyControlStatement(document, { ...options(), id });
      return result.valid ? "verified" : { invalid: result.reason };
    },
  };
}
export type AgentVerifier = ReturnType<typeof createAgentVerifier>;
