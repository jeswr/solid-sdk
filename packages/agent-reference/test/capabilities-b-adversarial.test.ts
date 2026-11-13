// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import { Cast, mandateOf } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { emptyState, FileStateStore } from "../src/store/state.js";

const root = join(import.meta.dirname, "..");

it("counts a typed model reading when its method and reading agent are accepted, retaining source terms", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  const diagnosis = profile.claims.find((c) => c.kind === "clinical.diagnosis");
  if (!diagnosis) throw new Error("fixture");
  diagnosis.sources = ["urn:fictional:practice-agent:agent"];
  diagnosis.methods = ["model-output"];
  scenario.trust.sources["practice-agent"]?.push({
    id: "urn:source:own-reading",
    version: "1",
    source: "urn:fictional:practice-agent:agent",
    claimTypes: ["clinical.diagnosis"],
    subjects: "any",
  });
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 6);
  scenario.stress = ["fitness"];
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(
    path?.trace?.events.some(
      (e) =>
        e.agent === "practice-agent" &&
        e.check === "fitness" &&
        e.verdict === "pass" &&
        e.caption.includes("model-output"),
    ),
  ).toBe(true);
  expect(path?.trace?.events.at(-1)).toMatchObject({ outcome: "go" });
});

it("does not treat a sender's asserted principal as the content source without its source binding", async () => {
  const { profile, scenario } = loadCase(root, "discharge-letter");
  const operation = profile.operations.find((o) => o.id === "urn:op:letter");
  if (!operation) throw new Error("fixture");
  operation.requiresRepresentation = false;
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 5);
  scenario.stress = ["integrity"];
  scenario.inject = [
    { step: "letter-arrives", target: "message", path: ["evidence"], value: [], resign: true },
    {
      step: "letter-arrives",
      target: "message",
      path: ["from", "onBehalfOf"],
      value: "urn:fictional:hospital",
      resign: true,
    },
  ];
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(
    path?.trace?.events.some(
      (e) =>
        e.caption.includes("Unstructured data") &&
        e.caption.includes("source urn:fictional:patient"),
    ),
  ).toBe(true);
});

it("checks the actual signed emergency request and actual output, including future or withdrawn roles", async () => {
  for (const attack of ["request", "output", "future", "withdrawn-status", "missing-items"]) {
    const { profile, scenario } = loadCase(root, "emergency-access");
    scenario.branches = [];
    scenario.script = scenario.script.slice(0, 5);
    scenario.stress = ["mandate"];
    const release = scenario.script[4],
      request = scenario.script[2],
      role = scenario.statements.find((s) => s.id === "role");
    if (release?.type !== "message" || request?.type !== "start" || !role)
      throw new Error("fixture");
    if (attack === "missing-items" && release.intent) release.intent.parameters = {};
    if (attack === "request") request.contents.items = ["whole-record"];
    if (attack === "output")
      release.body.output = {
        items: {
          allergies: "none-known",
          "current-medicines": "none-known",
          "whole-record": "none-known",
        },
      };
    if (attack === "future") role.value.validFrom = "2026-11-14T00:00:00.000Z";
    if (attack === "withdrawn-status") role.value.status = "withdrawn";
    const [path] = await runScenario(profile, scenario, { compare: false });
    expect(
      path?.trace?.events.some((e) => e.agent === "record-agent" && e.outcome === "stop"),
      attack,
    ).toBe(true);
    expect(
      path?.trace?.events.some((e) => e.agent === "record-agent" && e.kind === "message-out"),
      attack,
    ).toBe(false);
  }
});

it("requires certificate status even when an authentic issuer omits its status reference", async () => {
  const { profile, scenario } = loadCase(root, "supplier-onboarding");
  const certificate = scenario.statements.find((s) => s.id === "certificate");
  if (!certificate) throw new Error("fixture");
  delete certificate.value.status;
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 2);
  scenario.stress = ["source"];
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(path?.trace?.events.at(-1)).toMatchObject({ outcome: "stop", reason: "lookup-failed" });
  expect(path?.trace?.events.some((e) => e.kind === "message-out")).toBe(false);
});

it("a notification duty survives a real file-store restart and becomes a recorded failure after its deadline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "brief12-duty-"));
  let time = new Date("2026-11-13T09:00:00.000Z");
  try {
    const cast = new Cast(() => time);
    const agent = await cast.add(
      { name: "patient", actor: "urn:patient:agent", party: "urn:patient" },
      mandateOf("duty", []),
      [],
    );
    const path = join(directory, "state.json");
    const initial = new FileStateStore(path);
    const state = emptyState();
    // A crash checkpoint immediately after the runtime creates its durable obligation.
    state.notificationDuties.duty = {
      id: "duty",
      rule: "urn:rule:emergency",
      use: "urn:message:read",
      recipient: "principal",
      due: "2026-11-13T10:00:00.000Z",
      status: "pending",
    };
    initial.save(state);
    initial.close();
    const ledger = new MemoryLedger();
    const options = {
      identity: { actor: agent.identity.actor, party: agent.identity.party },
      actorKeys: [agent.actorKey],
      trust: await TrustStore.load(cast.trust.get("patient")),
      mandateJws: agent.mandateJws,
      accepted: [CONFIG_ED25519],
      handlers: [],
      ledger,
      now: () => time,
    };
    const first = await AgentRuntime.create({ ...options, store: new FileStateStore(path) });
    expect(first.notificationDuties()[0]?.status).toBe("pending");
    first.close();
    time = new Date("2026-11-13T10:00:00.001Z");
    const reopened = await AgentRuntime.create({ ...options, store: new FileStateStore(path) });
    expect(reopened.notificationDuties()[0]?.status).toBe("failed");
    expect(ledger.entries().filter((e) => e.record.type === "duty-failed")).toHaveLength(1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("binds a referral's selected action and exact signed grant instead of accepting another action label or grant digest", async () => {
  for (const attack of ["action", "digest", "missing-items"]) {
    const { profile, scenario } = loadCase(root, "health-referral");
    profile.personDecisions = [];
    scenario.branches = [];
    scenario.script = scenario.script.slice(0, 2);
    scenario.stress = ["mandate"];
    const start = scenario.script[1];
    if (start?.type !== "start") throw new Error("fixture");
    if (attack === "missing-items")
      delete (start.intent.parameters as Record<string, unknown>).items;
    if (attack === "action") start.intent.action = "read";
    if (attack === "digest")
      (start.intent.parameters as Record<string, unknown>).grantDigest = "wrong-grant";
    const [path] = await runScenario(profile, scenario, { compare: false });
    expect(
      path?.trace?.events.some((e) => e.kind === "message-out"),
      attack,
    ).toBe(false);
    expect(path?.trace?.events.at(-1)).toMatchObject({
      outcome: "stop",
      reason: "evidence-invalid",
    });
  }
});
