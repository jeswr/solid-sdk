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
it("keeps the issuer-signed original beside a new mapped object, with its id, digest and verifiable proof", async () => {
  const { InboundGate, claimSchema } = await import("../src/gates/inbound.js"),
    { GateMemory } = await import("../src/gates/common.js"),
    { DEFAULT_LIMITS } = await import("../src/core/limits.js"),
    { digestOf } = await import("../src/core/canonical.js"),
    { testKey } = await import("../src/reference/keys.js"),
    { TrustStore } = await import("../src/mechanisms/trust.js"),
    { LocalDocumentResolver } = await import("../src/mechanisms/organizations.js"),
    { signStatement, verifyStatement, TYP } = await import("../src/mechanisms/statements.js");
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "care-abroad"),
    table = required(scenario.mappingTables[0]).value,
    clinical = required(scenario.statements[0]),
    at = "2026-11-13T09:00:00.000Z";
  const source = await testKey("mapping/original-source"),
    registry = await testKey("mapping/registry"),
    issuer = "urn:fictional:care-abroad:party-2",
    subject = required(clinical.subject);
  const pin = (key: typeof source, subject: string) => ({
    kid: key.kid,
    alg: key.alg,
    publicJwk: key.publicJwk,
    role: "issuer" as const,
    subject,
  });
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:clinic",
    keys: [pin(source, issuer), pin(registry, table.issuer)],
    sourceAuthority: [
      {
        id: "urn:clinical-source",
        version: "1",
        source: issuer,
        claimTypes: [clinical.kind],
        subjects: [subject],
      },
      {
        id: "urn:mapping-source",
        version: "1",
        source: table.issuer,
        claimTypes: ["code-mapping"],
        subjects: [table.fromList],
      },
    ],
  });
  const original = {
    ...clinical.value,
    id: "urn:scenario:care-abroad:medicine",
    issuer,
    subject,
    claimType: clinical.kind,
    method: clinical.method,
    asOf: at,
    terms: clinical.terms,
  };
  const jws = await signStatement(source, TYP.statement, original),
    memory = new GateMemory();
  const resolver = new LocalDocumentResolver({
    [table.id]: await signStatement(registry, "awp-code-mapping-table+jws", table),
    [table.status.ref]: await signStatement(
      registry,
      "awp-status-list+jws",
      required(scenario.documents[0]).value,
    ),
  });
  const gate = new InboundGate({
    identity: { actor: "urn:clinic" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: () => {},
    memory,
    agreementTerms: () => undefined,
    gate: {
      codeMappings: {
        policy: { ...required(profile.codeMappings), assurance: "recomputed" },
        resolver,
      },
      reliance: {
        id: "urn:reliance",
        rules: profile.claims.map((c) => ({
          id: `urn:reliance:${c.kind}`,
          claimType: c.kind,
          methods: c.methods,
          maxAgeDays: c.maxAgeDays,
          text: "Mapping quality.",
        })),
      },
    },
  });
  expect(
    await gate.admitStatements([{ jws }], { task: "urn:task", purpose: "urn:purpose:care-abroad" }),
  ).toEqual({ admitted: 1, refused: 0 });
  const mapped = required([...memory.facts.values()][0]),
    saved = required(mapped.original);
  expect(mapped.id).not.toBe(original.id);
  expect(saved.statement).toEqual(original);
  expect(saved).toMatchObject({
    id: original.id,
    digest: digestOf(original),
    evidence: { value: jws },
  });
  expect(mapped.statement?.derivation).toMatchObject({
    originalId: original.id,
    originalDigest: saved.digest,
  });
  const checked = await verifyStatement(saved.evidence.value, {
    trust,
    typ: TYP.statement,
    role: "issuer",
    schema: claimSchema,
    limits: DEFAULT_LIMITS,
    verifier: "urn:clinic",
    at,
  });
  expect(checked.verification.outcome).toBe("valid");
  expect(checked.payload).toEqual(saved.statement);
  expect(digestOf(checked.payload)).toBe(saved.digest);
  expect(memory.context("*")[0]?.original?.evidence.value).toBe(jws);
});
