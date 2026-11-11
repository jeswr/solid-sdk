// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { MemoryLedger, PodMirror } from "@jeswr/agent-audit";
import { createMemoryAuditPod } from "@jeswr/agent-audit/testing";
import * as sharedVerifier from "@jeswr/agent-audit/verify";
import { digestOf } from "@jeswr/agent-model";
import { Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_SCOPE,
  type AuditEntry,
  auditFromTurtle,
  auditHeadToTurtle,
  auditJsonLd,
  auditToTurtle,
  GENESIS,
  readAudit,
  readAuditHead,
  sealAudit,
  verifyLatestRange,
  verifyRange,
} from "../src/apps/agent/lib/audit";
import { activityFixture } from "../src/apps/agent/lib/audit-fixture";
import { createAgentClient, isLoaded } from "../src/apps/agent/lib/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://pod.example/";
const BASE = `${ROOT}agent/`;
const URL1 = `${BASE}audit/1.ttl`;
const AT = "2026-10-26T12:00:00.000Z";
const RECORD = {
  type: "ingest" as const,
  id: "urn:event:1",
  agent: `${ROOT}agent#me`,
  owner: `${ROOT}profile#me`,
};
const fixture = readFileSync(
  new URL("./fixtures/agent-audit-fixture-1.ttl", import.meta.url),
  "utf8",
);
const clientFor = (fetch: typeof globalThis.fetch) =>
  createAgentClient({ fetch, storage: ROOT, workspace: BASE });
afterEach(() => vi.restoreAllMocks());

