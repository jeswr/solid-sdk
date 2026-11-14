// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("admits source-signed indexed records only with inclusion and extension of the earlier independently held head", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "trust-trusted-index")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => b.id === "index-shows-two-histories");
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  expect(confinementDifferences(baseline, paths[0]!.trace!, "trust")).toEqual([]);
  const main = paths[0]!.trace!.events;
  expect(main.some((e) => e.packet?.jsonld?.includes("index-receipt+jws"))).toBe(true);
  const events = paths.find((p) => p.path === "index-shows-two-histories")!.trace!.events;
  expect(
    events.filter(
      (e) => e.agent === "sams-agent" && e.check === "source" && e.reason === "evidence-invalid",
    ),
  ).toHaveLength(2);
  expect(events.some((e) => e.agent === "sams-agent" && e.kind === "store")).toBe(false);
  expect(events.some((e) => e.packet?.jsonld?.includes("index-receipt+jws"))).toBe(true);
  for (const trace of [paths[0]!.trace!, paths.at(-1)!.trace!])
    for (const event of trace.events) {
      expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
      expect(event.chat?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
    }
}, 180_000);
