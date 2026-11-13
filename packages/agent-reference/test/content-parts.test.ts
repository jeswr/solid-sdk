// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

it("keeps hospital provenance through a patient relay, quarantines readings and upgrades from the hospital", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  const [main, wrong] = await runScenario(profile, scenario);
  const events = main?.trace?.events ?? [];
  expect(events.some((e) => e.check === "fitness" && e.reason === "structured-form-required")).toBe(
    true,
  );
  expect(events.some((e) => e.caption.includes("request source urn:fictional:hospital"))).toBe(
    true,
  );
  expect(events.some((e) => e.caption.includes("Model-output reading of unstructured data"))).toBe(
    true,
  );
  expect(events.some((e) => e.caption.includes("claim tool"))).toBe(false);
  expect(events.some((e) => e.agent === "hospital-agent" && e.kind === "message-in")).toBe(true);
  expect(events.some((e) => e.agent === "practice-agent" && e.outcome === "go")).toBe(true);
  expect(wrong?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "method-not-accepted",
  });
});

it("refuses re-signed content whose bytes no longer match its protected digest before core admission", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 4);
  scenario.stress = ["integrity"];
  scenario.inject = [
    {
      step: "letter-arrives",
      target: "message",
      path: ["content", "0", "bytes"],
      value: "changed",
      resign: true,
    },
  ];
  const [run] = await runScenario(profile, scenario, { compare: false });
  expect(
    run?.trace?.events.some(
      (e) =>
        e.agent === "practice-agent" && e.check === "integrity" && e.reason === "evidence-invalid",
    ),
  ).toBe(true);
  expect(run?.trace?.events.some((e) => e.agent === "practice-agent" && e.kind === "store")).toBe(
    false,
  );
});

it("drops undeclared, out-of-range, wrong numeric and invalid date reader outputs", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  profile.readings.push(
    { claimType: "review-date", type: "date" },
    { claimType: "score", type: "number" },
  );
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 5);
  const reading = scenario.script.at(-1);
  if (reading?.type !== "read-content") throw new Error("missing reading");
  reading.output = {
    "clinical.diagnosis": "made-up",
    "review-date": "2026-02-31",
    score: "12",
    injectedAction: "pay",
  };
  scenario.script.push({
    id: "all-dropped",
    agent: "practice-agent",
    type: "assert",
    operator: "equals",
    actual: { ["$ref"]: "steps.read-letter.dropped" },
    expected: 4,
  });
  scenario.stress = ["terms"];
  await expect(runScenario(profile, scenario, { compare: false })).resolves.toBeDefined();
});

it("transports raw byte arrays with the same raw digest checks and quarantined reading labels", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 5);
  const start = scenario.script[2];
  if (start?.type !== "start" || typeof start.content[0]?.bytes !== "string")
    throw new Error("fixture");
  start.content[0].bytes = [...new TextEncoder().encode(start.content[0].bytes)];
  const [path] = await runScenario(profile, scenario, { compare: false });
  const received = path?.trace?.events.find(
    (e) => e.agent === "practice-agent" && e.kind === "message-in",
  );
  const raw = received?.packet?.layers.content.raw as { content?: { bytes: unknown }[] };
  expect(Array.isArray(raw.content?.[0]?.bytes)).toBe(true);
  expect(
    path?.trace?.events.some((e) =>
      e.caption.includes("Model-output reading of unstructured data"),
    ),
  ).toBe(true);
  expect(
    path?.trace?.events.some(
      (e) => e.agent === "practice-agent" && e.reason === "evidence-invalid",
    ),
  ).toBe(false);
});