describe("real daemon audit records", () => {
  it("reads the unmodified agent-audit golden fixture and recomputes its exact digest", async () => {
    const entry = await auditFromTurtle(fixture, URL1);
    expect(entry).toEqual({
      seq: 1,
      at: AT,
      prev: GENESIS,
      record: RECORD,
      hash: "sha-256:3bdb84d63578773ddad0c678871efb1afbfcf0580526a80cb03e4ae77cc48fb2",
    });
    expect(verifyRange([entry])).toEqual({ ok: true, scope: AUDIT_SCOPE });
    expect(await auditFromTurtle(await auditToTurtle(URL1, entry), URL1)).toEqual(entry);
  });
  it.each([
    ["activity type", (s: string) => s.replace("prov:Activity", "prov:Entity")],
    ["sequence", (s: string) => s.replace("agent:seq 1", 'agent:seq "01"')],
    ["duplicate", (s: string) => `${s}\n<${URL1}> <https://jeswr.org/ns/agent#seq> 2.`],
    [
      "literal kind",
      (s: string) => s.replace('agent:prevHash "sha-256:genesis"', "agent:prevHash <urn:genesis>"),
    ],
    ["JSON datatype", (s: string) => s.replace("rdf-syntax-ns#JSON", "rdf-syntax-ns#PlainLiteral")],
    [
      "associated agent",
      (s: string) =>
        s.replace(
          "prov:wasAssociatedWith <https://pod.example/agent#me>",
          "prov:wasAssociatedWith <urn:other>",
        ),
    ],
    [
      "associated kind",
      (s: string) =>
        s.replace(
          "prov:wasAssociatedWith <https://pod.example/agent#me>",
          'prov:wasAssociatedWith "wrong"',
        ),
    ],
    [
      "extra unsigned reference",
      (s: string) => `${s}\n<${URL1}> <http://www.w3.org/ns/prov#used> <urn:extra>.`,
    ],
    [
      "owner attribution",
      (s: string) =>
        s.replace(
          "prov:wasAttributedTo <https://pod.example/profile#me>",
          "prov:wasAttributedTo <urn:other>",
        ),
    ],
    [
      "generated entity",
      (s: string) => s.replace(`prov:generated <${URL1}#entry>`, "prov:generated <urn:other>"),
    ],
    ["generated record", (s: string) => s.replace("<urn:event:1>", "<urn:event:other>")],
    ["unsigned field", (s: string) => `${s}\n<${URL1}> <urn:unsigned> "extra".`],
    ["unsigned entity field", (s: string) => `${s}\n<${URL1}#entry> <urn:unsigned> "extra".`],
    ["unsigned blank node", (s: string) => `${s}\n[] <urn:unsigned> "extra".`],
    ["sequence datatype", (s: string) => s.replace("agent:seq 1", 'agent:seq "1"')],
  ])("rejects malformed %s", async (_, mutate) => {
    await expect(auditFromTurtle(mutate(fixture), URL1)).rejects.toThrow();
  });
  it("round-trips all authority links and rejects substituted or literal PROV links", async () => {
    const record = {
      ...RECORD,
      type: "transmission" as const,
      proposal: `${BASE}proposals/p.ttl`,
      mandate: `${BASE}mandates/m.trig`,
      approval: `${BASE}approvals/a.trig`,
      decisionRecord: "urn:decision:1",
      transmission: `${BASE}outbox/t.ttl`,
      receipt: "urn:receipt:1",
    };
    const entry = sealAudit(1, AT, GENESIS, record);
    const ttl = await auditToTurtle(URL1, entry);
    expect((await auditFromTurtle(ttl, URL1)).record).toEqual(record);
    await expect(
      auditFromTurtle(
        ttl.replace(
          "prov:used <https://pod.example/agent/proposals/p.ttl>",
          "prov:used <urn:other>",
        ),
        URL1,
      ),
    ).rejects.toThrow();
    await expect(
      auditFromTurtle(
        ttl.replace("prov:used <https://pod.example/agent/proposals/p.ttl>", 'prov:used "other"'),
        URL1,
      ),
    ).rejects.toThrow();
  });
  it("keeps checkpoints body-free and exports real JSON-LD values and PROV links", async () => {
    const checkpoint = sealAudit(3, AT, digestOf("prior"), {
      type: "ledger-checkpoint",
      lastPrunedSeq: 2,
      lastPrunedHash: digestOf("prior"),
    });
    expect(await auditFromTurtle(await auditToTurtle(URL1, checkpoint), URL1)).toEqual(checkpoint);
    const entry = sealAudit(1, AT, GENESIS, { ...RECORD, proposal: "urn:proposal:1" });
    const json = auditJsonLd([entry, checkpoint], `${BASE}audit/`);
    expect(json["@graph"][0]).toMatchObject({
      "@type": "prov:Activity",
      "agent:record": { "@type": "@json", "@value": entry.record },
      "prov:used": [{ "@id": "urn:proposal:1" }],
    });
    expect(json["@graph"][1]).not.toHaveProperty("prov:wasAssociatedWith");
  });
  it.each([
    undefined,
    "urn:purpose",
  ])("matches the daemon's full decision projection (purpose %s)", async (purpose) => {
    const record = {
      ...RECORD,
      type: "decision" as const,
      decision: "permit" as const,
      reason: "allowed",
      termsDigest: digestOf("terms"),
      mandate: "urn:mandate",
      terms: {
        action: "urn:send",
        target: "urn:target",
        binding: "gmail",
        accountId: "personal",
        recipientHashes: [`sha256:${"a".repeat(64)}`],
        messageDigest: digestOf("body"),
        ...(purpose ? { purpose } : {}),
      },
    };
    const entry = sealAudit(1, AT, GENESIS, record);
    const body = await auditToTurtle(URL1, entry);
    expect(await auditFromTurtle(body, URL1)).toEqual(entry);
    expect(body).toContain("agent:DecisionRecord");
    expect(body).toContain("agent:rootPrincipal <https://pod.example/profile#me>");
    expect(body).toContain("agent:leafAssignee <https://pod.example/agent#me>");
    expect(body).toContain("agent:requestAction <urn:send>");
    expect(body).toContain("agent:requestTarget <urn:target>");
    expect(body.includes("agent:requestPurpose")).toBe(Boolean(purpose));
    await expect(
      auditFromTurtle(body.replace('agent:decision "permit"', 'agent:decision "prohibited"'), URL1),
    ).rejects.toThrow("projection");
    await expect(
      auditFromTurtle(
        body.replace("agent:requestAction <urn:send>", "agent:requestAction <urn:other>"),
        URL1,
      ),
    ).rejects.toThrow("projection");
    const minimal = sealAudit(1, AT, GENESIS, { ...RECORD, type: "decision" });
    expect(await auditFromTurtle(await auditToTurtle(URL1, minimal), URL1)).toEqual(minimal);
  });
  it("surfaces serializer failures", async () => {
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => {
      callback?.(new Error("write failure"), "");
      return undefined as never;
    });
    await expect(auditToTurtle(URL1, sealAudit(1, AT, GENESIS, RECORD))).rejects.toThrow(
      "write failure",
    );
  });
});

