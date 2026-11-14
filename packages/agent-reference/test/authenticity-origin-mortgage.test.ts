// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("fetches unsigned source products only through the signed register address and refuses onward evidence", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "authenticity-origin-hosted")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => ["address-from-the-message", "origin-record-forwarded"].includes(b.id));
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  expect(confinementDifferences(baseline, paths[0]!.trace!, "authenticity")).toEqual([]);
  const origin = paths[0]!.trace!.events;
  expect(origin.some((e) => e.packet?.jsonld?.includes("origin-hosted"))).toBe(true);
  const lookalike = paths.find((p) => p.path === "address-from-the-message")!;
  expect(
    lookalike.trace!.events.some((e) => e.packet?.jsonld?.includes("northbank-lookalike")),
  ).toBe(true);
  expect(confinementDifferences(paths[0]!.trace!, lookalike.trace!, "authenticity")).toEqual([]);
  const forwarded = paths.find((p) => p.path === "origin-record-forwarded")!;
  expect(forwarded.disagrees).toBe(true);
  expect(forwarded.trace!.events.findLast((e) => e.kind === "decision")).toMatchObject({
    outcome: "stop",
    reason: "not-authorised",
  });
  expect(forwarded.trace!.events.findLast((e) => e.kind === "check")).toMatchObject({
    check: "mandate",
    verdict: "fail",
    reason: "not-authorised",
  });
}, 180_000);
