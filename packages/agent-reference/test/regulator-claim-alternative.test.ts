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
import { patch, runScenario } from "../src/engine/run.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";

const id = "accountability-regulator-claim";
const root = new URL("..", import.meta.url).pathname;

it("files the fee claim with the ombudsman the admitted register answer names and decides it on both range records", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(entry.requires).toBe("identity-anonymous");
  expect(patchDifferences(scenario, entry)).toEqual([]);
  const reference = (
    await runScenario(
      profile,
      { ...scenario, branches: [] },
      { configuration: "identity-anonymous" },
    )
  )[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((p) => p.path)).toEqual(["main", "entry-withheld"]);
  const [main, withheld] = paths;
  if (!reference || !main?.trace || !withheld?.trace)
    throw new Error(JSON.stringify(paths.map((p) => ({ path: p.path, blocked: p.blocked }))));
  expect(confinementDifferences(reference, main.trace, "accountability")).toEqual([]);
  expect(addedSegmentDifferences(main.trace, entry, matrixWorld(scenario, entry).parties)).toEqual(
    [],
  );

  // The forum decides on the lender-signed fee statement against the agreed terms.
  const decision = main.trace.events.find(
    (event) => event.agent === "forum" && event.kind === "decision",
  );
  expect(decision?.reason).toBe("not-authorised");
  expect(decision?.caption).toContain("fee-not-in-terms");
  // Both agents admit the forum's signed decision.
  const admitted = main.trace.events.filter(
    (event) => event.addedBy === id && event.kind === "decision" && event.agent !== "forum",
  );
  expect(admitted.slice(-2).map((event) => event.outcome)).toEqual(["admit", "admit"]);

  // Entry withheld: the gap in the lender's range is measured at fitness, not as registered.
  expect(withheld.disagrees).toBe(true);
  const refusal = withheld.trace.events.find(
    (event) => event.agent === "forum" && event.kind === "decision",
  );
  expect(refusal).toMatchObject({ outcome: "refuse", reason: "record-unavailable" });
}, 900_000);

it("sends no claim when the admitted register answer names a forum this world does not host", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === id
      ? (patch(entry, {
          world: {
            statements: { "north-dispute-route": { value: { forum: "urn:fictional:elsewhere" } } },
            branches: [],
          },
        }) as typeof entry)
      : entry,
  );
  await expect(runScenario(profile, scenario, { configuration: id })).rejects.toThrow(
    /dispute route urn:fictional:elsewhere is not a forum this world hosts/,
  );
}, 900_000);