describe("published range loading", () => {
  it("fetches a bounded newest range and retains an unreadable slot", async () => {
    const entries = activityFixture(16);
    const pod = createDemoPod({
      root: ROOT,
      seed: [
        ...(await Promise.all(
          entries.map(async (e) => ({
            path: `agent/audit/${e.seq}.ttl`,
            body: await auditToTurtle(`${BASE}audit/${e.seq}.ttl`, e),
            contentType: "text/turtle",
          })),
        )),
        {
          path: "agent/audit/chain.ttl",
          body: await auditHeadToTurtle(`${BASE}audit/chain.ttl`, entries.at(-1) as AuditEntry),
          contentType: "text/turtle",
        },
      ],
    });
    const client = clientFor(pod.fetch);
    expect(await readAuditHead(client)).toMatchObject({ seq: 16, hash: entries.at(-1)?.hash });
    expect((await readAudit(client)).filter(isLoaded).map((r) => r.record.seq)).toEqual(
      entries.toReversed().map((r) => r.seq),
    );
    expect(
      (await readAudit(client, { limit: 2, before: 5 })).filter(isLoaded).map((r) => r.record.seq),
    ).toEqual([4, 3]);
    expect(await readAudit(client, { before: 1 })).toEqual([]);
    await pod.fetch(`${BASE}audit/15.ttl`, {
      method: "PUT",
      body: "malformed turtle",
      headers: { "content-type": "text/turtle" },
    });
    expect((await readAudit(client, { limit: 2 }))[1]).toHaveProperty("error");
    await pod.fetch(`${BASE}audit/16.ttl`, {
      method: "PUT",
      body: await auditToTurtle(`${BASE}audit/16.ttl`, entries[0] as AuditEntry),
      headers: { "content-type": "text/turtle" },
    });
    expect((await readAudit(client, { limit: 1 }))[0]).toHaveProperty("error");
    await pod.fetch(`${BASE}audit/16.ttl`, {
      method: "PUT",
      body: await auditToTurtle(`${BASE}audit/16.ttl`, entries[15] as AuditEntry),
      headers: { "content-type": "text/turtle" },
    });
    await pod.fetch(`${BASE}audit/15.ttl`, { method: "DELETE" });
    const sparse = (await readAudit(client, { limit: 2 })).filter(isLoaded).map((r) => r.record);
    expect(sparse.map((r) => r.seq)).toEqual([16, 14]);
    expect(verifyRange(sparse.toReversed())).toMatchObject({ ok: false, problem: "Sequence gap" });
    await expect(readAudit(client, { limit: 5001 })).rejects.toThrow();
  });
  it("handles an absent head, and refuses broken or inaccessible heads", async () => {
    const pod = createDemoPod({ root: ROOT });
    expect(await readAudit(clientFor(pod.fetch))).toEqual([]);
    expect(await readAuditHead(clientFor(pod.fetch))).toBeUndefined();
    await expect(
      readAuditHead(clientFor(async () => new Response(null, { status: 403 }))),
    ).rejects.toThrow();
    const body = await auditHeadToTurtle(`${BASE}audit/chain.ttl`, {
      seq: 1,
      hash: digestOf("head"),
    });
    await pod.fetch(`${BASE}audit/chain.ttl`, {
      method: "PUT",
      body: body.replace("agent:seq 1", 'agent:seq "00"'),
      headers: { "content-type": "text/turtle" },
    });
    await expect(readAuditHead(clientFor(pod.fetch))).rejects.toThrow("head");
    // An extra, unsigned claim in the head is refused, as the daemon's reader does.
    await pod.fetch(`${BASE}audit/chain.ttl`, {
      method: "PUT",
      body: `${body}\n<${BASE}audit/chain.ttl> <http://purl.org/dc/terms/title> "extra" .\n`,
      headers: { "content-type": "text/turtle" },
    });
    await expect(readAuditHead(clientFor(pod.fetch))).rejects.toThrow("Invalid audit head");
    await pod.fetch(`${BASE}audit/chain.ttl`, {
      method: "PUT",
      body,
      headers: { "content-type": "text/turtle" },
    });
    expect(await readAuditHead(clientFor(pod.fetch))).toEqual({ seq: 1, hash: digestOf("head") });
  });
  it.each([
    false,
    true,
  ])("rejects deleted published records (delete everything: %s)", async (all) => {
    const entries = activityFixture(3);
    const pod = createDemoPod({
      root: ROOT,
      seed: [
        ...(await Promise.all(
          entries.map(async (e) => ({
            path: `agent/audit/${e.seq}.ttl`,
            body: await auditToTurtle(`${BASE}audit/${e.seq}.ttl`, e),
            contentType: "text/turtle",
          })),
        )),
        {
          path: "agent/audit/chain.ttl",
          body: await auditHeadToTurtle(`${BASE}audit/chain.ttl`, entries[2] as AuditEntry),
          contentType: "text/turtle",
        },
      ],
    });
    for (const e of all ? entries : entries.slice(-1))
      await pod.fetch(`${BASE}audit/${e.seq}.ttl`, { method: "DELETE" });
    const client = clientFor(pod.fetch);
    const rows = loadedAudit(await readAudit(client));
    expect(verifyRange(rows.toReversed(), await readAuditHead(client))).toMatchObject({
      ok: false,
      firstBadSeq: 3,
      problem: "Record 3 is missing",
    });
  });
});
function loadedAudit(rows: Awaited<ReturnType<typeof readAudit>>) {
  return rows.filter(isLoaded).map((row) => row.record);
}

