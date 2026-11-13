// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { outlineOf } from "../src/trace/types.js";

const root = join(import.meta.dirname, "..");
const awp = "https://w3id.org/jeswr/awp#",
  uw = "https://underwriter.example/#org",
  uwActor = "https://underwriter.example/agents/check#agent",
  op = `${awp}op/underwriting-check`,
  purpose = `${awp}purpose/credit-assessment`;
const income = "urn:awp:evidence:paywell-income-2026-10#annualised",
  deposit = "urn:awp:evidence:harbourbank-deposit-2026-10";
function underwritingCase() {
  const { profile, scenario } = loadCase(root, "mortgage-core");
  profile.operations.push({
    id: op,
    version: "0.1",
    label: "Underwriting",
    pattern: "negotiate",
    access: "represented",
    models: [{ id: `${awp}model/underwriting-check`, version: "0.1" }],
    purposes: [purpose],
    requiresRepresentation: true,
  });
  scenario.parties.push(
    {
      id: "underwriter",
      identity: uw,
      name: "Underwriter",
      role: "principal",
      runs: "issuer-only",
      handlers: [],
      configurations: ["baseline"],
    },
    {
      id: "underwriter-agent",
      identity: uwActor,
      actor: uwActor,
      name: "Underwriter's agent",
      role: "agent",
      runs: "agent",
      actsFor: "underwriter",
      handlers: ["underwriter-handler"],
      configurations: ["baseline"],
    },
  );
  const lender = scenario.parties.find((p) => p.id === "north-agent");
  if (!lender) throw new Error("fixture");
  lender.handlers.push("lender-underwriting");
  scenario.handlerImplementations["lender-underwriting"] = {
    template: "lender-underwriting",
    params: {},
  };
  scenario.handlerImplementations["underwriter-handler"] = { template: "underwriter", params: {} };
  scenario.mandates.push({
    agent: "underwriter-agent",
    autonomous: [
      { type: "permission", action: "use", target: op },
      { type: "permission", action: "distribute", target: `${awp}op/underwriting-result` },
    ],
    withApproval: [],
    prohibitions: [],
    standingRules: [],
  });
  scenario.trust.introductions.push(["north-agent", "underwriter-agent"]);
  scenario.trust.ownLists["north-agent"] = [{ party: uw, tasks: [op] }];
  scenario.trust.ownLists["underwriter-agent"] = [
    { party: "https://northbank.example/#org", tasks: [op] },
  ];
  scenario.trust.sources["underwriter-agent"] = [
    {
      id: "urn:source:lender-attestations",
      version: "1",
      source: "https://northbank.example/#org",
      claimTypes: ["mortgage.consent-basis", "mortgage.application.derived"],
      subjects: "any",
    },
  ];
  scenario.trust.sources["north-agent"]?.push({
    id: "urn:source:underwriter",
    version: "1",
    source: uw,
    claimTypes: ["underwriting.result"],
    subjects: "any",
  });
  scenario.script = scenario.script.slice(
    0,
    scenario.script.findIndex((s) => s.id === "assessment-time"),
  );
  scenario.script.push({
    id: "handover",
    agent: "north-agent",
    type: "underwriting-handover",
    store: "north-store",
    conversation: { ["$ref"]: "steps.apply.conversation" },
    peer: "underwriter-agent",
    operation: op,
    items: [income, deposit],
    purpose,
  });
  scenario.stress = [];
  return { profile, scenario };
}

it("reproduces all five complete maintained mortgage outlines from data", async () => {
  for (const id of [
    "mortgage-core",
    "mortgage-main",
    "mortgage-injected-fee",
    "mortgage-over-ask",
    "mortgage-out-of-limit",
  ]) {
    const { profile, scenario } = loadCase(root, id);
    const [path] = await runScenario(profile, scenario);
    expect(path?.blocked).toBeUndefined();
    expect(outlineOf(path?.trace ?? { events: [] })).toEqual(
      JSON.parse(readFileSync(join(root, "outlines", `${id}--baseline.json`), "utf8")),
    );
    expect(profile.rules.every((r) => "template" in r)).toBe(true);
  }
}, 15_000);

it("carries consent-bound fields through the actual underwriting handlers and both parties' gates", async () => {
  const { profile, scenario } = underwritingCase();
  for (const [id, agent, from] of [
    ["describe-underwriter", "underwriter-agent", "north-agent"],
    ["underwriter-description", "north-agent", "underwriter-agent"],
    ["underwriter-proposal", "underwriter-agent", "north-agent"],
    ["underwriter-accept", "north-agent", "underwriter-agent"],
    ["underwriting-result", "north-agent", "underwriter-agent"],
    ["underwriting-receipt", "underwriter-agent", "north-agent"],
  ]) {
    scenario.script.push({ id: id as string, agent: agent as string, type: "receive", from });
  }
  scenario.script.push(
    {
      id: "lender-phase",
      agent: "north-agent",
      type: "conversation",
      conversation: { ["$ref"]: "steps.handover.conversation" },
    },
    {
      id: "complete",
      agent: "north-agent",
      type: "assert",
      operator: "equals",
      actual: { ["$ref"]: "steps.lender-phase.phase" },
      expected: "completed",
    },
  );
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(
    path?.trace?.events.some(
      (e) => e.agent === "underwriter-agent" && e.check === "source" && e.verdict === "pass",
    ),
  ).toBe(true);
  expect(
    path?.trace?.events.some(
      (e) =>
        e.agent === "underwriter-agent" && e.packet?.kind === "deliver" && e.kind === "message-out",
    ),
  ).toBe(true);
});

it("the store refuses marketing, relabelled staff access, unauthorized onward scope and expired grants", async () => {
  for (const attack of ["marketing", "relabelled", "scope", "expired"]) {
    const { profile, scenario } = underwritingCase();
    const handover = scenario.script.pop();
    if (handover?.type !== "underwriting-handover") throw new Error("fixture");
    if (attack === "marketing" || attack === "relabelled") {
      scenario.script.push(
        {
          id: "refused-store-read",
          agent: "north-agent",
          type: "store-request",
          store: "north-store",
          request: {
            agent: "https://northbank.example/agents/marketing#agent",
            action: "read",
            items: [income],
            purpose: attack === "marketing" ? `${awp}purpose/marketing` : purpose,
          },
        },
        {
          id: "denied",
          agent: "north-agent",
          type: "assert",
          operator: "equals",
          actual: { ["$ref"]: "steps.refused-store-read.decision" },
          expected: "deny",
        },
      );
    } else {
      if (attack === "scope") handover.items.push("urn:awp:evidence:paywell-income-2026-10");
      if (attack === "expired")
        scenario.script.push({
          id: "retention-passes",
          agent: "north-agent",
          type: "advance",
          milliseconds: 61 * 86400000,
        });
      scenario.script.push(handover, {
        id: "not-shared",
        agent: "north-agent",
        type: "assert",
        operator: "equals",
        actual: { ["$ref"]: "steps.handover.permitted" },
        expected: false,
      });
    }
    await expect(runScenario(profile, scenario, { compare: false })).resolves.toBeDefined();
  }
});
