// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("admits graph-equivalent DI serialization and refuses a changed triple at the actual receiver", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "authenticity-data-integrity",
  });
  const events = paths.find((p) => p.path === "graph-reordered")!.trace!.events;
  expect(
    events.some((e) => e.agent === "sams-agent" && e.kind === "decision" && e.outcome === "admit"),
  ).toBe(true);
  expect(events.findLast((e) => e.kind === "check")).toMatchObject({
    agent: "lender",
    check: "integrity",
    verdict: "fail",
    reason: "bad-signature",
  });
  expect(events.findLast((e) => e.kind === "decision")).toMatchObject({
    outcome: "refuse",
    reason: "bad-signature",
  });
}, 180_000);
