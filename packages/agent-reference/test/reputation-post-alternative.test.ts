// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not publish restricted evidence or claim an unrun reader admission", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "accountability-reputation-post",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "post-about-a-person"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("reader's inbound checks");
    expect(path.blocked).toContain("UC-9, AC-4");
  }
});
