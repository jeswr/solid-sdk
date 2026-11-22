// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { AuthorityChainChecks, type ChainPolicy } from "../src/mechanisms/authority-chain.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";

async function fixture() {
  const ids = ["register", "holder", "middle", "actor"];
  const keys = await Promise.all(ids.map((id) => testKey(`chain/${id}`)));
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:receiver",
    keys: keys.map((k, i) => ({
      kid: k.kid,
      alg: k.alg,
      publicJwk: k.publicJwk,
      role: "issuer" as const,
      subject: `urn:${ids[i]}`,
    })),
    sourceAuthority: [],
  });
  const links = ids.slice(0, 3).map((issuer, i) => ({
    type: "MandateLink",
    id: `urn:link:${i}`,
    issuer: `urn:${issuer}`,
    subject: `urn:${ids[i + 1]}`,
    subjectKey: required(keys[i + 1]).kid,
    entity: "urn:subject",
    ...(i ? { parent: `urn:link:${i - 1}` } : {}),
    actions: ["invoke"],
    scope: { operations: ["urn:op"], subjects: ["urn:subject"], purposes: ["urn:purpose"] },
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    status: { ref: `urn:status:${i}`, id: "power" },
    ...(i < 2 ? { mayDelegate: { depth: 3 - i } } : {}),
  }));
  const statuses = links.map((l, i) => ({
    type: "StatusList",
    id: `urn:status:${i}`,
    issuer: l.issuer,
    issuedAt: "2026-11-13T09:00:00.000Z",
    validUntil: l.validUntil,
    entries: { power: "active" },
  }));
  const documents: Record<string, string> = {};
  const reads: string[] = [];
  const policy: ChainPolicy = {
    roots: [{ issuer: "urn:register", entity: "urn:subject", operations: ["urn:op"] }],
    maxStatusAgeSeconds: 60,
    holders: "any",
    objectionRole: "safeguarding-lead",
  };
  const checks = new AuthorityChainChecks({
    policy,
    trust,
    now: () => "2026-11-13T09:00:00.000Z",
    verifier: "urn:receiver",
    record: () => {},
    resolver: {
      resolve: async (id) => {
        reads.push(id);
        return documents[id];
      },
    },
  });
  async function encode() {
    for (const [i, s] of statuses.entries())
      documents[s.id] = await signStatement(required(keys[i]), "awp-status-list+jws", s);
    return JSON.stringify([
      await Promise.all(
        links.map((l, i) => signStatement(required(keys[i]), "awp-mandate-link+jws", l)),
      ),
    ]);
  }
  const expected = {
    actor: "urn:actor",
    kid: required(keys[3]).kid,
    entity: "urn:subject",
    action: "invoke",
    operation: "urn:op",
    subject: "urn:subject",
    purpose: "urn:purpose",
  };
  return { checks, links, statuses, documents, reads, expected, encode, policy, keys };
}
it("verifies three links and resolves each status afresh on every use", async () => {
  const f = await fixture();
  const encoded = await f.encode();
  expect(await f.checks.check(encoded, f.expected)).toMatchObject({ ok: true });
  expect(await f.checks.check(encoded, f.expected)).toMatchObject({ ok: true });
  expect(f.reads).toEqual([
    "urn:status:0",
    "urn:status:1",
    "urn:status:2",
    "urn:status:0",
    "urn:status:1",
    "urn:status:2",
  ]);
});
it("rejects missing, invalid, expired, withdrawn and unreadable chains with distinct reasons", async () => {
  for (const attack of [
    "missing",
    "signature",
    "parent",
    "delegate",
    "depth",
    "expired",
    "revoked-middle",
    "stale",
    "unreadable",
    "actor",
    "root",
  ]) {
    const f = await fixture();
    let reason = "representation-invalid";
    if (attack === "parent") {
      required(f.links[1]).parent = undefined;
      reason = "representation-missing";
    }
    if (attack === "delegate") required(f.links[0]).mayDelegate = undefined;
    if (attack === "depth") required(f.links[0]).mayDelegate = { depth: 1 };
    if (attack === "expired") {
      required(f.links[1]).validUntil = "2026-11-12T00:00:00.000Z";
      reason = "representation-expired";
    }
    if (attack === "revoked-middle") {
      required(f.statuses[1]).entries.power = "withdrawn";
      reason = "mandate-withdrawn";
    }
    if (attack === "stale") {
      required(f.statuses[1]).issuedAt = "2026-11-13T08:00:00.000Z";
      reason = "lookup-failed";
    }
    if (attack === "actor") f.expected.kid = "wrong-key";
    if (attack === "root") required(f.policy.roots[0]).issuer = "urn:unaccepted";
    let encoded: string | undefined = await f.encode();
    if (attack === "signature") {
      const chains = JSON.parse(encoded);
      chains[0][1] = `${chains[0][1].slice(0, -8)}AAAAAAAA`;
      encoded = JSON.stringify(chains);
    }
    if (attack === "missing") {
      encoded = undefined;
      reason = "representation-missing";
    }
    if (attack === "unreadable") {
      delete f.documents["urn:status:1"];
      reason = "lookup-failed";
    }
    expect(await f.checks.check(encoded, f.expected), attack).toMatchObject({ ok: false, reason });
  }
});
it("cannot expand action, subject, purpose, operation or validity at either delegated position", async () => {
  for (const position of [1, 2])
    for (const field of ["actions", "subjects", "purposes", "operations", "validity"]) {
      const f = await fixture();
      const link = required(f.links[position]);
      if (field === "validity") link.validUntil = "2027-01-01T00:00:00.000Z";
      else if (field === "actions") link.actions.push("accept");
      else link.scope[field as "subjects" | "purposes" | "operations"].push("urn:extra");
      expect(
        await f.checks.check(await f.encode(), f.expected),
        `${position}/${field}`,
      ).toMatchObject({ ok: false, reason: "representation-out-of-scope" });
    }
  const f = await fixture();
  f.expected.subject = "urn:other-subject";
  expect(await f.checks.check(await f.encode(), f.expected)).toMatchObject({
    reason: "representation-out-of-scope",
  });
});
it("runs all chain catalogue paths, including a register-recorded objection addressed to a role", async () => {
  for (const id of ["carer-acts-for-parent", "tax-agent", "consent-for-a-child", "agent-handoff"]) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), id);
    const paths = await runScenario(profile, scenario);
    expect(
      paths.every((p) => !p.blocked && p.matches),
      id,
    ).toBe(true);
    if (id === "consent-for-a-child") {
      expect(paths[1]?.actual).toMatchObject({
        outcome: "ask-principal",
        reason: "approval-required",
      });
      expect(
        paths[1]?.trace?.events.some((e) => e.caption.includes("school-safeguarding-lead")),
      ).toBe(true);
      required(profile.authorityChains).holders = "all";
      scenario.branches = [];
      scenario.expect = [];
      scenario.stress = ["authority"];
      const [held] = await runScenario(profile, scenario, { compare: false });
      expect(held?.actual).toMatchObject({ outcome: "refuse", reason: "representation-missing" });
    }
  }
});
it("requires and accepts every registered holder under all, and detects a missing middle link", async () => {
  const f = await fixture();
  f.policy.holders = "all";
  Object.assign(required(f.links[0]), { holderSet: "urn:holder-set" });
  const encoded = JSON.parse(await f.encode()) as string[][];
  f.documents["urn:holder-set"] = await signStatement(
    required(f.keys[0]),
    "awp-authority-holders+jws",
    {
      type: "AuthorityHolders",
      id: "urn:holder-set",
      issuer: "urn:register",
      entity: "urn:subject",
      issuedAt: "2026-11-13T09:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
      holders: ["urn:holder", "urn:middle"],
      objections: [],
    },
  );
  expect(await f.checks.check(JSON.stringify(encoded), f.expected)).toMatchObject({
    reason: "representation-missing",
  });
  const root = {
    ...f.links[0],
    id: "urn:second-root",
    subject: "urn:middle",
    subjectKey: required(f.keys[2]).kid,
  };
  const leaf = { ...f.links[2], parent: root.id };
  encoded.push([
    await signStatement(required(f.keys[0]), "awp-mandate-link+jws", root),
    await signStatement(required(f.keys[2]), "awp-mandate-link+jws", leaf),
  ]);
  expect(await f.checks.check(JSON.stringify(encoded), f.expected)).toMatchObject({ ok: true });
  const absent = await fixture();
  const broken = JSON.parse(await absent.encode()) as string[][];
  required(broken[0]).splice(1, 1);
  expect(await absent.checks.check(JSON.stringify(broken), absent.expected)).toMatchObject({
    reason: "representation-missing",
  });
  const wider = await fixture();
  required(wider.links[0]).scope.operations.push("urn:outside-register-scope");
  expect(await wider.checks.check(await wider.encode(), wider.expected)).toMatchObject({
    reason: "representation-out-of-scope",
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
