// AUTHORED-BY Codex GPT-6
/** Optional research-grade, unaudited aggregate; successful-result proof delivery pending.
 * sparq-noir-closed-world/0 awaits purpose-built absence/totals circuits. */
import { type Adapter, verifierRegistry } from "../verifiers.js";
import { loadSparqAggregate } from "./sparq-aggregate.js";
export const adapters: readonly Adapter[] = [];
export async function availableAdapters() {
  const loaded: string[] = [];
  try {
    // @ts-expect-error Optional delivery is deliberately absent; no package API is assumed.
    await import("@sparq/zk-result");
    loaded.push("@sparq/zk-result");
  } catch (error) {
    if ((error as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  const aggregate = loadSparqAggregate();
  if (aggregate) loaded.push("sparq-verifiable-aggregate (research-grade, unaudited; 61989f5)");
  return { ...verifierRegistry([...adapters, ...(aggregate ? [aggregate] : [])]), loaded };
}
