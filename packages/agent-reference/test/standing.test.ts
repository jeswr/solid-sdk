// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

it("runs registered and unregistered emergencies, with two separately gated notification messages", async () => {
  const { profile, scenario } = loadCase(root, "emergency-access");
  const paths = await runScenario(profile, scenario);
  expect(paths).toHaveLength(3);
  expect(paths.every((p) => p.matches)).toBe(true);
  const events = paths[0]?.trace?.events ?? [];
  expect(events.filter((e) => e.caption.includes("discharged at"))).toHaveLength(2);
  expect(events.some((e) => e.agent === "patient-agent" && e.kind === "message-in")).toBe(true);
  expect(events.some((e) => e.agent === "contact-agent" && e.kind === "message-in")).toBe(true);
  expect(paths[2]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "source-unknown",
  });
});

it("refuses whole-record scope, an expired rule, withdrawn role, wrong key, stale role, and unsigned-in-fact emergency absence", async () => {
  for (const attack of [
    "whole-record",
    "expired-rule",
    "withdrawn",
    "wrong-key",
    "stale",
    "no-declaration",
  ]) {
    const { profile, scenario } = loadCase(root, "emergency-access");
    scenario.branches = [];
    scenario.script = scenario.script.slice(0, 5);
    scenario.stress = ["mandate"];
    const role = scenario.statements.find((s) => s.id === "role");
    const mandate = scenario.mandates.find((m) => m.agent === "record-agent");
    const release = scenario.script[4];
    if (!role || !mandate || release?.type !== "message" || !release.intent)
      throw new Error("fixture");
    if (attack === "whole-record") release.intent.parameters = { items: ["whole-record"] };
    if (attack === "expired-rule" && mandate.standingRules[0])
      mandate.standingRules[0].expires = "2026-11-12T00:00:00.000Z";
    if (attack === "withdrawn") role.value.withdrawn = true;
    if (attack === "wrong-key") role.value.actorKeyOf = "patient-agent";
    if (attack === "stale") {
      role.value.validUntil = "2026-11-13T09:30:00.000Z";
      scenario.script.splice(4, 0, {
        id: "role-expires",
        agent: "record-agent",
        type: "advance",
        milliseconds: 1800001,
      });
    }
    if (attack === "no-declaration") {
      const admission = scenario.script[0],
        request = scenario.script[2];
      if (admission?.type !== "admit" || request?.type !== "start") throw new Error("fixture");
      admission.statements = ["role"];
      request.evidence = ["role"];
    }
    const [path] = await runScenario(profile, scenario, { compare: false });
    const events = path?.trace?.events ?? [];
    expect(
      events.some((e) => e.agent === "record-agent" && e.outcome === "stop"),
      attack,
    ).toBe(true);
    expect(
      events.some((e) => e.agent === "record-agent" && e.kind === "message-out"),
      attack,
    ).toBe(false);
    if (attack === "whole-record") expect(events.at(-1)?.reason).toBe("excessive-scope");
  }
});

it("records both duties as failed once their hour passes, and repeated audit cannot erase failure", async () => {
  const { profile, scenario } = loadCase(root, "emergency-access");
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 6);
  scenario.script.push(
    { id: "late", agent: "record-agent", type: "advance", milliseconds: 3600001 },
    { id: "audit", agent: "record-agent", type: "duties" },
    {
      id: "failed",
      agent: "record-agent",
      type: "assert",
      operator: "equals",
      actual: { ["$ref"]: "steps.audit.0.status" },
      expected: "failed",
    },
  );
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(
    path?.trace?.events.filter((e) => e.caption.startsWith("Failed notification duty")),
  ).toHaveLength(2);
});
