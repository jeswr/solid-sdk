// AUTHORED-BY Claude Opus 5.5
// Maintainer decision, 15 Nov: an aggregate reputation score is out of the normative spec,
// because a number cannot be traced to who said what. Reputation is carried as individually
// checkable claims (the reputation-post suite), so no score suite or configuration is offered.
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { scenarioRegistry } from "../src/suites/scenario.js";

it("does not offer an aggregate reputation score suite", () => {
  const accountability = scenarioRegistry()
    .suitesFor("accountability")
    .map((suite) => suite.id);
  expect(accountability).not.toContain("reputation-score");
  expect(accountability).toContain("reputation-post");
  expect(configurationById(alternativeWireId("accountability-reputation-score"))).toBeUndefined();
  const { scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  expect(scenario.configurations.map((entry) => entry.id)).not.toContain(
    "accountability-reputation-score",
  );
  expect(
    scenario.branches.filter((branch) => branch.onlyUnder === "accountability-reputation-score"),
  ).toEqual([]);
});
