// AUTHORED-BY Codex GPT-6.1-Sol

import { defaultMandate, issueApproval, issueMandate, mandateToTurtle } from "@jeswr/agent-mandate";
import { digestBytes, digestOf } from "@jeswr/agent-model";
import {
  buildBitstringStatusListCredential,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
import { MemoryLedger } from "../src/ledger.js";
import type { AuditRecord, AuditTerms } from "../src/records.js";
import { createMemoryAuditPod } from "../src/testing.js";
import { hashRecipient, PodMirror } from "../src/writer.js";

export const AT = "2026-10-26T12:00:00.000Z";
export async function fixture(root = "https://pod.example/") {
  const pod = createMemoryAuditPod();
  const owner = new URL("profile/card#me", root).href;
  const agent = new URL("profile/agent#me", root).href;
  const proposal = new URL("agent/proposals/1.ttl", root).href;
  const mandateId = new URL("agent/mandates/default.ttl", root).href;
  const approvalId = new URL("agent/approvals/1.trig", root).href;
  const statusId = new URL("agent/mandates/status.ttl", root).href;
  const hash = hashRecipient("person@example.org", "own-account", new Uint8Array(32).fill(1));
  const terms: AuditTerms = {
    action: "https://jeswr.org/ns/agent#SendMessage",
    target: proposal,
    binding: "gmail",
    accountId: "own-account",
    recipientHashes: [hash],
    messageDigest: digestBytes("synthetic private body"),
  };
  const ed = await generateKeyPairForSuite(`${owner}/ed`);
  const p256 = await generateKeyPairForSuite(`${owner}/approval`, "P-256");
  const profiles = await Promise.all(
    [ed, p256].map((key) =>
      publishVerificationMethod({
        controller: owner,
        verificationMethod: key.verificationMethod,
        key,
      }),
    ),
  );
  pod.put(new URL("profile/card", root).href, profiles.map((p) => p.turtle).join("\n"));
  const mandate = defaultMandate({
    id: mandateId,
    ownerWebId: owner,
    agentWebId: agent,
    recipientHashes: [hash],
    now: new Date(AT),
  });
  const vc = await issueMandate(mandate, ed, {
    statusListCredential: statusId,
    statusListIndex: "1",
  });
  pod.put(mandateId, await mandateToTurtle(vc), "application/trig");
  const status = await issue({
    credential: buildBitstringStatusListCredential({
      id: statusId,
      issuer: owner,
      statusPurpose: "revocation",
      validFrom: AT,
      validUntil: "2026-11-26T12:00:00.000Z",
    }),
    key: ed,
    options: { created: new Date(AT) },
  });
  pod.put(statusId, JSON.stringify(status), "application/ld+json");
  const approval = {
    id: approvalId,
    approves: proposal,
    termsDigest: digestOf(terms),
    expires: "2026-10-26T13:00:00.000Z",
    decision: "approve" as const,
  };
  pod.put(approvalId, await issueApproval(approval, p256, new Date(AT)), "application/trig");
  const common = {
    agent,
    owner,
    proposal,
    mandate: mandateId,
    terms,
    termsDigest: digestOf(terms),
  };
  const records: AuditRecord[] = [
    { ...common, type: "proposal", id: proposal },
    { ...common, type: "decision", id: "urn:decision:1", decision: "confirm-required" },
    {
      type: "approval-seen",
      id: "urn:approval-seen:1",
      agent,
      owner,
      proposal,
      approval: approvalId,
    },
    {
      ...common,
      type: "transmission",
      id: "urn:transmission:1",
      decisionRecord: "urn:decision:1",
      approval: approvalId,
      status: "sent",
    },
    {
      type: "receipt",
      id: "urn:receipt:1",
      agent,
      owner,
      proposal,
      transmission: "urn:transmission:1",
    },
  ];
  async function mirror() {
    for (const key of pod.resources.keys())
      if (key.startsWith(new URL("agent/audit/", root).href)) pod.resources.delete(key);
    const ledger = new MemoryLedger();
    for (const r of records) ledger.append(r, AT);
    await new PodMirror(pod.fetch, root).sync(ledger.entries());
    return ledger;
  }
  await mirror();
  return {
    pod,
    root,
    proposal,
    owner,
    agent,
    records,
    terms,
    mirror,
    approval,
    approvalId,
    mandate,
    mandateId,
    vc,
    ed,
    p256,
    statusId,
  };
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}
