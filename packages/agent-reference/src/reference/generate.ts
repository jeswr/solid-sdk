// AUTHORED-BY Claude Opus 5.5
/** Every reference trace this package can produce, by file name `<scenario>--<configuration>`. */
import { BASELINE } from "../suites/baseline.js";
import type { TraceFile } from "../trace/types.js";
import { runReference, SCENARIOS, type ScenarioId } from "./mortgage.js";

export async function generateTraces(commit = "unknown"): Promise<Map<string, TraceFile>> {
  const out = new Map<string, TraceFile>();
  for (const scenario of Object.keys(SCENARIOS) as ScenarioId[]) {
    const trace = await runReference(scenario, { commit, configuration: BASELINE });
    out.set(`${scenario}--${BASELINE.id}`, trace);
  }
  return out;
}
