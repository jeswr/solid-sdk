// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

async function run(attack = "none", lowered = false) {
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "care-abroad");
  scenario.assurance = null;
  scenario.blocked = [];
  scenario.branches = [];
  scenario.expect = [];
  scenario.result = undefined;
  scenario.script = scenario.script.filter((s) => s.type !== "assert");
  if (!profile.codeMappings) throw new Error("mapping profile missing");
  const medicine = required(scenario.statements[0]),
    table = required(scenario.mappingTables[0]);
  if (attack === "approximate") medicine.value.code = "A2";
  if (attack === "missing") medicine.value.code = "UNMAPPED";
  if (attack === "withdrawn")
    required(scenario.documents[0]).value.entries = { "table-version-1": "withdrawn" };
  if (attack === "tampered") table.tamper = true;
  if (attack === "unreadable") scenario.mappingTables = [];
  if (attack === "stale-status")
    required(scenario.documents[0]).value.issuedAt = "2026-11-13T08:00:00.000Z";
  if (attack === "stale-original") medicine.asOf = "2025-01-01T00:00:00.000Z";
  if (attack === "poor-original") medicine.method = "self-reported";
  if (attack === "wrong-registry")
    required(profile.codeMappings.routes[0]).registry = "urn:wrong-registry";
  if (lowered) profile.codeMappings.approximate = "admit-lowered";
  const paths = await runScenario(profile, scenario, { compare: false });
  return required(paths[0]);
}
it("maps exactly and records the original source, quality, digest, table and version", async () => {
  const result = await run();
  expect(result.trace).toBeDefined();
  expect(required(result.trace).events.some((e) => e.outcome === "admit")).toBe(true);
  const fact = required(
    required(required(result.trace).events.find((e) => e.fact?.claimType === "medicine.code")).fact,
  );
  expect(fact.source).toBe("urn:fictional:care-abroad:party-2");
  expect(fact.method).toBe("derived");
  expect(fact.asOf).toBe("2026-11-13T09:00:00.000Z");
  expect(fact.value).toMatchObject({
    codeList: "urn:medicine-list:B",
    code: "B7",
    derivation: {
      type: "code-mapping",
      version: "1",
      originalSource: fact.source,
      originalQuality: { method: "recorded-by-authority", asOf: fact.asOf },
      originalDigest: expect.stringMatching(/^sha-256:/),
      mappingDigest: expect.stringMatching(/^sha-256:/),
      standing: "original",
    },
  });
  expect(fact.provenance).toContain("Locally mapped; original signed by");
});
it("lowers approximate standing according to the profile, rather than upgrading the source", async () => {
  const asked = await run("approximate");
  expect(asked.actual).toMatchObject({ outcome: "ask-more", reason: "confidence-too-low" });
  expect(required(asked.trace).events.some((e) => e.fact?.claimType === "medicine.code")).toBe(
    false,
  );
  const allowed = await run("approximate", true);
  const fact = required(
    required(required(allowed.trace).events.find((e) => e.fact?.claimType === "medicine.code"))
      .fact,
  );
  expect(fact.label).toContain("reduced standing");
  expect(fact.value).toMatchObject({
    derivation: {
      approximate: true,
      standing: "lowered",
      originalQuality: { method: "recorded-by-authority" },
    },
  });
});
it("names unsupported codes and refuses withdrawn, tampered or unreadable registries", async () => {
  for (const [attack, reason, outcome] of [
    ["missing", "unsupported-term", "ask-more"],
    ["withdrawn", "status-withdrawn", "refuse"],
    ["tampered", "bad-signature", "refuse"],
    ["unreadable", "lookup-failed", "ask-more"],
    ["stale-status", "lookup-failed", "ask-more"],
    ["stale-original", "stale-data", "refuse"],
    ["poor-original", "method-not-accepted", "refuse"],
    ["wrong-registry", "bad-signature", "refuse"],
  ]) {
    const r = await run(attack);
    expect(r.actual, attack).toMatchObject({ reason, outcome });
    expect(
      required(r.trace).events.some((e) => e.fact?.claimType === "medicine.code"),
      attack,
    ).toBe(false);
    if (attack === "missing")
      expect(required(r.trace).events.some((e) => e.caption.includes("UNMAPPED"))).toBe(true);
  }
});
it("runs the no-mapping branch without needing attestation", async () => {
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "care-abroad");
  const paths = await runScenario(profile, scenario);
  expect(paths[1]).toMatchObject({
    actual: { outcome: "ask-more", reason: "unsupported-term" },
    disagrees: false,
  });
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}
