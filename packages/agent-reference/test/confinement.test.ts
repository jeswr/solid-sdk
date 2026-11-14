// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import type { LayerId } from "../src/suites/registry.js";

const root = join(import.meta.dirname, "..");

it("confines every scenario configuration to the changed layer and preserves the final outcome", async () => {
  let tested = 0;
  for (const file of readdirSync(join(root, "scenarios")).filter((file) =>
    file.endsWith(".json"),
  )) {
    const { profile, scenario } = loadCase(root, file.slice(0, -5));
    if (!scenario.configurations.length) continue;
    const baseline = (await runScenario(profile, scenario))[0]?.trace;
    expect(baseline, `${scenario.title}: the baseline must run`).toBeDefined();
    for (const entry of scenario.configurations) {
      const changed = (await runScenario(profile, scenario, { configuration: entry.id })).find(
        (result) => result.path === "main",
      );
      // Design 26 §2 requires honest not-run cells when a mechanism is unresolved.
      if (configurationById(alternativeWireId(entry.id))?.status === "unresolved") {
        expect(changed?.trace).toBeUndefined();
        expect(changed?.blocked).toMatch(
          /no executable runtime configuration|registered suite constraint/,
        );
        continue;
      }
      expect(
        changed?.blocked,
        `${scenario.title}: selected configuration must run`,
      ).toBeUndefined();
      if (!baseline || !changed?.trace) throw new Error("Missing real configuration trace");
      const layer = Object.keys(entry.change)[0] as LayerId;
      const differences = confinementDifferences(baseline, changed.trace, layer);
      expect(differences, `${scenario.title}, ${layer}:\n${differences.join("\n")}`).toEqual([]);
      tested++;
    }
  }
  expect(tested).toBeGreaterThanOrEqual(3);
}, 600_000);

it("detects a deliberately wrong transport configuration that changes a mandate verdict", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const fixture = JSON.parse(
    readFileSync(join(root, "test/fixtures/confinement-wrong.json"), "utf8"),
  );
  const original = scenario.configurations.find((entry) => entry.id === "transport-email");
  if (!original) throw new Error("Missing email configuration");
  const bad = patch(original, fixture.configuration);
  scenario.configurations = [bad];
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const changed = (await runScenario(profile, scenario, { configuration: bad.id }))[0]?.trace;
  if (!baseline || !changed) throw new Error("The fixture must exercise real gates");
  const differences = confinementDifferences(baseline, changed, "transport");
  expect(differences.join("\n")).toMatch(/mandate/);
  expect(differences.join("\n")).toMatch(/Final outcome/);
}, 300_000);
