// AUTHORED-BY Claude Opus 5.5
// Brief 32 §2 and tests 3–4: the faulty-gate stand-in can never reach a main path, and the
// gate and runtime sources never mention it.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync, statSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { patchDifferences } from "../src/engine/confinement.js";
import { loadCase, validateReferences } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";

const root = join(import.meta.dirname, "..");
const fixture = JSON.parse(
  readFileSync(join(root, "test/fixtures/gate-fault-on-main.json"), "utf8"),
) as { configuration: Scenario["configurations"][number] & { world: { gateFault: unknown } } };
const gateFault = fixture.configuration.world.gateFault;
const vendor = "accountability-vendor-fault";

it("refuses the stand-in at the top level of a scenario", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const top = { ...scenario, gateFault } as Scenario;
  expect(() => validateReferences(profile, top)).toThrow("top level of a scenario");
  await expect(runScenario(profile, top)).rejects.toThrow("top level of a scenario");
});

it("refuses the stand-in in a configuration world, where C3 also reports it", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const original = scenario.configurations.find((entry) => entry.id === vendor);
  if (!original) throw new Error("Missing configuration");
  const entry = patch(original, fixture.configuration) as Scenario["configurations"][number];
  expect(patchDifferences(scenario, entry).join("\n")).toMatch(/gateFault is active/);
  const changed = {
    ...scenario,
    configurations: scenario.configurations.map((c) => (c.id === vendor ? entry : c)),
  } as Scenario;
  await expect(runScenario(profile, changed, { configuration: vendor })).rejects.toThrow(
    `world of configuration ${vendor}`,
  );
});

it("refuses the stand-in in a branch with no onlyUnder or another configuration's", () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const branch = (onlyUnder?: string) => ({
    id: "stray-gate-fault",
    ...(onlyUnder ? { onlyUnder } : {}),
    what: "A stray stand-in.",
    change: { gateFault },
    outline: [],
  });
  for (const onlyUnder of [undefined, "accountability-pod-mirror"])
    expect(() =>
      validateReferences(profile, {
        ...scenario,
        branches: [...scenario.branches, branch(onlyUnder)],
      } as Scenario),
    ).toThrow(`not under ${vendor}`);
  const other = scenario.configurations.find((entry) => entry.id === "accountability-pod-mirror");
  if (!other) throw new Error("Missing configuration");
  expect(() =>
    validateReferences(profile, {
      ...scenario,
      configurations: scenario.configurations.map((entry) =>
        entry.id === other.id
          ? { ...entry, world: { ...entry.world, branches: [branch(other.id)] } }
          : entry,
      ),
    } as Scenario),
  ).toThrow(`not under ${vendor}`);
});

it("never runs the stand-in under the baseline", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const [main] = await runScenario(profile, { ...scenario, branches: [] });
  expect(main?.trace?.events.some((event) => /faulty gate/i.test(event.caption))).toBe(false);
  expect(main?.trace?.standIns?.some((s) => s.what.startsWith("Gate fault"))).toBe(false);
}, 300_000);

it("keeps the gate and runtime sources free of the stand-in", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  for (const dir of ["src/gates", "src/runtime"])
    for (const file of files(join(root, dir)))
      expect(readFileSync(file, "utf8"), file).not.toMatch(/gateFault|faulty-gate/);
});
