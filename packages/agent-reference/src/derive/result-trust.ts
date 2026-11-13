// AUTHORED-BY Codex GPT-6
/** Research-grade, unaudited; sparq commitment-signed credentials (not standard VCs);
 * test-only issuer keys. Authenticate public inputs from admitted statements. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import type { GateMemory, RelianceProfile } from "../gates/common.js";
import { evaluateItemTerms, fitnessOf } from "../gates/quality.js";
import { StatementQualityNode } from "../model/quality.js";
import {
  resultPolicy,
  resultPublicKey,
  resultSnapshot,
  SPARQ_ZK_RESULT,
} from "./adapters/sparq-zk-result.js";

const keyStatement = z.strictObject({
  method: z.literal(SPARQ_ZK_RESULT.method),
  publicKey: z.string(),
  statusLists: z.array(z.string()),
});
const snapshotStatement = resultSnapshot.extend({ method: z.literal(SPARQ_ZK_RESULT.method) });

/** Only previously admitted source statements authenticate these inputs. A key or
 * snapshot asserted inside a presentation never becomes receiver policy. */
export function admittedResultPolicy(
  memory: GateMemory,
  candidate: unknown,
  keys: readonly { issuer: string; key: unknown }[],
  use: { agent: string; purpose?: string; at: string; reliance?: RelianceProfile },
) {
  const parsed = resultPolicy.safeParse(candidate);
  if (!parsed.success)
    return {
      ok: false as const,
      reason: "source-not-accepted",
      detail: "Receiver policy is not an authenticated result-proof policy.",
    };
  const policy = parsed.data;
  const facts = [...memory.facts.values()].filter(
    (fact) =>
      fact.statement &&
      fact.admittedPurpose === use.purpose &&
      fitnessOf(
        StatementQualityNode.from({ ...fact.statement, claimType: fact.claimType }),
        use.reliance,
        use.at,
      ).verdict === "pass" &&
      evaluateItemTerms(fact.terms, {
        agent: use.agent,
        action: "use",
        target: fact.id,
        purpose: use.purpose,
        at: use.at,
      }).verdict === "pass",
  );
  const bindings = policy.trustedIssuers.map((publicKey) => {
    const pinned = keys.find((k) => resultPublicKey.safeParse(k.key).data?.publicKey === publicKey);
    if (!pinned) return undefined;
    return facts.flatMap((f) => {
      const value = keyStatement.safeParse(f.statement?.value);
      return f.claimType === "proof.issuer-key" &&
        f.source === pinned.issuer &&
        f.subject === pinned.issuer &&
        f.method === "recorded-by-authority" &&
        value.success &&
        f.digest === digestOf(f.statement) &&
        value.data.publicKey === publicKey
        ? [{ issuer: pinned.issuer, value: value.data }]
        : [];
    })[0];
  });
  if (bindings.some((b) => !b))
    return {
      ok: false as const,
      reason: "source-not-accepted",
      detail: "A trusted result issuer key has no admitted identity-signed key statement.",
    };
  for (const snapshot of policy.snapshots) {
    const bound = bindings.filter((b) => b?.value.statusLists.includes(snapshot.status_list));
    if (
      bound.length !== 1 ||
      !facts.some((f) => {
        const value = snapshotStatement.safeParse(f.statement?.value);
        return (
          f.claimType === "proof.status" &&
          f.source === bound[0]?.issuer &&
          f.subject === bound[0]?.issuer &&
          f.method === "recorded-by-authority" &&
          value.success &&
          f.digest === digestOf(f.statement) &&
          digestOf(
            resultSnapshot.parse({
              status_list: value.data.status_list,
              version: value.data.version,
              bits: value.data.bits,
            }),
          ) === digestOf(snapshot)
        );
      })
    )
      return {
        ok: false as const,
        reason: "source-not-accepted",
        detail: "A result status snapshot has no admitted statement from its bound issuer.",
      };
  }
  return { ok: true as const, policy };
}