it("re-exports the shared verifier without app-owned validation", () => {
  expect(verifyRange).toBe(sharedVerifier.verifyRange);
  expect(verifyLatestRange).toBe(sharedVerifier.verifyLatestRange);
  expect(sealAudit).toBe(sharedVerifier.seal);
});

it.each([
  "conversation",
  "tool-call",
  "model-call",
] as const)("reads the package mirror's %s records with current instrumentation", async (type) => {
  const ledger = new MemoryLedger();
  const record = {
    ...RECORD,
    type,
    taskId: "run-1",
    conversation: "urn:conversation:1",
    modelCall: "urn:model-call:1",
    tool: "pod_read",
    inputTokens: 2,
    outputTokens: 3,
    terms: {
      action: "urn:send",
      target: "urn:target",
      binding: "direct",
      accountId: "personal",
      recipientHashes: [`sha256:${"a".repeat(64)}`],
      messageDigest: digestOf("body"),
      proposalDigest: digestOf("proposal"),
    },
  };
  const entry = ledger.append(record, AT);
  const pod = createMemoryAuditPod();
  await new PodMirror(pod.fetch, ROOT).sync(ledger.entries());
  const ttl = (pod.resources.get(URL1) as { body: string }).body;
  expect(await auditFromTurtle(ttl, URL1)).toEqual(entry);
  expect(await auditFromTurtle(await auditToTurtle(URL1, entry), URL1)).toEqual(entry);
  expect(verifyRange([entry], entry).ok).toBe(true);
  expect(auditJsonLd([entry], `${BASE}audit/`)["@graph"][0]).toMatchObject({
    "prov:used": [{ "@id": record.modelCall }],
  });
});
