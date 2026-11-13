// AUTHORED-BY Codex GPT-6
/** Optional research-grade, unaudited aggregate and result proofs. Result credentials
 * are sparq commitment-signed (not standard VCs), with test-only issuer keys.
 * sparq-noir-closed-world/0 awaits purpose-built absence/totals circuits. */
import { type Adapter, verifierRegistry } from "../verifiers.js";
import { loadSparqAggregate } from "./sparq-aggregate.js";
import { loadSparqZkResult, SPARQ_ZK_RESULT } from "./sparq-zk-result.js";
export const adapters: readonly Adapter[] = [];
export async function availableAdapters() {
  const loaded: string[] = [];
  const result = await loadSparqZkResult();
  if (result)
    loaded.push(`${SPARQ_ZK_RESULT.package} ${SPARQ_ZK_RESULT.version}: ${SPARQ_ZK_RESULT.notice}`);
  const aggregate = loadSparqAggregate();
  if (aggregate) loaded.push("sparq-verifiable-aggregate (research-grade, unaudited; 61989f5)");
  return {
    ...verifierRegistry([
      ...adapters,
      ...(aggregate ? [aggregate] : []),
      ...(result ? [result] : []),
    ]),
    loaded,
  };
}
