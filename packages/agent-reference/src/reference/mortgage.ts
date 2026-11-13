// AUTHORED-BY Codex GPT-6.1-Sol
/** Compatibility entry point; all scenarios and profiles are executable JSON data. */
import { loadScenario, type RunOptions, runDataScenario, scenarioIds } from "../engine/run.js";
export const SCENARIOS = Object.fromEntries(
  scenarioIds().map((id) => [id, loadScenario(id).title]),
);
export type ScenarioId = string;
export function runReference(scenario: ScenarioId, opts: RunOptions = {}) {
  return runDataScenario(scenario, opts);
}
