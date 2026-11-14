// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not turn a correctly refused action into evidence of a vendor fault", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "accountability-vendor-fault",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "fault-was-the-principals"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("CORE-L-13");
    expect(path.blocked).toContain("confinement C3");
  }
});
