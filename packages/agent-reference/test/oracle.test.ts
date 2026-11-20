// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, vi } from "vitest";
// @ts-expect-error Executable snapshot tool has no declaration file.
import { decisionsOf } from "../scripts/oracle-snapshot.mjs";
import { loadSparqAggregate } from "../src/derive/adapters/sparq-aggregate.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

function liveRegistry() {
  const aggregate = loadSparqAggregate();
  if (!aggregate)
    throw new Error("Install the pinned sparq aggregate adapter to run the live oracle.");
  return verifierRegistry([aggregate]);
}

it("requires the aggregate adapter even when its saved traces exist", () => {
  vi.stubEnv("ANSWERABLE_SPARQ_AGGREGATE", join(root, ".sparq", "absent-aggregate"));
  try {
    expect(liveRegistry).toThrow(/install the pinned sparq aggregate adapter/i);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("preserves every recorded decision, reason and check position in every executable path", async () => {
  const saved = JSON.parse(readFileSync(join(root, "test/oracle/pre-rdf.json"), "utf8"));
  // The oracle predates the two zk proof methods and includes the six aggregate paths.
  const registry = liveRegistry();
  const actual: Record<string, unknown> = {};
  for (const file of readdirSync(join(root, "scenarios"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = file.slice(0, -5);
    const { profile, scenario } = loadCase(root, id);
    for (const path of await runScenario(profile, scenario, { registry })) {
      const key = `${id}/${path.path}`;
      if (path.trace) actual[key] = decisionsOf(path.trace);
    }
  }
  expect(Object.keys(actual)).toHaveLength(164);
  expect(actual).toEqual(saved);
}, 900_000);
