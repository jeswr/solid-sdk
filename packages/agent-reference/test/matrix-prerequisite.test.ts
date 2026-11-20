// AUTHORED-BY Claude Opus 5.5
// Brief 31 item 4: a `requires` chain whose prerequisite adds parties and its own added
// segment. The dependent's patch is checked against the prerequisite's world.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { addedStepProblem, matrixWorld, type ScenarioConfiguration } from "../src/engine/matrix.js";
import { patch } from "../src/engine/run.js";
import { scenarioSchema } from "../src/engine/schema.js";

const root = join(import.meta.dirname, "..");

function dependentOnAnonymous() {
  const { scenario } = loadCase(root, "mortgage-main");
  const base = scenario.configurations.find((c) => c.id === "usage-control-human-approval");
  if (!base) throw new Error("missing configuration");
  const dependent = { ...base, requires: "identity-anonymous", world: {} } as ScenarioConfiguration;
  return { scenario, dependent };
}

it("reads advertised configurations of a prerequisite's added parties before they are parsed", () => {
  const { scenario, dependent } = dependentOnAnonymous();
  const world = scenarioSchema.parse(matrixWorld(scenario, dependent));
  // identity-anonymous adds lender-register, an issuer-only party with no configuration list.
  expect(world.parties.find((party) => party.id === "lender-register")?.configurations).toEqual([]);
  expect(
    world.parties.find((party) => party.id === "lender-register-agent")?.configurations,
  ).toEqual(["public-read"]);
});

it("treats a prerequisite's own added segment as reference, not as an addition", () => {
  const { scenario, dependent } = dependentOnAnonymous();
  const anonymous = scenario.configurations.find((c) => c.id === "identity-anonymous");
  if (!anonymous) throw new Error("missing configuration");
  const reference = scenarioSchema.parse(patch(scenario, anonymous.world)).script;
  expect(reference.some((step) => step.segment === "added")).toBe(true);
  expect(addedStepProblem(reference, reference, dependent)).toBeUndefined();
  // Marking a reference step as the start of an added segment is still refused.
  const marked = reference.map((step, index) =>
    index === 0 ? { ...step, segment: "added" as const } : step,
  );
  expect(addedStepProblem(reference, marked, dependent)).toMatch(
    /lies inside an added segment|still open/,
  );
  // A step the dependent adds outside an added segment is still refused.
  const extra = { ...reference[0], id: "dependent-extra" } as (typeof reference)[number];
  expect(addedStepProblem(reference, [...reference, extra], dependent)).toMatch(
    /dependent-extra is added outside an added segment/,
  );
});
