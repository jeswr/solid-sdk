// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
// @ts-expect-error Executable snapshot tool has no declaration file.
import { decisionsOf } from "../scripts/oracle-snapshot.mjs";
// @ts-expect-error The scenario runner's recorded-trace helper has no declaration file.
import { recordedJoint } from "../scripts/recorded-joint.mjs";
import { loadSparqAggregate } from "../src/derive/adapters/sparq-aggregate.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

it("preserves every recorded decision, reason and check position in every executable path", async () => {
  const saved = JSON.parse(readFileSync(join(root, "test/oracle/pre-rdf.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8"));
  // The oracle predates the two zk proof methods and includes the six aggregate paths.
  const aggregate = loadSparqAggregate();
  const registry = verifierRegistry(aggregate ? [aggregate] : []);
  const actual: Record<string, unknown> = {};
  for (const file of readdirSync(join(root, "scenarios"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = file.slice(0, -5);
    const { profile, scenario } = loadCase(root, id);
    for (const path of await runScenario(profile, scenario, { registry })) {
      const key = `${id}/${path.path}`;
      if (path.trace) {
        actual[key] = decisionsOf(path.trace);
      } else if (path.blocked && !aggregate) {
        const row = recordedJoint(root, manifest.paths, id, path.path);
        if (row)
          actual[key] = decisionsOf(
            JSON.parse(readFileSync(join(root, "traces", row.trace), "utf8")),
          );
      }
    }
  }
  expect(Object.keys(actual)).toHaveLength(164);
  expect(actual).toEqual(saved);
}, 900_000);
