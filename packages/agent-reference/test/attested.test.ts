// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";

const referenceKey = "$ref";

import { digestOf } from "../src/core/canonical.js";
import type { JsonObject } from "../src/core/types.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { issueMappingAttestation, mapCodeClaim } from "../src/mechanisms/code-mapping.js";
import { LocalDocumentResolver } from "../src/mechanisms/organizations.js";
import { signStatement, TYP } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";

const root = join(import.meta.dirname, "..");
it("runs both previously blocked attested main paths and retains the joint-computation blocker", async () => {
  for (const id of ["find-a-time", "care-abroad"]) {
    const { profile, scenario } = loadCase(root, id);
    const paths = await runScenario(profile, scenario);
    expect(
      paths.every((p) => p.trace && !p.disagrees),
      id,
    ).toBe(true);
  }
  const { profile, scenario } = loadCase(root, "cohort-count");
  const jointPaths = await runScenario(profile, scenario, { registry: verifierRegistry() });
  for (const path of jointPaths) {
    expect(path.blocked).toBe(
      "needs joint computation: needs the sparq-aggregate/1 package, which is not installed",
    );
    expect(path.trace).toBeUndefined();
  }
});
it("the calendar evaluates the named rule, reveals only the signed slot result and admits it at both recipients", async () => {
  const { profile, scenario } = loadCase(root, "find-a-time");
  const paths = await runScenario(profile, scenario);
  const events = required(required(paths[0]).trace).events;
  for (const recipient of ["owner-agent", "receiver-agent"]) {
    const facts = events.filter((e) => e.agent === recipient && e.fact);
    expect(facts).toHaveLength(1);
    expect(required(facts[0]).fact).toMatchObject({
      claimType: "calendar.slot-free",
      source: "urn:fictional:find-a-time:calendar-service",
      method: "derived",
    });
    expect(
      events.some(
        (e) =>
          e.agent === recipient &&
          e.kind === "check" &&
          e.check === "source" &&
          e.verdict === "fail",
      ),
    ).toBe(false);
  }
  scenario.branches = [];
  scenario.expect = [];
  scenario.script = scenario.script.filter((s) => s.type !== "assert");
  required(scenario.statements.find((s) => s.id === "second-free")).value.value = false;
  scenario.script.push({
    id: "check-false",
    agent: "receiver-agent",
    type: "assert",
    operator: "equals",
    actual: { [referenceKey]: "steps.receiver-facts.0.value" },
    expected: false,
  });
  await expect(runScenario(profile, scenario, { compare: false })).resolves.toHaveLength(1);
});
it("refuses an otherwise valid signed calendar result when this deriver is not accepted for that rule and purpose", async () => {
  for (const mismatch of ["deriver", "rule", "purpose"]) {
    const { profile, scenario } = loadCase(root, "find-a-time");
    scenario.branches = [];
    scenario.expect = [];
    scenario.script = scenario.script.slice(0, 2);
    scenario.stress = ["integrity", "source"];
    scenario.script.push({
      id: "receiver-check",
      agent: "owner-agent",
      type: "admit-derived",
      jws: { [referenceKey]: "steps.derive-slot.jws" },
      purpose: "urn:purpose:find-a-time",
    });
    const accepted = required(profile.attestedDerivers[0]);
    if (mismatch === "deriver") accepted.deriver = "urn:unaccepted-calendar";
    if (mismatch === "rule") accepted.rule = "urn:other-rule";
    if (mismatch === "purpose") accepted.purposes = ["urn:purpose:other"];
    const [path] = await runScenario(profile, scenario, { compare: false });
    expect(path?.actual, mismatch).toMatchObject({
      outcome: "refuse",
      reason: "source-not-authoritative",
    });
    expect(path?.trace?.events.some((e) => e.agent === "owner-agent" && e.fact)).toBe(false);
  }
});
async function mappingFixture() {
  const { profile, scenario } = loadCase(root, "care-abroad"),
    policy = required(profile.codeMappings);
  const registry = await testKey("attested/mapping-registry"),
    source = await testKey("attested/clinical-source");
  const table = required(scenario.mappingTables[0]).value,
    clinical = required(scenario.statements[0]);
  const original: JsonObject = {
    ...clinical.value,
    id: "urn:scenario:care-abroad:medicine",
    issuer: "urn:fictional:care-abroad:party-2",
    subject: required(clinical.subject),
    claimType: clinical.kind,
    method: clinical.method,
    asOf: required(clinical.asOf),
    terms: required(clinical.terms),
  };
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
    keys: [pin(registry, table.issuer), pin(source, String(original.issuer))],
    sourceAuthority: [
      {
        id: "urn:clinical-rule",
        version: "1",
        source: String(original.issuer),
        claimTypes: ["medicine.code"],
        subjects: [String(original.subject)],
      },
      {
        id: "urn:mapping-rule",
        version: "1",
        source: table.issuer,
        claimTypes: ["code-mapping"],
        subjects: [table.fromList],
      },
    ],
  });
  const docs: Record<string, string> = {
    [table.id]: await signStatement(registry, "awp-code-mapping-table+jws", table),
    [table.status.ref]: await signStatement(
      registry,
      "awp-status-list+jws",
      required(scenario.documents[0]).value,
    ),
  };
  const resolver = new LocalDocumentResolver(docs),
    options = {
      policy,
      trust,
      resolver,
      at: "2026-11-13T09:00:00.000Z",
      verifier: "urn:clinic",
      purpose: "urn:purpose:care-abroad",
      record: () => {},
      attestedDerivers: profile.attestedDerivers,
    };
  const issued = await issueMappingAttestation(
    await signStatement(source, TYP.statement, original),
    { ...options, identity: table.issuer, key: registry },
  );
  if (!issued) throw new Error("mapping source failed to derive");
  docs[issued.ref] = issued.jws;
  return { options, original, issued, docs, registry };
}
it("checks the mapping deriver's signature over the original digest, table version and actual mapped output", async () => {
  const f = await mappingFixture();
  const result = await mapCodeClaim(f.original, f.options);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error("no mapped result");
  expect(result.statement.derivation).toMatchObject({
    assurance: "attested",
    deriver: "urn:fictional:care-abroad:mapping-registry",
    version: "1",
    originalDigest: digestOf(f.original),
    attestation: f.issued.jws,
  });
  const unsigned = JSON.parse(
    Buffer.from(required(f.issued.jws.split(".")[1]), "base64url").toString(),
  );
  for (const attack of ["signature", "output", "digest", "version", "future"]) {
    const next = structuredClone(unsigned);
    if (attack === "output") next.output.code = "WRONG";
    if (attack === "digest") next.originalDigest = "changed";
    if (attack === "version") next.version = "old";
    if (attack === "future") next.at = "2027-01-01T00:00:00.000Z";
    f.docs[f.issued.ref] =
      attack === "signature"
        ? `${f.issued.jws.slice(0, -4)}AAAA`
        : await signStatement(f.registry, "awp-mapping-attestation+jws", next);
    expect(await mapCodeClaim(f.original, f.options), attack).toMatchObject({
      ok: false,
      reason: "derivation-not-verified",
    });
  }
  f.docs[f.issued.ref] = f.issued.jws;
  expect(await mapCodeClaim(f.original, { ...f.options, attestedDerivers: [] })).toMatchObject({
    reason: "source-not-authoritative",
  });
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}
