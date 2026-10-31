// AUTHORED-BY Codex GPT-6.1-Sol

import { issueApproval, issueMandate, mandateToTurtle } from "@jeswr/agent-mandate";
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
