// AUTHORED-BY Codex GPT-6.1-Sol

import { defaultMandate, issueApproval, issueMandate, mandateToTurtle } from "@jeswr/agent-mandate";
import { digestOf } from "@jeswr/agent-model";
import { beforeEach, expect, it } from "vitest";
import { proposalStorage, runAuditCli } from "../src/cli.js";
import { AGENT, entryGraph, headGraph, turtle } from "../src/rdf.js";
import type { AuditOptions } from "../src/reader.js";
import { auditArtifact } from "../src/reader.js";
import { AT, fixture, required } from "./fixture.js";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
const audit = (extra: Partial<AuditOptions> = {}) =>
  auditArtifact({ fetch: f.pod.fetch, root: f.root, proposal: f.proposal, ...extra });
async function breach(code: string, extra: Partial<AuditOptions> = {}) {
  expect((await audit(extra)).breaches).toContain(code);
}
it("walks the signed authority chain and runs the zero-credential CLI", async () => {
  const report = await audit();
  expect(report).toMatchObject({ ok: true, breaches: [], chain: { ok: true, entries: 5 } });
  expect(report.authorityChain).toEqual([
    `owner ${f.owner}`,
    `mandate ${f.mandateId}`,
    `agent ${f.agent}`,
    `proposal ${f.proposal}`,
    "decision urn:decision:1",
    `approval ${f.approvalId}`,
    "transmission urn:transmission:1",
    "receipt urn:receipt:1",
  ]);
  const lines: string[] = [];
  expect(
    await runAuditCli([f.proposal, "--at", AT], (s) => lines.push(s), { fetch: f.pod.fetch }),
  ).toBe(0);
  expect(lines.at(-1)).toBe("PASS");
  const mirrorBytes = [...f.pod.resources]
    .filter(([url]) => url.includes("/agent/audit/"))
    .map(([, r]) => r.body)
    .join("\n");
  expect(mirrorBytes).not.toContain("synthetic private body");
  expect(mirrorBytes).not.toContain("person@example.org");
  for (const { init } of f.pod.calls) {
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  }
});
it("binds the private proposal commitment without exposing its preimage", async () => {
  const terms = { ...f.terms, proposalDigest: digestOf("private proposal, carrier and expiry") };
  for (const record of f.records) {
    if (record.terms) {
      record.terms = terms;
      record.termsDigest = digestOf(terms);
    }
  }
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, termsDigest: digestOf(terms) }, f.p256, new Date(AT)),
    "application/trig",
  );
  await f.mirror();
  expect(await audit()).toMatchObject({ ok: true, breaches: [] });
  terms.proposalDigest = digestOf("changed private proposal");
  for (const record of f.records) if (record.terms) record.termsDigest = digestOf(terms);
  await f.mirror();
  await breach("forged-approval");
});
it.each([
  "forged-approval",
  "out-of-scope",
  "revoked-at-time",
  "missing-prov",
])("prints named breach %s and exits 1", async (code) => {
  if (code === "forged-approval")
    f.pod.put(
      f.approvalId,
      required(f.pod.resources.get(f.approvalId)).body.replace(
        f.approval.termsDigest,
        digestOf("different"),
      ),
      "application/trig",
    );
  if (code === "out-of-scope") {
    f.terms.binding = "slack";
    for (const r of f.records) if (r.terms) r.termsDigest = digestOf(f.terms);
    await f.mirror();
  }
  if (code === "missing-prov") {
    const url = new URL("agent/audit/4.ttl", f.root).href;
    f.pod.put(
      url,
      required(f.pod.resources.get(url)).body.replace(/;\n {4}prov:wasAssociatedWith[^;]+/, ""),
    );
  }
  const injected = {
    fetch: f.pod.fetch,
    ...(code === "revoked-at-time"
      ? {
          statusResolver: () => async () => ({
            status: "revoked" as const,
            reason: "synthetic revocation",
          }),
        }
      : {}),
  };
  const lines: string[] = [];
  expect(await runAuditCli([f.proposal], (s) => lines.push(s), injected)).toBe(1);
  expect(lines).toContain(`BREACH ${code}`);
});
it("requires all recipients to be in scope", async () => {
  f.terms.recipientHashes.push(`sha256:${"b".repeat(64)}`);
  for (const r of f.records) if (r.terms) r.termsDigest = digestOf(f.terms);
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, termsDigest: digestOf(f.terms) }, f.p256, new Date(AT)),
    "application/trig",
  );
  await f.mirror();
  await breach("out-of-scope");
});
it.each([
  "root",
  "autonomous",
  "withApproval",
] as const)("preserves set-wide prohibitions in %s and compares the combined verdict", async (placement) => {
  f.terms.recipientHashes.push(`sha256:${"b".repeat(64)}`);
  for (const r of f.records) if (r.terms) r.termsDigest = digestOf(f.terms);
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, termsDigest: digestOf(f.terms) }, f.p256, new Date(AT)),
    "application/trig",
  );
  const mandate = defaultMandate({
    id: f.mandateId,
    ownerWebId: f.owner,
    agentWebId: f.agent,
    recipientHashes: f.terms.recipientHashes,
    now: new Date(AT),
  });
  for (const matches of [false, true]) {
    const prohibitions = [
      {
        type: "prohibition" as const,
        action: f.terms.action,
        constraints: [
          {
            leftOperand: `${AGENT}recipientSet`,
            operator: "isAllOf" as const,
            rightOperand: matches
              ? f.terms.recipientHashes
              : [required(f.terms.recipientHashes[0]), `sha256:${"c".repeat(64)}`],
          },
        ],
      },
    ];
    const restricted =
      placement === "root"
        ? { ...mandate, prohibitions: [...mandate.prohibitions, ...prohibitions] }
        : { ...mandate, [placement]: { ...mandate[placement], prohibitions } };
    f.pod.put(
      f.mandateId,
      await mandateToTurtle(
        await issueMandate(restricted, f.ed, {
          statusListCredential: f.statusId,
          statusListIndex: "1",
        }),
      ),
      "application/trig",
    );
    await f.mirror();
    expect((await audit()).breaches).toEqual(
      matches ? ["out-of-scope", "decision-divergence"] : [],
    );
  }
  required(f.records[1]).decision = "prohibited";
  await f.mirror();
  expect((await audit()).breaches).toEqual(["out-of-scope"]);
});
it("combines autonomous and approval-required recipients into one recorded verdict", async () => {
  f.terms.recipientHashes.push(`sha256:${"b".repeat(64)}`);
  for (const r of f.records) if (r.terms) r.termsDigest = digestOf(f.terms);
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, termsDigest: digestOf(f.terms) }, f.p256, new Date(AT)),
    "application/trig",
  );
  const permissions = f.terms.recipientHashes.map((hash) => ({
    type: "permission" as const,
    action: f.terms.action,
    constraints: [
      { leftOperand: `${AGENT}recipientSet`, operator: "eq" as const, rightOperand: hash },
    ],
  }));
  f.pod.put(
    f.mandateId,
    await mandateToTurtle(
      await issueMandate(
        {
          ...f.mandate,
          autonomous: { ...f.mandate.autonomous, permissions: permissions.slice(0, 1) },
          withApproval: { ...f.mandate.withApproval, permissions },
        },
        f.ed,
        { statusListCredential: f.statusId, statusListIndex: "1" },
      ),
    ),
    "application/trig",
  );
  await f.mirror();
  expect((await audit()).ok).toBe(true);
  required(f.records[1]).decision = "permit";
  await f.mirror();
  expect((await audit()).breaches).toEqual(["decision-divergence"]);
});
it.each([
  { name: "autonomous expiry", operator: "lt", decision: "permit", limitApproval: false },
  {
    name: "autonomous activation",
    operator: "gteq",
    decision: "confirm-required",
    limitApproval: false,
  },
  { name: "scope expiry", operator: "lt", decision: "permit", limitApproval: true },
] as const)("checks decision and transmission times separately for $name", async ({
  operator,
  decision,
  limitApproval,
}) => {
  const cutoff = "2026-10-26T12:01:00.000Z";
  const later = "2026-10-26T12:02:00.000Z";
  const times = [AT, AT, AT, later, later];
  const permissions = f.mandate.withApproval.permissions?.map((permission) => ({
    ...permission,
    constraints: [
      ...(permission.constraints ?? []),
      { leftOperand: "dateTime", operator, rightOperand: cutoff },
    ],
  }));
  f.pod.put(
    f.mandateId,
    await mandateToTurtle(
      await issueMandate(
        {
          ...f.mandate,
          autonomous: { ...f.mandate.autonomous, permissions },
          withApproval: limitApproval
            ? { ...f.mandate.withApproval, permissions }
            : f.mandate.withApproval,
        },
        f.ed,
        { statusListCredential: f.statusId, statusListIndex: "1" },
      ),
    ),
    "application/trig",
  );
  required(f.records[1]).decision = decision;
  await f.mirror(times);
  const expected = limitApproval ? ["out-of-scope"] : [];
  expect((await audit()).breaches).toEqual(expected);
  expect((await audit({ at: later })).breaches).toEqual(expected);
  expect((await audit({ at: AT })).ok).toBe(true);
  required(f.records[1]).decision = decision === "permit" ? "confirm-required" : "permit";
  await f.mirror(times);
  expect((await audit()).breaches).toEqual([...expected, "decision-divergence"]);
});
it("binds proposal, decision, transmission and signed approval terms", async () => {
  required(f.records[0]).termsDigest = digestOf("bad");
  await f.mirror();
  await breach("terms-mismatch");
  required(f.records[0]).termsDigest = digestOf(f.terms);
  required(f.records[3]).termsDigest = digestOf("bad");
  await f.mirror();
  await breach("terms-mismatch");
  required(f.records[3]).termsDigest = digestOf(f.terms);
  delete required(f.records[3]).terms;
  await f.mirror();
  await breach("terms-mismatch");
});
it("requires a unique proposal and ordered, linked decisions", async () => {
  f.records.splice(0, 1);
  await f.mirror();
  await breach("missing-prov");
  f = await fixture();
  required(f.records[3]).decisionRecord = "urn:absent";
  await f.mirror();
  await breach("missing-prov");
  f = await fixture();
  delete required(f.records[3]).mandate;
  await f.mirror();
  await breach("missing-prov");
  f = await fixture();
  [f.records[0], f.records[1]] = [required(f.records[1]), required(f.records[0])];
  await f.mirror();
  await breach("missing-prov");
  f = await fixture();
  [f.records[1], f.records[3]] = [required(f.records[3]), required(f.records[1])];
  await f.mirror();
  await breach("missing-prov");
});
it("rejects duplicate event identities and missing transmissions", async () => {
  f.records.push({ ...required(f.records[4]) });
  await f.mirror();
  await breach("missing-prov");
  const g = await fixture();
  g.records.splice(3, 1);
  await g.mirror();
  expect(
    (await auditArtifact({ fetch: g.pod.fetch, root: g.root, proposal: g.proposal })).breaches,
  ).toContain("missing-prov");
});
it("pins an independently supplied owner and refuses invalid instants", async () => {
  await breach("owner-mismatch", { ownerWebId: "https://other.example/#me" });
  expect((await audit({ ownerWebId: f.owner })).ok).toBe(true);
  await breach("unwalkable", { at: "invalid" });
});
it("requires a verified, matching mandate and confirmed revocation status", async () => {
  f.pod.resources.delete(f.mandateId);
  await breach("mandate-invalid");
  f.pod.put(f.mandateId, "invalid", "application/trig");
  await breach("mandate-invalid");
  f = await fixture();
  await breach("mandate-invalid", {
    statusResolver: () => async () => ({ status: "unreachable", reason: "no history" }),
  });
  await breach("mandate-invalid", { statusResolver: () => async () => undefined as never });
  f = await fixture();
  const vc = await issueMandate({ ...f.mandate, id: `${f.mandateId}/other` }, f.ed, {
    statusListCredential: f.statusId,
    statusListIndex: "1",
  });
  f.pod.put(f.mandateId, await mandateToTurtle(vc), "application/trig");
  await breach("mandate-invalid");
});
it("reconstructs the recorded purpose without importing a policy's permitted purpose", async () => {
  f.terms.purpose = "https://example.org/purpose";
  for (const r of f.records) if (r.terms) r.termsDigest = digestOf(f.terms);
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, termsDigest: digestOf(f.terms) }, f.p256, new Date(AT)),
    "application/trig",
  );
  await f.mirror();
  expect((await audit()).ok).toBe(true);
});
it("refuses accounting it cannot independently establish and reports decision divergence", async () => {
  const limited = {
    ...f.mandate,
    limits: [
      {
        leftOperand: `${AGENT}sendsPerDay`,
        operator: "lteq" as const,
        rightOperand: 1,
        enforcement: "hard" as const,
      },
    ],
  };
  f.pod.put(
    f.mandateId,
    await mandateToTurtle(
      await issueMandate(limited, f.ed, { statusListCredential: f.statusId, statusListIndex: "1" }),
    ),
    "application/trig",
  );
  required(f.records[1]).decision = "permit";
  await f.mirror();
  await breach("accounting-unverified");
  await breach("decision-divergence");
});
it("requires fresh owner approval even when the signed mandate permits autonomous sending", async () => {
  f.pod.put(
    f.mandateId,
    await mandateToTurtle(
      await issueMandate({ ...f.mandate, autonomous: f.mandate.withApproval }, f.ed, {
        statusListCredential: f.statusId,
        statusListIndex: "1",
      }),
    ),
    "application/trig",
  );
  required(f.records[1]).decision = "permit";
  delete required(f.records[3]).approval;
  await f.mirror();
  await breach("missing-approval");
});
it("requires approval observation, proof, approve decision, expiry and one use", async () => {
  f.records.splice(2, 1);
  await f.mirror();
  await breach("missing-approval");
  f = await fixture();
  f.pod.resources.delete(f.approvalId);
  await breach("forged-approval");
  f = await fixture();
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, decision: "deny" }, f.p256, new Date(AT)),
    "application/trig",
  );
  await breach("forged-approval");
  f = await fixture();
  await breach("forged-approval", { at: "2026-10-26T14:00:00.000Z" });
  f = await fixture();
  f.records.push({ ...required(f.records[3]), id: "urn:transmission:2" });
  await f.mirror();
  await breach("approval-reused");
});
it.each([
  { created: 0, seen: 0, sent: 0, at: undefined, ok: true },
  { created: 0, seen: 1000, sent: 2000, at: undefined, ok: true },
  { created: 1000, seen: 1000, sent: 2000, at: 1000, ok: true },
  { created: 1000, seen: 2000, sent: 3000, at: 0, ok: false },
  { created: 1000, seen: 0, sent: 2000, at: undefined, ok: false },
  { created: 1000, seen: 0, sent: 2000, at: 3000, ok: false },
  { created: 1000, seen: 0, sent: 0, at: undefined, ok: false },
])("bounds signed approval creation by audit and observation times: %j", async ({
  created,
  seen,
  sent,
  at,
  ok,
}) => {
  const instant = (offset: number) => new Date(Date.parse(AT) + offset).toISOString();
  f.pod.put(
    f.approvalId,
    await issueApproval(f.approval, f.p256, new Date(instant(created))),
    "application/trig",
  );
  await f.mirror([AT, AT, instant(seen), instant(sent), instant(sent)]);
  const report = await audit(at === undefined ? {} : { at: instant(at) });
  expect(report).toMatchObject({ ok, breaches: ok ? [] : ["forged-approval"] });
});
it("authenticates the approval creation time before trusting it", async () => {
  const later = "2026-10-26T12:00:01.000Z";
  const signed = await issueApproval(f.approval, f.p256, new Date(later));
  f.pod.put(f.approvalId, signed.replace(later, AT), "application/trig");
  await breach("forged-approval");
});
it("requires sent status and an unambiguous subsequent receipt", async () => {
  required(f.records[3]).status = "uncertain";
  await f.mirror();
  await breach("missing-receipt");
  required(f.records[3]).status = "sent";
  f.records.pop();
  await f.mirror();
  await breach("missing-receipt");
});
it("checks the head, missing entries, RDF projection and hash chain", async () => {
  const headUrl = new URL("agent/audit/chain.ttl", f.root).href;
  f.pod.resources.delete(headUrl);
  await breach("missing-prov");
  await f.mirror();
  f.pod.resources.delete(new URL("agent/audit/3.ttl", f.root).href);
  await breach("missing-prov");
  const ledger = await f.mirror();
  const e = { ...required(ledger.entries()[0]), hash: `sha-256:${"a".repeat(64)}` };
  const url = new URL("agent/audit/1.ttl", f.root).href;
  f.pod.put(url, await turtle(entryGraph(url, e)));
  await breach("chain-integrity");
  await f.mirror();
  f.pod.put(headUrl, await turtle(headGraph(headUrl, 5, e.hash)));
  await breach("chain-integrity");
  f.pod.put(headUrl, await turtle(headGraph(headUrl, 200001, e.hash)));
  await breach("unwalkable");
});
it("refuses out-of-pod references without requests and redacts errors", async () => {
  required(f.records[3]).mandate = "https://elsewhere.example/mandate";
  required(f.records[1]).mandate = required(f.records[3]).mandate;
  await f.mirror();
  await breach("unwalkable");
  expect(f.pod.calls.some((c) => c.url.startsWith("https://elsewhere"))).toBe(false);
  await breach("unwalkable", {
    fetch: async () => {
      throw "private bearer token";
    },
  });
  const result = await audit({
    proposal: "https://user:private@pod.example/agent/proposals/1.ttl",
  });
  expect(JSON.stringify(result)).not.toContain("private");
});
it("handles CLI usage, nested storage roots and invalid proposal URLs", async () => {
  expect(proposalStorage("https://pod.example/alice/agent/proposals/1.ttl#it")).toBe(
    "https://pod.example/alice/",
  );
  for (const value of [
    "bad",
    "https://pod.example/x",
    "https://user:private@pod.example/agent/proposals/x",
    `${f.proposal}?x`,
  ])
    expect(await runAuditCli([value], () => {})).toBe(1);
  expect(await runAuditCli(["--help"], () => {})).toBe(0);
  for (const args of [[], [f.proposal, "--bad"], [f.proposal, "--bad", AT]])
    expect(await runAuditCli(args, () => {})).toBe(1);
  expect(await runAuditCli([f.proposal, "--at", "invalid"], () => {})).toBe(1);
});
