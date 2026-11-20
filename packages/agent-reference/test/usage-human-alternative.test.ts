// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import {
  addedSegmentDifferences,
  confinementDifferences,
  patchDifferences,
} from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { matrixWorld } from "../src/engine/matrix.js";
import { runScenario } from "../src/engine/run.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";

it("asks Sam about an undecided use of his own statement, binds the approval to one recipient and never waives bank terms", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const id = "usage-control-human-approval";
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(patchDifferences(scenario, entry, profile)).toEqual([]);
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((path) => path.path)).toEqual([
    "main",
    "approval-reused",
    "supplier-terms-hold",
  ]);
  const [main, reused, hold] = paths;
  if (!baseline || !main?.trace || !reused?.trace || !hold?.trace)
    throw new Error(
      JSON.stringify(paths.map((path) => ({ path: path.path, blocked: path.blocked }))),
    );
  expect(confinementDifferences(baseline, main.trace, "usage-control")).toEqual([]);
  expect(addedSegmentDifferences(main.trace, entry, matrixWorld(scenario, entry).parties)).toEqual(
    [],
  );

  // Main: Sam's gate holds the reply for Sam, Sam approves the exact message, it goes out.
  const added = main.trace.events.filter((event) => event.addedBy === id);
  const ask = added.find((event) => event.kind === "ask-principal");
  expect(ask?.reason).toBe("approval-required");
  expect(ask?.chat?.text).toContain("No rule in your mandate decides this");
  expect(added).toContainEqual(
    expect.objectContaining({ check: "data-terms", verdict: "pass", reason: "approval-given" }),
  );
  const out = added.filter((event) => event.kind === "message-out");
  expect(out.map((event) => event.packet?.kind)).toEqual(["invoke", "deliver"]);
  expect(added.filter((event) => event.kind === "decision").at(-1)).toMatchObject({
    agent: "valuer-agent",
    outcome: "admit",
  });
  expect(main.disagrees).toBe(false);

  // The valuer's approval does not carry over to a different valuation party.
  expect(reused).toMatchObject({
    disagrees: false,
    actual: { outcome: "ask-principal", check: "data-terms", reason: "approval-required" },
  });
  const reusedAsks = reused.trace.events.filter(
    (event) => event.kind === "ask-principal" && event.reason === "approval-required",
  );
  expect(reusedAsks).toHaveLength(2);
  const secondAsk = reusedAsks[1];
  if (!secondAsk) throw new Error("Missing the second approval question");
  expect(secondAsk).toMatchObject({ agent: "sams-agent", kind: "ask-principal" });
  expect(
    reused.trace.events.filter(
      (event) =>
        event.seq > secondAsk.seq &&
        event.agent === secondAsk.agent &&
        (event.kind === "message-out" || event.effectRelease || event.outcome === "go"),
    ),
  ).toEqual([]);

  // Disclosure stops Harbour's statement before Sam can be asked about it.
  expect(hold).toMatchObject({
    disagrees: false,
    actual: { outcome: "stop", check: "disclosure", reason: "excessive-scope" },
    expected: { outcome: "stop", reason: "excessive-scope" },
  });
  expect(hold.trace.events.findLast((event) => event.kind === "decision")).toMatchObject({
    reason: "excessive-scope",
    outcome: "stop",
  });
  const holdAsks = hold.trace.events.filter(
    (event) => event.kind === "ask-principal" && event.reason === "approval-required",
  );
  expect(holdAsks).toHaveLength(1);
}, 900_000);
