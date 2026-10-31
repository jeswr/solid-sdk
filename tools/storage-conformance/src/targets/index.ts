// AUTHORED-BY Codex GPT-6.1-Sol
import type { ConformanceTarget } from "../types.js";
import { memoryTarget } from "./memory.js";
import { sparqSolidTarget } from "./sparq-solid.js";

/** Expand memory to both protocols; reject typos rather than silently running no tests. */
export function selectTargets(selection = "memory,sparq-solid"): ConformanceTarget[] {
  const targets = new Map<string, ConformanceTarget>();
  for (const name of selection.split(",")) {
    const selected =
      name === "memory"
        ? [memoryTarget("solid"), memoryTarget("lws")]
        : name === "memory-solid"
          ? [memoryTarget("solid")]
          : name === "memory-lws"
            ? [memoryTarget("lws")]
            : name === "sparq-solid"
              ? [sparqSolidTarget]
              : null;
    if (!selected) throw new TypeError("Unknown conformance target");
    for (const target of selected) targets.set(target.name, target);
  }
  return [...targets.values()];
}
