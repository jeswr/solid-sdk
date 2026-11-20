// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, vi } from "vitest";
// @ts-expect-error Executable snapshot tool has no declaration file.
import { decisionsOf } from "../scripts/oracle-snapshot.mjs";
// @ts-expect-error The scenario runner's recorded-trace helper has no declaration file.
import { recordedJoint } from "../scripts/recorded-joint.mjs";
import { loadSparqAggregate } from "../src/derive/adapters/sparq-aggregate.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

function oracleMode() {
  const aggregate = loadSparqAggregate();
  if (!aggregate && process.env.ANSWERABLE_REQUIRE_LIVE_AGGREGATE === "1")
    throw new Error("Install the pinned sparq aggregate adapter to run the live oracle.");
  return { aggregate, registry: verifierRegistry(aggregate ? [aggregate] : []) };
}

it("uses recordings for an absent adapter unless live aggregate execution is required", () => {
  vi.stubEnv("ANSWERABLE_SPARQ_AGGREGATE", join(root, ".sparq", "absent-aggregate"));
  try {
    vi.stubEnv("ANSWERABLE_REQUIRE_LIVE_AGGREGATE", "0");
    expect(oracleMode().aggregate).toBeUndefined();
    vi.stubEnv("ANSWERABLE_REQUIRE_LIVE_AGGREGATE", "1");
    expect(oracleMode).toThrow(/install the pinned sparq aggregate adapter/i);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("preserves every recorded decision, reason and check position in every executable path", async () => {
  const saved = JSON.parse(readFileSync(join(root, "test/oracle/pre-rdf.json"), "utf8"));
  // The oracle predates the two zk proof methods and includes the six aggregate paths.
  const { aggregate, registry } = oracleMode();
  const manifest = aggregate
    ? undefined
    : JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8"));
  console.info(`Aggregate oracle mode: ${aggregate ? "live adapter" : "SHA-verified recordings"}`);
  let recordings = 0;
  const actual: Record<string, unknown> = {};
  for (const file of readdirSync(join(root, "scenarios"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = file.slice(0, -5);
    const { profile, scenario } = loadCase(root, id);
    for (const path of await runScenario(profile, scenario, { registry })) {
      const key = `${id}/${path.path}`;
      if (path.trace) actual[key] = decisionsOf(path.trace);
      else if (path.blocked && manifest) {
        const row = recordedJoint(root, manifest.paths, id, path.path);
        if (row) {
          actual[key] = decisionsOf(
            JSON.parse(readFileSync(join(root, "traces", row.trace), "utf8")),
          );
          recordings++;
        }
      }
    }
  }
  expect(Object.keys(actual)).toHaveLength(164);
  expect(recordings).toBe(aggregate ? 0 : 6);
  expect(actual).toEqual(saved);
}, 900_000);
