// AUTHORED-BY Codex GPT-6.2 Sol
import { digestOf } from "@jeswr/agent-model";
import { generateSigningKey, signCompact } from "@jeswr/agent-reference";
import type { Gate } from "../src/gate.js";

/** Supply record capabilities to fixtures that deliberately stub channel and send policy. */
export function testRecordPort(agent: string, owner: string): Pick<Gate, "head" | "anchor"> {
  let seq = 0;
  let keys: ReturnType<typeof generateSigningKey> | undefined;
  return {
    head() {
      seq++;
      return { seq, hash: digestOf({ agent, seq }) };
    },
    async anchor(head) {
      keys ??= generateSigningKey();
      const { key } = await keys;
      return signCompact(key, "awp-record-anchor+jws", {
        type: "RecordAnchorReceipt",
        actor: agent,
        party: owner,
        subject: agent,
        subjectParty: owner,
        ...head,
        at: "2026-11-01T12:00:00.000Z",
      });
    },
  };
}
