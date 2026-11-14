// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("keeps the valuer disclosure unrun until the Sam-issued item and undecided-use approval exist, never waiving bank terms", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "usage-control-human-approval",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "approval-reused"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("Brief 31 section 2.1");
    expect(path.blocked).toContain("UC-9");
  }
});
