// AUTHORED-BY Codex GPT-6.2 Sol
// A fresh process for each switch setting, as in run-scenarios.mjs.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join } from "path";
import { availableAdapters } from "../../dist/derive/adapters/index.js";
import { SPARQ_ZK_RESULT } from "../../dist/derive/adapters/sparq-zk-result.js";
import { loadCase } from "../../dist/engine/load.js";
import { runScenario } from "../../dist/engine/run.js";
import { ScenarioTraceWriter } from "../../scripts/write-scenario-traces.mjs";

const [id, file, mode, configuration] = process.argv.slice(2);
const baseline = JSON.parse(readFileSync(`traces/${id}--${configuration}.json`, "utf8"));
const registry = await availableAdapters();
const method = SPARQ_ZK_RESULT.method;
const system = registry.proofSystems.get(method);
if (id === "age-check" && system) {
  // The prover randomises the proof. Replay its published output at the prover
  // boundary. The real receiver still verifies the proof and all its bindings.
  const claim = baseline.events
    .filter((event) => event.kind === "message-out")
    .flatMap((event) => event.packet?.layers.evidence.raw ?? [])
    .find((item) => item?.derivation?.proof?.method === method);
  const presentation = claim?.derivation.proof.presentation;
  if (!presentation) throw new Error("Missing recorded age proof");
  registry.proofSystems.set(method, {
    ...system,
    prove: async () => ({ presentation, result: presentation.rows }),
  });
}
const { profile, scenario } = loadCase(process.cwd(), id);
const paths = await runScenario(profile, scenario, {
  commit: baseline.generated.commit,
  registry,
  configuration: configuration === "baseline" ? undefined : configuration,
  linked: mode === "linked",
});
const directory = join(dirname(file), "traces");
mkdirSync(directory);
using writer = new ScenarioTraceWriter(directory, id, configuration);
for (const path of paths) {
  if (path.trace) writer.write(`${path.trace.scenario.id}--${configuration}.json`, path.trace);
}
writer.publish();
writeFileSync(file, JSON.stringify(paths));
