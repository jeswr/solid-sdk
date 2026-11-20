// AUTHORED-BY Codex GPT-6
/** Optional research-grade, unaudited proof adapters. */
import { type Adapter, verifierRegistry } from "../verifiers.js";
import { loadSparqAggregate } from "./sparq-aggregate.js";
import { loadSparqZkQuery, SPARQ_ZK_QUERY } from "./sparq-zk-query.js";
import { loadSparqZkResult, SPARQ_ZK_RESULT } from "./sparq-zk-result.js";
export const adapters: readonly Adapter[] = [];
export async function availableAdapters() {
  const loaded: string[] = [];
  const [result, query] = await Promise.all([loadSparqZkResult(), loadSparqZkQuery()]);
  if (result)
    loaded.push(`${SPARQ_ZK_RESULT.package} ${SPARQ_ZK_RESULT.version}: ${SPARQ_ZK_RESULT.notice}`);
  if (query)
    loaded.push(`${SPARQ_ZK_QUERY.package} ${SPARQ_ZK_QUERY.version}: ${SPARQ_ZK_QUERY.notice}`);
  const aggregate = loadSparqAggregate();
  if (aggregate) loaded.push("sparq-verifiable-aggregate (research-grade, unaudited; 61989f5)");
  return {
    ...verifierRegistry([
      ...adapters,
      ...(aggregate ? [aggregate] : []),
      ...(result ? [result] : []),
      ...(query ? [query] : []),
    ]),
    loaded,
  };
}
