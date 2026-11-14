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
  expect(patchDifferences(scenario, entry)).toEqual([]);
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
  expect(reused.disagrees).toBe(false);
  const reusedAsks = reused.trace.events.filter(
    (event) => event.kind === "ask-principal" && event.reason === "approval-required",
  );
  expect(reusedAsks).toHaveLength(2);
  expect(reused.actual).toMatchObject({
    check: "data-terms",
    reason: "approval-required",
    outcome: "ask-principal",
  });

  // Harbour's statement is never put to Sam; the gate stops before data terms (recorded
  // disagreement with the brief's data-terms / prohibited).
  expect(hold.actual).toMatchObject({
    check: "disclosure",
    reason: "excessive-scope",
    outcome: "stop",
  });
  expect(hold.expected).toEqual({ outcome: "stop", reason: "prohibited" });
  expect(hold.disagrees).toBe(true);
  const holdAsks = hold.trace.events.filter(
    (event) => event.kind === "ask-principal" && event.reason === "approval-required",
  );
  expect(holdAsks).toHaveLength(1);
}, 900_000);
