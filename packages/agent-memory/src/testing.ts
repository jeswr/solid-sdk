// AUTHORED-BY Codex GPT-6.1-Sol
import type { RememberProposal } from "./types.js";

/** Idempotent in-memory approval queue for consumer tests; performs no approval verification. */
export function createMemoryApprovalQueue() {
  const proposals = new Map<string, RememberProposal>();
  return {
    proposals,
    queueApproval: async (proposal: RememberProposal): Promise<void> => {
      proposals.set(proposal.id, structuredClone(proposal));
    },
  };
}
