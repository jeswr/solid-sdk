// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, podRecordSchema } from "@jeswr/agent-model";
import { z } from "zod";
import type { ProposalResult } from "./types.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resultSchema = z.strictObject({
  proposals: z.array(
    podRecordSchema.transform((record) => {
      if (record.type !== "action-proposal" || record.state !== "proposed")
        throw new Error("Invalid cached proposal");
      return record;
    }),
  ),
  calls: z.array(
    z.strictObject({
      id: z.string(),
      context: z.enum(["reader", "proposer"]),
      provider: z.enum(["openai", "anthropic"]),
      model: z.string(),
      tokens: z.strictObject({ input: count, output: count }),
      inputTokens: count,
      outputTokens: count,
      toolCalls: count,
      latencyMs: z.number().nonnegative().finite(),
      retries: count,
    }),
  ),
});

export function checkedProposalResult(value: unknown): ProposalResult {
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > 1024 * 1024) throw new Error("Proposal result exceeds bound");
  return resultSchema.parse(JSON.parse(json));
}
export function proposalResultKey(key: string): string {
  if (!/^sha-256:[a-f0-9]{64}$/.test(key)) throw new Error("Invalid proposal result key");
  return key.slice(8);
}
