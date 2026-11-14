// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { sampledScenario } from "./helpers/model-corpus.js";

it("samples configured branches after keyed patches, preserving complete inherited annual-assessment branches", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const input = sampledScenario(
    scenario,
    "authenticity-selective-disclosure",
    new Set(["main", "fee-no-offer"]),
  );
  const paths = await runScenario(profile, input, {
    configuration: "authenticity-selective-disclosure",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "fee-no-offer"]);
  expect(paths.every((path) => !path.blocked && path.trace)).toBe(true);
  expect(paths[1]?.actual).toMatchObject({ outcome: "stop", reason: "no-agreement", check: "P1" });
}, 120_000);
