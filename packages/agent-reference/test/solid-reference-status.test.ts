// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("does not label the local holder or a by-value run as Solid reference access", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "data-access-by-reference-solid",
  });
  expect(paths.map((path) => path.path)).toEqual([
    "main",
    "grant-wider-than-terms",
    "read-after-withdrawal",
  ]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("by-reference-needs-access-control");
    expect(path.blocked).toContain(
      "sharing by reference needs the Solid access-control usage suite",
    );
  }
});
it("keeps pod-only usage control unresolved while its one-layer cell retains by-value access", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "usage-control-solid-access-control",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "translation-grants-more"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("Specification 17 requires data to stay in a pod");
    expect(path.blocked).toContain("retains baseline by-value access");
  }
});
