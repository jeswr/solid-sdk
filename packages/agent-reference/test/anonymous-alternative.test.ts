// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not relabel unsigned local register tables as a signed anonymous register exchange", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, { configuration: "identity-anonymous" });
  expect(paths.map((p) => p.path)).toEqual(["main", "anonymous-asks-for-more"]);
  for (const p of paths) {
    expect(p.trace).toBeUndefined();
    expect(p.blocked).toContain("unsigned register tables");
    expect(p.blocked).toContain("lender-register exchange");
  }
});
