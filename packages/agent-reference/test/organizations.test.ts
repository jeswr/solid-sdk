// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");
it("runs supplier onboarding and both catalogue refusals through current documents, credential status and source gates", async () => {
  const { profile, scenario } = loadCase(root, "supplier-onboarding");
  const paths = await runScenario(profile, scenario);
  expect(paths.every((p) => p.matches && !p.blocked)).toBe(true);
  expect(
    paths[0]?.trace?.events.some(
      (e) => e.agent === "buyer-agent" && e.check === "authority" && e.verdict === "pass",
    ),
  ).toBe(true);
  expect(paths[1]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "status-withdrawn",
  });
  expect(paths[2]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "source-not-authoritative",
  });
});

it("checks current delegated keys, mandate withdrawal, unreachable/stale status and entity, role and action scope", async () => {
  for (const attack of [
    "removed-key",
    "withdrawn",
    "unreachable",
    "stale",
    "entity",
    "role",
    "action",
  ]) {
    const { profile, scenario } = loadCase(root, "supplier-onboarding");
    scenario.branches = [];
    scenario.script = scenario.script.slice(0, 3);
    scenario.stress = ["integrity"];
    const credential = scenario.organizationCredentials[0];
    const doc = scenario.documents.find((d) => d.id === "urn:fictional:supplier");
    const status = scenario.documents.find((d) => d.id === "urn:status:supplier");
    if (!credential || !doc || !status) throw new Error("fixture");
    let reason = "representation-out-of-scope";
    if (attack === "removed-key") {
      doc.value.keys = (doc.value.keys as { role: string }[]).filter((k) => k.role !== "actor");
      reason = "unknown-key";
    }
    if (attack === "withdrawn") {
      status.value.entries = { signatory: "withdrawn" };
      reason = "mandate-withdrawn";
    }
    if (attack === "unreachable") {
      scenario.documents = scenario.documents.filter((d) => d.id !== status.id);
      reason = "lookup-failed";
    }
    if (attack === "stale") {
      status.value.issuedAt = "2026-11-13T07:00:00.000Z";
      reason = "stale-data";
    }
    if (attack === "entity") credential.entity = "urn:fictional:another-entity";
    if (attack === "role") credential.roles = ["employee"];
    if (attack === "action") credential.actions = ["accept"];
    const [path] = await runScenario(profile, scenario, { compare: false });
    const events = path?.trace?.events ?? [];
    expect(
      events.some((e) => e.agent === "buyer-agent" && e.reason === reason),
      attack,
    ).toBe(true);
    expect(
      events.some((e) => e.agent === "buyer-agent" && e.outcome === "admit"),
      attack,
    ).toBe(false);
  }
});

it("cannot reuse certificate status from the wrong issuer, or a status answer older than the profile permits", async () => {
  for (const forged of [true, false]) {
    const { profile, scenario } = loadCase(root, "supplier-onboarding");
    scenario.branches = [];
    scenario.script = scenario.script.slice(0, 2);
    scenario.stress = ["source"];
    const doc = scenario.documents.find((d) => d.id === "urn:status:certifier");
    if (!doc) throw new Error("fixture");
    if (forged) doc.issuer = "supplier-bank";
    else doc.value.issuedAt = "2026-11-13T07:00:00.000Z";
    const [path] = await runScenario(profile, scenario, { compare: false });
    expect(
      path?.trace?.events.some((e) => e.reason === (forged ? "evidence-invalid" : "stale-data")),
    ).toBe(true);
    expect(path?.trace?.events.some((e) => e.kind === "message-out")).toBe(false);
  }
});
