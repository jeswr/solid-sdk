// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not claim that a configured local forum is a register-discovered regulator", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "accountability-regulator-claim",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "entry-withheld"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("lender-register exchange");
    expect(path.blocked).toContain("AC-7");
  }
});
