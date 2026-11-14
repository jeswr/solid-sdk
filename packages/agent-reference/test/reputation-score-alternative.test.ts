// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not invent a score or a trust decision from unchecked evidence", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "accountability-reputation-score",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "score-without-evidence"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("AC-7/8");
    expect(path.blocked).toContain("separate reputation trust suite");
  }
});
