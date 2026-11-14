// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("runs the mortgage with a party-presented federation chain and refuses expired and restrictive chains", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "trust-federation")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => ["chain-with-a-gap", "federation-business-only"].includes(b.id));
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  expect(paths.every((p) => !p.blocked)).toBe(true);
  expect(confinementDifferences(baseline, paths[0]!.trace!, "trust")).toEqual([]);
  const main = paths[0]!.trace!.events;
  expect(
    main.some(
      (e) =>
        e.agent === "lender" &&
        e.kind === "message-out" &&
        e.packet?.jsonld?.includes("openid-entity-statement+jwt"),
    ),
  ).toBe(true);
  expect(
    main.some(
      (e) =>
        e.agent === "sams-agent" &&
        e.check === "source" &&
        e.caption.includes("presents a current chain"),
    ),
  ).toBe(true);
  expect(
    main
      .filter((e) => e.resolution?.question.includes("presented lender"))
      .flatMap((e) => e.resolution!.path)
      .some((p) => p.kind === "register"),
  ).toBe(false);
  for (const [id, reason] of [
    ["chain-with-a-gap", "lookup-failed"],
    ["federation-business-only", "source-not-authoritative"],
  ]) {
    const events = paths.find((p) => p.path === id)!.trace!.events;
    expect(
      events.some((e) => e.agent === "sams-agent" && e.check === "source" && e.reason === reason),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.agent === "sams-agent" && e.kind === "store" && e.caption.includes("lender"),
      ),
    ).toBe(false);
  }
}, 180_000);
