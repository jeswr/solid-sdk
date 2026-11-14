// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("lifts the signed key-bound grant, confines the journey and refuses an absent actor", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "authority-authorization-server",
  });
  const main = paths.find((p) => p.path === "main"),
    failure = paths.find((p) => p.path === "token-as-the-person");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error("The real authority grant paths must run");
  expect(confinementDifferences(baseline, main.trace, "authority")).toEqual([]);
  expect(main.trace.events.some((e) => e.fact?.claimType === "authority.grant-lift")).toBe(true);
  expect(
    failure.trace.events.some(
      (e) =>
        e.check === "authority" && e.verdict === "fail" && e.reason === "representation-invalid",
    ),
  ).toBe(true);
  for (const t of [main.trace, failure.trace])
    for (const e of t.events)
      expect(`${e.caption} ${e.rule?.text ?? ""} ${e.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
}, 180000);
