// AUTHORED-BY Codex GPT-6
/** Public entry point preserved; execution lives in the scenario engine. */
import type { Configuration } from "../suites/registry.js";
import type { TraceFile } from "../trace/types.js";
import { runReference } from "./mortgage.js";

export { FACE_CHECK } from "./main-fixtures.js";
export const MAIN_AGENTS = [
  { id: "sams-agent", name: "Sam's agent", actsFor: "sam", role: "Personal agent" },
  {
    id: "index",
    name: "Mortgage product index",
    actsFor: "index",
    role: "Aggregates lenders' signed product records",
  },
  { id: "lender", name: "North Bank", actsFor: "lender", role: "Lender" },
  {
    id: "bank",
    name: "Harbour Bank",
    actsFor: "bank",
    role: "Sam's own bank; authority for balances",
  },
] as const;
export function runMain(
  options: { commit?: string; configuration?: Configuration } = {},
): Promise<TraceFile> {
  return runReference("mortgage-main", options);
}
