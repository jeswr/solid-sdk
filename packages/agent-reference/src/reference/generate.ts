// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** Every reference trace this package can produce, by file name `<scenario>--<configuration>`. */

import { loadProfile, loadScenario, runScenarioPaths, scenarioIds } from "../engine/run.js";
import type { TraceFile } from "../trace/types.js";

export async function generateTraces(commit = "unknown"): Promise<Map<string, TraceFile>> {
  const out = new Map<string, TraceFile>();
  for (const id of scenarioIds()) {
    const scenario = loadScenario(id);
    for (const [path, trace] of await runScenarioPaths(loadProfile(scenario.profile), scenario, {
      commit,
    }))
      out.set(`${path}--${trace.configuration.id}`, trace);
  }
  return out;
}
