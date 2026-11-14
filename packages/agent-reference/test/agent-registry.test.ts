// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("confines registry-backed authority and refuses a registration for another operation", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "authority-agent-registry" });
  const main = paths.find((p) => p.path === "main"),
    failure = paths.find((p) => p.path === "registered-for-something-else");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error("Missing actual registry mortgage paths");
  expect(confinementDifferences(baseline, main.trace, "authority")).toEqual([]);
  expect(main.trace.events.some((e) => e.fact?.claimType === "authority.registration")).toBe(true);
  expect(
    failure.trace.events.some(
      (e) =>
        e.check === "authority" &&
        e.verdict === "fail" &&
        e.reason === "representation-out-of-scope",
    ),
  ).toBe(true);
  for (const t of [main.trace, failure.trace])
    for (const e of t.events)
      expect(`${e.caption} ${e.rule?.text ?? ""} ${e.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
}, 180000);
