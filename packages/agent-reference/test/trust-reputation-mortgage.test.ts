// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("uses a signed score as a minimum and never as a replacement for registration", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "trust-reputation")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => b.id === "high-score-not-registered");
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  expect(confinementDifferences(baseline, paths[0]!.trace!, "trust")).toEqual([]);
  expect(
    paths[0]!.trace!.events.some((e) => e.packet?.jsonld?.includes("agent-reputation+jws")),
  ).toBe(true);
  const events = paths.find((p) => p.path === "high-score-not-registered")!.trace!.events;
  expect(
    events.some(
      (e) => e.agent === "sams-agent" && e.check === "source" && e.reason === "source-unknown",
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.agent === "sams-agent" && e.kind === "store" && e.caption.includes("Willow"),
    ),
  ).toBe(false);
}, 180_000);
