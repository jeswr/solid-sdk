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
import {
  alternativeWireId,
  CONFIG_PUBLIC,
  configurationById,
} from "../src/profile/configurations.js";

it("looks lenders up anonymously in the sector register and reads only the admitted signed answer", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const id = "identity-anonymous";
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(patchDifferences(scenario, entry)).toEqual([]);
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((p) => p.path)).toEqual(["main", "anonymous-asks-for-more"]);
  const [main, failure] = paths;
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error(JSON.stringify(paths.map((p) => ({ path: p.path, blocked: p.blocked }))));
  expect(confinementDifferences(baseline, main.trace, "identity")).toEqual([]);
  expect(addedSegmentDifferences(main.trace, entry, matrixWorld(scenario, entry).parties)).toEqual(
    [],
  );

  // The lookup goes out unsigned under public-read with no requester; the answer is admitted.
  const added = main.trace.events.filter((event) => event.addedBy === id);
  const request = added.find((event) => event.kind === "message-out");
  const wire = JSON.parse(String(request?.packet?.jsonld)) as {
    configuration: string;
    from: { id: string; actor?: string; party?: string };
    "@included": { id: string; actor?: string; party?: string }[];
  };
  expect(wire.configuration).toBe(CONFIG_PUBLIC);
  const from = wire["@included"].find((node) => node.id === wire.from.id);
  expect(from?.actor).toBeUndefined();
  expect(from?.party).toBeUndefined();
  expect(
    added.filter((event) => event.agent === "sams-agent" && event.kind === "decision").at(-1)
      ?.outcome,
  ).toBe("admit");

  // Without the North Bank entry in the answer, Sam's agent cannot reach the lender.
  const world = entry.world as { script: { id: string; reply?: { evidence: unknown[] } }[] };
  const lookup = world.script.find((step) => step.id === "lender-lookup-arrives");
  if (!lookup?.reply) throw new Error("the lookup reply is missing");
  const withHarbourOnly = structuredClone(scenario);
  const narrowed = withHarbourOnly.configurations.find((candidate) => candidate.id === id);
  if (!narrowed) throw new Error(`${id} is missing from the copy`);
  const narrowedWorld = narrowed.world as {
    script: { id: string; reply?: { evidence: unknown[] } }[];
  };
  narrowedWorld.script
    .find((step) => step.id === "lender-lookup-arrives")
    ?.reply?.evidence.splice(0, 1);
  await expect(
    runScenario(profile, { ...withHarbourOnly, branches: [] }, { configuration: id }),
  ).rejects.toThrow(
    /describe-lender: no queued message to north-agent; last decision not-authorised/,
  );

  // The index refuses an unnamed requester at its authority check.
  expect(failure.disagrees).toBe(false);
  expect(failure.actual).toMatchObject({
    check: "authority",
    reason: "not-authorised",
    outcome: "refuse",
  });
}, 900_000);
